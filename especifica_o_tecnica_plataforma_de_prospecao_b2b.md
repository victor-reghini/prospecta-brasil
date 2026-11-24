# Blueprint Técnico: Plataforma de Prospecção B2B (Dados Públicos + Stripe)

Este documento contém as diretrizes arquiteturais, modelagem de banco de dados e regras de negócio para implementação do sistema de prospecção B2B baseado nos dados abertos da Receita Federal do Brasil (RFB) com monetização via Stripe.

---

## 1. Modelagem de Banco de Dados (PostgreSQL)

Os dados abertos da Receita Federal são distribuídos em múltiplos arquivos CSV separados (`Empresas`, `Estabelecimentos`, `Socios`, `Cnaes`, `Municipios`, `Naturezas`). Para garantir **tempo de resposta inferior a 2 segundos** em consultas com filtros combinados sobre ~55 milhões de CNPJs, utilize uma **tabela desnormalizada otimizada para leitura (`empresas_prospect`)** alimentada pelo pipeline de ETL, além das tabelas transacionais da aplicação.

### 1.1. Schema Analítico (Dados Governamentais)

```sql
-- Extensões necessárias para buscas textuais rápidas e arrays
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS btree_gin;

-- Tabela principal consolidada (Particionada por Situação Cadastral ou UF para máxima performance)
CREATE TABLE empresas_prospect (
    cnpj_basico CHAR(8) NOT NULL,
    cnpj_ordem CHAR(4) NOT NULL,
    cnpj_dv CHAR(2) NOT NULL,
    cnpj_completo CHAR(14) NOT NULL,
    
    -- Dados Cadastrais (Origem: Empresas + Estabelecimentos)
    razao_social VARCHAR(255) NOT NULL,
    nome_fantasia VARCHAR(255),
    situacao_cadastral SMALLINT NOT NULL, -- 02 = Ativa (Filtro padrão)
    data_inicio_atividade DATE,
    matriz_filial SMALLINT, -- 1 = Matriz, 2 = Filial
    
    -- Classificação e Porte (Proxies para Faturamento/Lucro)
    natureza_juridica SMALLINT,
    porte_empresa SMALLINT, -- 01 = Não Informado, 02 = ME, 03 = EPP, 05 = Demais
    capital_social NUMERIC(15, 2) DEFAULT 0.00,
    opcao_simples CHAR(1), -- S ou N
    opcao_mei CHAR(1), -- S ou N
    
    -- Atividade Econômica (CNAE)
    cnae_fiscal_principal INTEGER NOT NULL,
    cnaes_secundarios INTEGER[], -- Array de inteiros para busca rápida com índice GIN
    
    -- Localização Geográfica (Origem: Estabelecimentos + Tabela IBGE)
    regiao VARCHAR(20) NOT NULL, -- Norte, Nordeste, Centro-Oeste, Sudeste, Sul
    uf CHAR(2) NOT NULL,
    codigo_municipio_ibge INTEGER NOT NULL,
    municipio_nome VARCHAR(100) NOT NULL,
    bairro VARCHAR(100),
    cep CHAR(8),
    logradouro VARCHAR(255),
    numero VARCHAR(20),
    complemento VARCHAR(150),
    
    -- Contatos (Normalizados no ETL)
    ddd_1 CHAR(2),
    telefone_1 VARCHAR(15),
    ddd_2 CHAR(2),
    telefone_2 VARCHAR(15),
    email VARCHAR(255),
    
    -- Flags de Controle para Filtros Instantâneos
    possui_email BOOLEAN GENERATED ALWAYS AS (email IS NOT NULL AND email <> '') STORED,
    possui_telefone BOOLEAN GENERATED ALWAYS AS (telefone_1 IS NOT NULL AND telefone_1 <> '') STORED,
    
    atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (cnpj_completo, uf)
) PARTITION BY LIST (uf);

-- Exemplo de criação de partições (Criar para todas as 27 UFs)
CREATE TABLE empresas_prospect_sp PARTITION OF empresas_prospect FOR VALUES IN ('SP');
CREATE TABLE empresas_prospect_pr PARTITION OF empresas_prospect FOR VALUES IN ('PR');
CREATE TABLE empresas_prospect_mg PARTITION OF empresas_prospect FOR VALUES IN ('MG');
-- (Repetir para as demais UFs...)

-- Índices Estratégicos para o Motor de Filtros
CREATE INDEX idx_prospect_filtros_core ON empresas_prospect (situacao_cadastral, uf, codigo_municipio_ibge, cnae_fiscal_principal);
CREATE INDEX idx_prospect_cnaes_sec ON empresas_prospect USING GIN (cnaes_secundarios);
CREATE INDEX idx_prospect_capital_porte ON empresas_prospect (porte_empresa, capital_social);
CREATE INDEX idx_prospect_contatos ON empresas_prospect (possui_email, possui_telefone) WHERE situacao_cadastral = 2;
CREATE INDEX idx_prospect_abertura ON empresas_prospect (data_inicio_atividade);

-- Tabela de Sócios (Opcional para enriquecimento de decisores)
CREATE TABLE socios_prospect (
    id BIGSERIAL PRIMARY KEY,
    cnpj_basico CHAR(8) NOT NULL,
    nome_socio VARCHAR(255) NOT NULL,
    cpf_cnpj_mascarado VARCHAR(14), -- Padrão RFB: ***123456**
    qualificacao_socio SMALLINT, -- Ex: 49 = Sócio-Administrador
    faixa_etaria SMALLINT
);
CREATE INDEX idx_socios_cnpj_basico ON socios_prospect (cnpj_basico);
```

### 1.2. Schema Transacional (Usuários, Pedidos e Deduplicação)

```sql
CREATE TABLE usuarios (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    nome VARCHAR(255) NOT NULL,
    senha_hash VARCHAR(255) NOT NULL,
    stripe_customer_id VARCHAR(100) UNIQUE,
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE pedidos_exportacao (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    usuario_id UUID NOT NULL REFERENCES usuarios(id),
    
    -- Snapshot dos filtros e métricas
    filtros_json JSONB NOT NULL, -- Armazena o payload exato da busca
    query_hash VARCHAR(64) NOT NULL, -- SHA-256 dos filtros para evitar adulteração
    quantidade_registros INTEGER NOT NULL,
    valor_total_centavos INTEGER NOT NULL, -- Ex: 4990 = R$ 49,90
    
    -- Integração Stripe
    stripe_session_id VARCHAR(255) UNIQUE,
    stripe_payment_intent_id VARCHAR(255) UNIQUE,
    status_pagamento VARCHAR(30) NOT NULL DEFAULT 'PENDING', -- PENDING, PAID, FAILED, REFUNDED
    
    -- Pipeline de Arquivo
    status_arquivo VARCHAR(30) NOT NULL DEFAULT 'WAITING_PAYMENT', -- WAITING_PAYMENT, PROCESSING, READY, EXPIRED
    s3_file_key VARCHAR(500),
    expira_em TIMESTAMP,
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    pago_em TIMESTAMP
);

-- Controle de Idempotência de Webhooks Stripe
CREATE TABLE stripe_webhook_events (
    event_id VARCHAR(255) PRIMARY KEY,
    event_type VARCHAR(100) NOT NULL,
    processado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Histórico de CNPJs adquiridos por usuário (Suporta o filtro "Excluir leads já comprados")
CREATE TABLE leads_adquiridos_usuario (
    usuario_id UUID NOT NULL REFERENCES usuarios(id),
    cnpj_completo CHAR(14) NOT NULL,
    pedido_id UUID NOT NULL REFERENCES pedidos_exportacao(id),
    adquirido_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (usuario_id, cnpj_completo)
);
```

---

## 2. Regras de Precificação Dinâmica (Backend)

O cálculo do preço deve ocorrer **exclusivamente no backend** no momento da cotação e validado novamente antes da criação da `Checkout Session` no Stripe.

### Fórmula de Faixas Progressivas (Tiered Pricing)

* **Taxa Mínima:** `R$ 19,90` (1.990 centavos) para qualquer exportação entre `1` e `500` registros.
* **Faixa 1 (501 a 5.000 registros):** `R$ 0,04` (4 centavos) por registro excedente.
* **Faixa 2 (5.001 a 25.000 registros):** `R$ 0,025` (2,5 centavos) por registro excedente.
* **Faixa 3 (Acima de 25.000 registros):** `R$ 0,015` (1,5 centavos) por registro excedente.

```typescript
export function calcularPrecoExportacaoCentavos(totalRegistros: number): number {
  if (totalRegistros <= 0) throw new Error("A consulta não retornou registros.");
  
  const TAXA_MINIMA = 1990; // R$ 19,90
  if (totalRegistros <= 500) {
    return TAXA_MINIMA;
  }

  let totalCentavos = TAXA_MINIMA;
  let restantes = totalRegistros - 500;

  // Faixa 1: próximos 4.500 registros (de 501 a 5.000) a 4 centavos
  const qtdFaixa1 = Math.min(restantes, 4500);
  totalCentavos += qtdFaixa1 * 4;
  restantes -= qtdFaixa1;

  // Faixa 2: próximos 20.000 registros (de 5.001 a 25.000) a 2.5 centavos
  if (restantes > 0) {
    const qtdFaixa2 = Math.min(restantes, 20000);
    totalCentavos += Math.round(qtdFaixa2 * 2.5);
    restantes -= qtdFaixa2;
  }

  // Faixa 3: acima de 25.000 registros a 1.5 centavos
  if (restantes > 0) {
    totalCentavos += Math.round(restantes * 1.5);
  }

  return totalCentavos;
}
```

---

## 3. Fluxo de Integração com Stripe (Checkout + Webhooks)

### 3.1. Diagrama de Sequência

```
[Frontend]                   [Backend API]                  [Stripe API]               [Worker / S3]
    |                              |                             |                           |
    |-- 1. POST /api/quotes ------>|                             |                           |
    |<-- Retorna count + preço ----|                             |                           |
    |                              |                             |                           |
    |-- 2. POST /api/checkout ---->|                             |                           |
    |                              |-- Cria Pedido (PENDING)     |                           |
    |                              |-- checkout.sessions.create->|                           |
    |                              |<-- Retorna session.url -----|                           |
    |<-- Redireciona para Stripe --|                             |                           |
    |                              |                             |                           |
    |-- 3. Usuário Paga (PIX/Card)------------------------------>|                           |
    |                              |                             |                           |
    |                              |<-- 4. POST /webhooks/stripe-|                           |
    |                              |    (checkout.session.completed)                         |
    |                              |-- Valida Assinatura         |                           |
    |                              |-- Atualiza Pedido (PAID)    |                           |
    |                              |-- Enfileira Job Exportação ---------------------------->|
    |<-- 5. Polling / SSE Status --|                             |                           |
    |                              |                             |    6. Stream SQL -> CSV   |
    |                              |                             |    7. Upload Bucket S3    |
    |<-- 8. Presigned URL Download |<-- Atualiza Pedido (READY) -|                           |
```

### 3.2. Implementação do Endpoint de Checkout (Node.js / TypeScript)

```typescript
import Stripe from 'stripe';
import crypto from 'crypto';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-06-20',
});

export async function criarSessaoCheckout(req, res) {
  const { filtros, formatoArquivo } = req.body; // formatoArquivo: 'csv' | 'xlsx'
  const usuarioId = req.user.id;

  // 1. Executa COUNT(*) real no PostgreSQL com os filtros enviados (sempre forçando situacao_cadastral = 2)
  const totalRegistros = await contarEmpresasComFiltros(filtros, usuarioId);
  
  if (totalRegistros === 0) {
    return res.status(400).json({ error: 'Nenhuma empresa encontrada para os filtros aplicados.' });
  }

  // 2. Calcula o valor em centavos
  const valorCentavos = calcularPrecoExportacaoCentavos(totalRegistros);
  const queryHash = crypto.createHash('sha256').update(JSON.stringify(filtros)).digest('hex');

  // 3. Registra o pedido no banco antes de chamar o Stripe
  const pedido = await db.pedidosExportacao.create({
    usuario_id: usuarioId,
    filtros_json: filtros,
    query_hash: queryHash,
    quantidade_registros: totalRegistros,
    valor_total_centavos: valorCentavos,
    status_pagamento: 'PENDING',
    status_arquivo: 'WAITING_PAYMENT',
  });

  // 4. Cria a sessão dinâmica no Stripe (Price Data inline, sem precisar cadastrar produtos fixos)
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card', 'boleto'], // Habilitar 'pix' no Dashboard do Stripe se disponível na conta BR
    customer_email: req.user.email,
    line_items: [
      {
        price_data: {
          currency: 'brl',
          unit_amount: valorCentavos,
          product_data: {
            name: `Lista de Prospecção B2B (${totalRegistros.toLocaleString('pt-BR')} empresas)`,
            description: `Exportação segmentada em formato ${formatoArquivo.toUpperCase()} - Dados Públicos RFB`,
          },
        },
        quantity: 1,
      },
    ],
    metadata: {
      pedido_id: pedido.id,
      usuario_id: usuarioId,
      formato_arquivo: formatoArquivo,
      query_hash: queryHash,
    },
    success_url: `${process.env.FRONTEND_URL}/pedidos/${pedido.id}?status=sucesso`,
    cancel_url: `${process.env.FRONTEND_URL}/busca?status=cancelado`,
  });

  // 5. Vincula o ID da sessão ao pedido
  await db.pedidosExportacao.update(pedido.id, { stripe_session_id: session.id });

  return res.json({ checkoutUrl: session.url, pedidoId: pedido.id });
}
```

### 3.3. Implementação do Webhook Idempotente do Stripe

> **Nota Importante:** O endpoint de webhook deve receber o corpo bruto (`rawBody`) da requisição para que a verificação de assinatura criptográfica do Stripe funcione.

```typescript
export async function handleStripeWebhook(req, res) {
  const sig = req.headers['stripe-signature'];
  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(
      req.rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (err: any) {
    console.error(`Falha na assinatura do Webhook: ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // 1. Garantia de Idempotência: Verifica se o evento já foi processado
  const eventoExistente = await db.stripeWebhookEvents.findById(event.id);
  if (eventoExistente) {
    return res.status(200).json({ received: true, duplicated: true });
  }

  // 2. Trata a confirmação de pagamento (Cartão imediato ou PIX/Boleto compensado)
  if (
    event.type === 'checkout.session.completed' ||
    event.type === 'checkout.session.async_payment_succeeded'
  ) {
    const session = event.data.object as Stripe.Checkout.Session;

    if (session.payment_status === 'paid') {
      const pedidoId = session.metadata?.pedido_id;
      const formatoArquivo = session.metadata?.formato_arquivo || 'csv';

      await db.transaction(async (trx) => {
        // Registra o processamento do evento
        await trx.stripeWebhookEvents.insert({
          event_id: event.id,
          event_type: event.type,
        });

        // Atualiza o status do pedido
        await trx.pedidosExportacao.update(pedidoId, {
          status_pagamento: 'PAID',
          status_arquivo: 'PROCESSING',
          stripe_payment_intent_id: session.payment_intent as string,
          pago_em: new Date(),
        });
      });

      // 3. Dispara o Worker em background (BullMQ / RabbitMQ / SQS) para gerar o CSV/XLSX
      await exportQueue.add('gerar-planilha-leads', {
        pedidoId,
        formatoArquivo,
      });
    }
  }

  return res.status(200).json({ received: true });
}
```

---

## 4. Diretrizes para o Worker de Exportação (Streaming)

Para evitar estouro de memória (`Out Of Memory`) ao exportar 100.000+ empresas simultaneamente:

1. **Cursor / Query Stream:** Utilize `pg-query-stream` (Node.js) ou `JdbcCursorItemReader` (Java Spring Batch) para ler lotes de 5.000 linhas do PostgreSQL por vez.
2. **Transformação em Fluxo:** Converta cada linha diretamente para CSV (usando `fast-csv`) e canalize (`pipe`) o stream direto para o upload multipart do S3 / Cloudflare R2 (`@aws-sdk/lib-storage`).
3. **Registro de Deduplicação:** Durante o stream, insira em batch (`INSERT INTO leads_adquiridos_usuario ... ON CONFLICT DO NOTHING`) os CNPJs exportados para que o usuário possa filtrá-los em compras futuras.
4. **Entrega Segura:** Ao finalizar o upload, gere uma *Presigned URL* válida por 24 horas, atualize `status_arquivo = 'READY'` e envie e-mail transacional com o link de download.