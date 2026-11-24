# Prospecta Brasil

Plataforma de prospecção B2B baseada nos dados abertos da Receita Federal do Brasil (RFB), com motor de segmentação em PostgreSQL particionado, precificação dinâmica progressiva, checkout e webhooks idempotentes via Stripe e exportação em streaming para S3/Cloudflare R2 (ou disco local em desenvolvimento).

## Estrutura do Projeto

- `sql/schema.sql`: Schema analítico (`empresas_prospect` particionada pelas 27 UFs + índices estratégicos + `socios_prospect`) e schema transacional (`usuarios`, `pedidos_exportacao`, `stripe_webhook_events`, `leads_adquiridos_usuario`).
- `sql/seed.sql`: Usuário de desenvolvimento e empresas de exemplo para testes locais.
- `src/pricing.ts`: Cálculo de preço em faixas progressivas (centavos).
- `src/filters.ts`: Normalização, geração determinística de `query_hash` (SHA-256) e construtor de `WHERE` parametrizado.
- `src/db.ts`: Repositório PostgreSQL com `pg-query-stream` e transações idempotentes.
- `src/storage.ts`: Upload multipart em stream (`@aws-sdk/lib-storage`) + Presigned URL de 24h (com fallback local em `./exports`).
- `src/worker.ts`: Worker de exportação via `pg-query-stream` (lotes de 5.000) + `fast-csv` + deduplicação em lote.
- `src/checkout.ts` e `src/webhook.ts`: Endpoints `POST /api/quotes`, `POST /api/checkout` e `POST /webhooks/stripe` (`rawBody`).
- `src/etl-rfb.ts`: Pipeline ETL de Dados Abertos da RFB (`Empresas`, `Simples`, `Estabelecimentos`, `Socios`) com upsert idempotente para novas empresas e encerradas/baixadas e modo periódico (`--watch`).
- `public/index.html`: Interface web para segmentação, cotação e acompanhamento de pedidos.

## Pré-requisitos e Execução Local

1. Copie o arquivo de ambiente:

```bash
cp .env.example .env
```

2. Suba o PostgreSQL com o schema e dados de exemplo:

```bash
docker compose up -d
```

3. Instale as dependências, execute o ETL inicial da RFB e inicie o servidor:

```bash
npm install
npm run etl:rfb
npm run dev
```

Para atualização periódica automática (novas empresas e encerramentos), execute `npm run etl:rfb:watch` (ou configure `ETL_SYNC_INTERVAL_HOURS` no `.env`). Para baixar diretamente os ZIPs remotos da Receita Federal, utilize `npx tsx src/etl-rfb.ts --download-remote`.

4. Para compilar e executar os testes automatizados:

```bash
npm run build
npm test
```
