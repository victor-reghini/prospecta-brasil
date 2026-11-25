import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import ExcelJS from 'exceljs';
import Stripe from 'stripe';

import { createApp } from '../src/app.js';
import { DbRepository, CriarPedidoInput, RegistrarWebhookPagamentoInput } from '../src/db.js';
import {
  executarEtlRfb,
  gerarLoteRfbOficialCsv,
  parseCapitalSocial,
  parseCnaesSecundarios,
  parseDataRfb,
  parseSemicolonCsvLine,
} from '../src/etl-rfb.js';
import { construirWhereEmpresas, gerarQueryHash, normalizarFiltros } from '../src/filters.js';
import { calcularPrecoExportacaoCentavos, detalharPrecoExportacao } from '../src/pricing.js';
import { LocalExportStorage } from '../src/storage.js';
import {
  EmpresaAmostra,
  EmpresaExportRow,
  FiltrosProspeccao,
  PedidoExportacao,
  UsuarioAutenticado,
} from '../src/types.js';
import { InMemoryExportQueue, processarExportacaoPedido } from '../src/worker.js';

function createFakeRepo(rows: EmpresaExportRow[]): {
  repo: DbRepository;
  pedidos: Map<string, PedidoExportacao>;
  eventos: Set<string>;
  leadsAdquiridos: Map<string, Set<string>>;
} {
  const pedidos = new Map<string, PedidoExportacao>();
  const eventos = new Set<string>();
  const leadsAdquiridos = new Map<string, Set<string>>();

  const filtrarRows = (filtros: FiltrosProspeccao, usuarioId?: string) => {
    const adquiridos = usuarioId ? leadsAdquiridos.get(usuarioId) : undefined;
    return rows.filter((row) => {
      if (row.situacao_cadastral !== 2) return false;
      if (filtros.regiao?.length && !filtros.regiao.includes(row.regiao)) return false;
      if (filtros.uf?.length && !filtros.uf.includes(row.uf)) return false;
      if (
        filtros.codigo_municipio_ibge?.length &&
        !filtros.codigo_municipio_ibge.includes(row.codigo_municipio_ibge)
      ) {
        return false;
      }
      if (
        filtros.cnae_fiscal_principal?.length &&
        !filtros.cnae_fiscal_principal.includes(row.cnae_fiscal_principal)
      ) {
        return false;
      }
      if (filtros.somente_com_email && !row.email) return false;
      if (filtros.excluir_leads_ja_comprados && adquiridos?.has(row.cnpj_completo)) return false;
      return true;
    });
  };

  const repo: DbRepository = {
    async contarEmpresasComFiltros(filtros, usuarioId) {
      return filtrarRows(filtros, usuarioId).length;
    },
    async buscarAmostraEmpresas(filtros, usuarioId, limite = 5): Promise<EmpresaAmostra[]> {
      return filtrarRows(filtros, usuarioId)
        .slice(0, limite)
        .map((r) => ({
          cnpj_mascarado: `${r.cnpj_completo.slice(0, 2)}.***.***/0001-${r.cnpj_completo.slice(12)}`,
          razao_social: r.razao_social,
          nome_fantasia: r.nome_fantasia,
          uf: r.uf,
          municipio_nome: r.municipio_nome,
          cnae_fiscal_principal: r.cnae_fiscal_principal,
          porte_empresa: r.porte_empresa,
          capital_social: r.capital_social,
          possui_email: Boolean(r.email),
          possui_telefone: Boolean(r.telefone_1),
        }));
    },
    async criarPedidoExportacao(input: CriarPedidoInput) {
      const pedido: PedidoExportacao = {
        id: crypto.randomUUID(),
        usuario_id: input.usuario_id,
        filtros_json: input.filtros_json,
        query_hash: input.query_hash,
        quantidade_registros: input.quantidade_registros,
        valor_total_centavos: input.valor_total_centavos,
        stripe_session_id: null,
        stripe_payment_intent_id: null,
        status_pagamento: 'PENDING',
        status_arquivo: 'WAITING_PAYMENT',
        s3_file_key: null,
        expira_em: null,
        criado_em: new Date(),
        pago_em: null,
      };
      pedidos.set(pedido.id, pedido);
      return pedido;
    },
    async atualizarSessaoStripePedido(pedidoId, stripeSessionId) {
      const pedido = pedidos.get(pedidoId);
      if (pedido) pedido.stripe_session_id = stripeSessionId;
    },
    async buscarPedidoPorId(pedidoId, usuarioId) {
      const pedido = pedidos.get(pedidoId) ?? null;
      if (!pedido) return null;
      if (usuarioId && pedido.usuario_id !== usuarioId) return null;
      return pedido;
    },
    async listarPedidosUsuario(usuarioId) {
      return Array.from(pedidos.values()).filter((p) => p.usuario_id === usuarioId);
    },
    async registrarPagamentoWebhookIdempotente(input: RegistrarWebhookPagamentoInput) {
      if (eventos.has(input.event_id)) {
        return { duplicated: true };
      }
      eventos.add(input.event_id);
      const pedido = pedidos.get(input.pedido_id);
      if (pedido) {
        pedido.status_pagamento = 'PAID';
        pedido.status_arquivo = 'PROCESSING';
        pedido.stripe_payment_intent_id = input.stripe_payment_intent_id;
        pedido.pago_em = new Date();
      }
      return { duplicated: false };
    },
    async marcarPedidoArquivoPronto(pedidoId, s3FileKey, expiraEm) {
      const pedido = pedidos.get(pedidoId);
      if (pedido) {
        pedido.status_arquivo = 'READY';
        pedido.s3_file_key = s3FileKey;
        pedido.expira_em = expiraEm;
      }
    },
    async marcarPedidoArquivoFalhou(pedidoId) {
      const pedido = pedidos.get(pedidoId);
      if (pedido) pedido.status_arquivo = 'FAILED';
    },
    async inserirLeadsAdquiridosEmLote(usuarioId, _pedidoId, cnpjs) {
      let set = leadsAdquiridos.get(usuarioId);
      if (!set) {
        set = new Set<string>();
        leadsAdquiridos.set(usuarioId, set);
      }
      for (const cnpj of cnpjs) set.add(cnpj);
    },
    async *streamEmpresasParaExportacao(filtros, usuarioId) {
      for (const row of filtrarRows(filtros, usuarioId)) {
        yield row;
      }
    },
    async garantirUsuario(_usuario: UsuarioAutenticado) {},
    async obterResumoEtl() {
      const ativas = rows.filter((r) => r.situacao_cadastral === 2).length;
      return {
        total_empresas: rows.length,
        total_ativas: ativas,
        total_encerradas_ou_inativas: rows.length - ativas,
        ultima_execucao: null,
      };
    },
    async verificarSaude() {
      return true;
    },
    async close() {},
  };

  return { repo, pedidos, eventos, leadsAdquiridos };
}

async function startTestServer(app: ReturnType<typeof createApp>) {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Falha ao obter porta do servidor de teste');
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}

test('calcularPrecoExportacaoCentavos calcula corretamente todas as faixas progressivas', () => {
  assert.throws(() => calcularPrecoExportacaoCentavos(0), /A consulta não retornou registros/);
  assert.throws(() => calcularPrecoExportacaoCentavos(-5), /A consulta não retornou registros/);

  // Até 500 registros: taxa mínima R$ 19,90 (1990 centavos)
  assert.equal(calcularPrecoExportacaoCentavos(1), 1990);
  assert.equal(calcularPrecoExportacaoCentavos(500), 1990);

  // Faixa 1 (501 a 5.000): 4 centavos por excedente
  assert.equal(calcularPrecoExportacaoCentavos(501), 1994);
  assert.equal(calcularPrecoExportacaoCentavos(5000), 1990 + 4500 * 4); // 19990

  // Faixa 2 (5.001 a 25.000): 2,5 centavos por excedente
  assert.equal(calcularPrecoExportacaoCentavos(5001), 19990 + 3); // Math.round(2.5) = 3
  assert.equal(calcularPrecoExportacaoCentavos(25000), 19990 + 20000 * 2.5); // 69990

  // Faixa 3 (> 25.000): 1,5 centavos por excedente
  assert.equal(calcularPrecoExportacaoCentavos(25001), 69990 + 2); // Math.round(1.5) = 2
  assert.equal(calcularPrecoExportacaoCentavos(100000), 69990 + Math.round(75000 * 1.5)); // 182490

  const detalhe = detalharPrecoExportacao(26000);
  assert.equal(detalhe.faixas.length, 4);
  assert.equal(detalhe.valorTotalCentavos, calcularPrecoExportacaoCentavos(26000));
});

test('normalizarFiltros, gerarQueryHash e construirWhereEmpresas geram SQL seguro e determinístico', () => {
  const f1 = normalizarFiltros({
    uf: ['pr', 'sp', 'SP', 'XX'],
    cnaes_secundarios: [6209100, 6202300],
    somente_com_email: true,
    excluir_leads_ja_comprados: true,
  });
  const f2 = normalizarFiltros({
    excluir_leads_ja_comprados: true,
    somente_com_email: true,
    cnaes_secundarios: [6202300, 6209100],
    uf: ['SP', 'PR'],
  });

  assert.deepEqual(f1.uf, ['PR', 'SP']);
  assert.equal(gerarQueryHash(f1), gerarQueryHash(f2));

  const { whereSql, params } = construirWhereEmpresas(f1, 'user-123');
  assert.match(whereSql, /e\.situacao_cadastral = 2/);
  assert.match(whereSql, /e\.uf = ANY\(\$1::char\(2\)\[\]\)/);
  assert.match(whereSql, /e\.cnaes_secundarios && \$2::int\[\]/);
  assert.match(whereSql, /e\.possui_email = TRUE/);
  assert.match(whereSql, /NOT EXISTS \(SELECT 1 FROM leads_adquiridos_usuario/);
  assert.equal(params[2], 'user-123');
});

test('fluxo completo: cotação, checkout Stripe, webhook idempotente e worker streaming CSV', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'prospecta-test-'));
  const sampleRows: EmpresaExportRow[] = [
    {
      cnpj_completo: '11222333000181',
      razao_social: 'EMPRESA ALPHA LTDA',
      nome_fantasia: 'ALPHA',
      situacao_cadastral: 2,
      data_inicio_atividade: '2020-01-10',
      matriz_filial: 1,
      natureza_juridica: 2062,
      porte_empresa: 3,
      capital_social: '150000.00',
      opcao_simples: 'S',
      opcao_mei: 'N',
      cnae_fiscal_principal: 6201501,
      cnaes_secundarios: [6202300],
      regiao: 'Sudeste',
      uf: 'SP',
      codigo_municipio_ibge: 3550308,
      municipio_nome: 'SAO PAULO',
      bairro: 'BELA VISTA',
      cep: '01310100',
      logradouro: 'AVENIDA PAULISTA',
      numero: '1000',
      complemento: null,
      ddd_1: '11',
      telefone_1: '30001122',
      ddd_2: null,
      telefone_2: null,
      email: 'contato@alpha.exemplo.br',
    },
    {
      cnpj_completo: '22333444000152',
      razao_social: 'EMPRESA BETA INATIVA LTDA',
      nome_fantasia: 'BETA',
      situacao_cadastral: 4,
      data_inicio_atividade: '2019-05-01',
      matriz_filial: 1,
      natureza_juridica: 2062,
      porte_empresa: 2,
      capital_social: '20000.00',
      opcao_simples: 'N',
      opcao_mei: 'N',
      cnae_fiscal_principal: 6201501,
      cnaes_secundarios: null,
      regiao: 'Sudeste',
      uf: 'SP',
      codigo_municipio_ibge: 3550308,
      municipio_nome: 'SAO PAULO',
      bairro: 'CENTRO',
      cep: '01001000',
      logradouro: 'PRACA DA SE',
      numero: '10',
      complemento: null,
      ddd_1: '11',
      telefone_1: '31112222',
      ddd_2: null,
      telefone_2: null,
      email: 'contato@beta.exemplo.br',
    },
  ];

  const { repo, leadsAdquiridos } = createFakeRepo(sampleRows);
  const storage = new LocalExportStorage(tmpDir);
  const exportQueue = new InMemoryExportQueue({ db: repo, storage, batchSize: 1 });

  const fakeStripe = {
    checkout: {
      sessions: {
        async create() {
          return {
            id: 'cs_test_123',
            url: 'https://checkout.stripe.test/pay/cs_test_123',
          };
        },
      },
    },
    webhooks: {
      constructEvent(payload: string | Buffer, header: string | string[], _secret: string) {
        if (header !== 'sig_valid') {
          throw new Error('Invalid signature');
        }
        return JSON.parse(payload.toString('utf8')) as Stripe.Event;
      },
    },
  };

  const app = createApp({
    db: repo,
    storage,
    exportQueue,
    stripe: fakeStripe,
    webhookSecret: 'whsec_test',
    frontendUrl: 'http://localhost:3000',
  });

  const server = await startTestServer(app);
  try {
    // 1. Cotação deve contar apenas a empresa ativa
    const quoteRes = await fetch(`${server.baseUrl}/api/quotes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filtros: { uf: ['SP'] } }),
    });
    assert.equal(quoteRes.status, 200);
    const quoteJson = (await quoteRes.json()) as {
      quantidadeRegistros: number;
      valorTotalCentavos: number;
      amostra: EmpresaAmostra[];
    };
    assert.equal(quoteJson.quantidadeRegistros, 1);
    assert.equal(quoteJson.valorTotalCentavos, 1990);
    assert.equal(quoteJson.amostra.length, 1);

    // 2. Checkout em modo Stripe forçado cria pedido PENDING e retorna URL da sessão Stripe
    const checkoutRes = await fetch(`${server.baseUrl}/api/checkout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-force-stripe': 'true',
      },
      body: JSON.stringify({ filtros: { uf: ['SP'] }, formatoArquivo: 'xlsx' }),
    });
    assert.equal(checkoutRes.status, 201);
    const checkoutJson = (await checkoutRes.json()) as { pedidoId: string; checkoutUrl: string };
    assert.equal(checkoutJson.checkoutUrl, 'https://checkout.stripe.test/pay/cs_test_123');

    // 3. Webhook inválido é rejeitado com 400
    const badWebhookRes = await fetch(`${server.baseUrl}/webhooks/stripe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'stripe-signature': 'sig_invalid',
      },
      body: JSON.stringify({ id: 'evt_bad' }),
    });
    assert.equal(badWebhookRes.status, 400);

    // 4. Webhook válido processa pagamento e enfileira exportação
    const stripeEventPayload = JSON.stringify({
      id: 'evt_test_001',
      type: 'checkout.session.completed',
      data: {
        object: {
          payment_status: 'paid',
          payment_intent: 'pi_test_001',
          metadata: {
            pedido_id: checkoutJson.pedidoId,
            formato_arquivo: 'xlsx',
          },
        },
      },
    });

    const okWebhookRes = await fetch(`${server.baseUrl}/webhooks/stripe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'stripe-signature': 'sig_valid',
      },
      body: stripeEventPayload,
    });
    assert.equal(okWebhookRes.status, 200);
    const okWebhookJson = (await okWebhookRes.json()) as { received: boolean; duplicated?: boolean };
    assert.equal(okWebhookJson.received, true);
    assert.equal(okWebhookJson.duplicated, undefined);

    // 5. Reenvio do mesmo evento deve ser idempotente (duplicated: true)
    const dupWebhookRes = await fetch(`${server.baseUrl}/webhooks/stripe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'stripe-signature': 'sig_valid',
      },
      body: stripeEventPayload,
    });
    assert.equal(dupWebhookRes.status, 200);
    const dupWebhookJson = (await dupWebhookRes.json()) as { duplicated: boolean };
    assert.equal(dupWebhookJson.duplicated, true);

    // 6. Aguarda o worker finalizar e verifica pedido READY + arquivo CSV + deduplicação
    await exportQueue.waitForIdle();

    const pedidoRes = await fetch(`${server.baseUrl}/api/pedidos/${checkoutJson.pedidoId}`);
    assert.equal(pedidoRes.status, 200);
    const pedidoJson = (await pedidoRes.json()) as {
      pedido: PedidoExportacao;
      downloadUrl: string | null;
    };
    assert.equal(pedidoJson.pedido.status_pagamento, 'PAID');
    assert.equal(pedidoJson.pedido.status_arquivo, 'READY');
    assert.ok(pedidoJson.downloadUrl);

    const downloadRes = await fetch(`${server.baseUrl}${pedidoJson.downloadUrl}`);
    assert.equal(downloadRes.status, 200);
    const xlsxBuffer = Buffer.from(await downloadRes.arrayBuffer());
    assert.equal(xlsxBuffer.subarray(0, 2).toString('utf8'), 'PK');

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(xlsxBuffer as unknown as ArrayBuffer);
    const sheet = wb.getWorksheet('Empresas B2B');
    assert.ok(sheet);
    assert.equal(sheet.rowCount, 2);
    assert.equal(sheet.getRow(2).getCell(1).value, '11222333000181');
    assert.equal(sheet.getRow(2).getCell(2).value, 'EMPRESA ALPHA LTDA');
    assert.match(String(sheet.getRow(2).getCell(9).value), /R\$\s*150\.000,00/);

    // 7. Verifica deduplicação registrada e refletida em nova cotação com excluir_leads_ja_comprados
    const userSet = leadsAdquiridos.get('00000000-0000-4000-8000-000000000001');
    assert.ok(userSet?.has('11222333000181'));

    const quoteDedupRes = await fetch(`${server.baseUrl}/api/quotes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filtros: { uf: ['SP'], excluir_leads_ja_comprados: true },
      }),
    });
    const quoteDedupJson = (await quoteDedupRes.json()) as { quantidadeRegistros: number };
    assert.equal(quoteDedupJson.quantidadeRegistros, 0);

    // Garante chamada direta de processarExportacaoPedido sem erro
    const pedidoExtra = await repo.criarPedidoExportacao({
      usuario_id: '00000000-0000-4000-8000-000000000001',
      filtros_json: { uf: ['SP'] },
      query_hash: 'hash-extra',
      quantidade_registros: 1,
      valor_total_centavos: 1990,
    });
    const resultExtra = await processarExportacaoPedido(
      { pedidoId: pedidoExtra.id, formatoArquivo: 'csv' },
      { db: repo, storage },
    );
    assert.equal(resultExtra.totalExportado, 1);
  } finally {
    await server.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('GET /api/cnaes e exportação gratuita em localhost preservando cálculo de preço', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'prospecta-localhost-'));
  const sampleRows: EmpresaExportRow[] = [
    {
      cnpj_completo: '11222333000181',
      razao_social: 'EMPRESA ALPHA LTDA',
      nome_fantasia: 'ALPHA',
      situacao_cadastral: 2,
      data_inicio_atividade: '2020-01-10',
      matriz_filial: 1,
      natureza_juridica: 2062,
      porte_empresa: 3,
      capital_social: '150000.00',
      opcao_simples: 'S',
      opcao_mei: 'N',
      cnae_fiscal_principal: 6201501,
      cnaes_secundarios: [6202300],
      regiao: 'Sudeste',
      uf: 'SP',
      codigo_municipio_ibge: 3550308,
      municipio_nome: 'SAO PAULO',
      bairro: 'BELA VISTA',
      cep: '01310100',
      logradouro: 'AVENIDA PAULISTA',
      numero: '1000',
      complemento: null,
      ddd_1: '11',
      telefone_1: '30001122',
      ddd_2: null,
      telefone_2: null,
      email: 'contato@alpha.exemplo.br',
    },
  ];

  const { repo } = createFakeRepo(sampleRows);
  const storage = new LocalExportStorage(tmpDir);
  const exportQueue = new InMemoryExportQueue({ db: repo, storage });

  const app = createApp({
    db: repo,
    storage,
    exportQueue,
    stripe: null,
    frontendUrl: 'http://localhost:3000',
  });

  const server = await startTestServer(app);
  try {
    // 1. Lista expandida de CNAEs e localidades disponíveis via API
    const cnaesRes = await fetch(`${server.baseUrl}/api/cnaes`);
    assert.equal(cnaesRes.status, 200);
    const cnaesJson = (await cnaesRes.json()) as {
      cnaes: Array<{ codigo: number; codigoFormatado: string; descricao: string }>;
    };
    assert.ok(cnaesJson.cnaes.length >= 100);
    assert.ok(cnaesJson.cnaes.some((c) => c.codigo === 6201501));

    const locAllRes = await fetch(`${server.baseUrl}/api/localidades`);
    assert.equal(locAllRes.status, 200);
    const locAllJson = (await locAllRes.json()) as {
      estados: Array<{ sigla: string; nome: string; regiao: string }>;
      municipios: Array<{ codigo_ibge: number; nome: string; uf: string }>;
    };
    assert.equal(locAllJson.estados.length, 27);
    assert.ok(locAllJson.municipios.length > 50);

    const locSpPrRes = await fetch(`${server.baseUrl}/api/localidades?uf=SP,PR`);
    assert.equal(locSpPrRes.status, 200);
    const locSpPrJson = (await locSpPrRes.json()) as {
      municipios: Array<{ codigo_ibge: number; nome: string; uf: string }>;
    };
    assert.ok(locSpPrJson.municipios.length >= 30);
    assert.ok(locSpPrJson.municipios.every((m) => m.uf === 'SP' || m.uf === 'PR'));
    assert.ok(locSpPrJson.municipios.some((m) => m.codigo_ibge === 3550308));
    assert.ok(locSpPrJson.municipios.some((m) => m.codigo_ibge === 4106902));

    // 2. Em localhost (127.0.0.1), exporta XLSX sem Stripe mesmo com valor exibido calculado
    const checkoutRes = await fetch(`${server.baseUrl}/api/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filtros: {
          regiao: ['Sudeste', 'Sul'],
          uf: ['SP', 'PR'],
          codigo_municipio_ibge: [3550308, 4106902],
          cnae_fiscal_principal: [6201501, 4930202],
        },
        formatoArquivo: 'xlsx',
      }),
    });
    assert.equal(checkoutRes.status, 201);
    const checkoutJson = (await checkoutRes.json()) as {
      pedidoId: string;
      valorTotalCentavos: number;
      modoLocalhost: boolean;
    };
    assert.equal(checkoutJson.modoLocalhost, true);
    assert.equal(checkoutJson.valorTotalCentavos, 1990);

    await exportQueue.waitForIdle();

    const pedidoRes = await fetch(`${server.baseUrl}/api/pedidos/${checkoutJson.pedidoId}`);
    assert.equal(pedidoRes.status, 200);
    const pedidoJson = (await pedidoRes.json()) as {
      pedido: PedidoExportacao;
      downloadUrl: string | null;
    };
    assert.equal(pedidoJson.pedido.status_pagamento, 'PAID');
    assert.equal(pedidoJson.pedido.status_arquivo, 'READY');
    assert.ok(pedidoJson.downloadUrl?.endsWith('.xlsx'));

    const xlsxRes = await fetch(`${server.baseUrl}${pedidoJson.downloadUrl}`);
    assert.equal(xlsxRes.status, 200);
    const xlsxBuf = Buffer.from(await xlsxRes.arrayBuffer());
    assert.equal(xlsxBuf.subarray(0, 2).toString('utf8'), 'PK');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(xlsxBuf as unknown as ArrayBuffer);
    assert.equal(wb.getWorksheet('Empresas B2B')?.getRow(2).getCell(1).value, '11222333000181');

    const etlStatusRes = await fetch(`${server.baseUrl}/api/etl/status`);
    assert.equal(etlStatusRes.status, 200);
    const etlStatusJson = (await etlStatusRes.json()) as {
      total_empresas: number;
      total_ativas: number;
    };
    assert.equal(etlStatusJson.total_empresas, 1);
    assert.equal(etlStatusJson.total_ativas, 1);
  } finally {
    await server.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('ETL RFB faz parse oficial e atualiza periodicamente novas empresas e encerramentos', async () => {
  assert.deepEqual(
    parseSemicolonCsvLine('"60000001";"EMPRESA ""A""; LTDA";2062;;"150000,50";03;""'),
    ['60000001', 'EMPRESA "A"; LTDA', '2062', '', '150000,50', '03', ''],
  );
  assert.equal(parseCapitalSocial('250000,00'), '250000.00');
  assert.equal(parseDataRfb('20200115'), '2020-01-15');
  assert.equal(parseDataRfb('00000000'), null);
  assert.deepEqual(parseCnaesSecundarios('6202300,6209100'), [6202300, 6209100]);

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'prospecta-etl-'));
  try {
    const gerado = await gerarLoteRfbOficialCsv(tmpDir, 8);
    assert.equal(gerado.empresasCount, 8);

    const store = new Map<string, { cnpj_completo: string; uf: string; situacao: number }>();
    let execCounter = 0;

    const fakePool = {
      async query(sql: string, params?: unknown[]) {
        if (sql.includes('INSERT INTO etl_execucoes')) {
          execCounter += 1;
          return { rows: [{ id: String(execCounter) }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
      async connect() {
        return {
          async query(sql: string, params?: unknown[]) {
            if (sql.includes('INSERT INTO empresas_prospect') && Array.isArray(params)) {
              const cnpjs = params[3] as string[];
              const situacoes = params[6] as number[];
              const ufs = params[17] as string[];
              for (let i = 0; i < cnpjs.length; i += 1) {
                store.set(`${cnpjs[i]}|${ufs[i]}`, {
                  cnpj_completo: cnpjs[i],
                  uf: ufs[i],
                  situacao: situacoes[i],
                });
              }
            }
            return { rows: [], rowCount: 0 };
          },
          release() {},
        };
      },
    };

    const res1 = await executarEtlRfb({
      pool: fakePool as unknown as import('pg').Pool,
      dataDir: tmpDir,
      batchSize: 4,
    });
    assert.equal(res1.totalProcessados, 8);
    assert.equal(store.size, 8);

    // Simula atualização periódica: empresa 60000000 é encerrada (08) e uma nova (60000099) é cadastrada (02)
    await fs.writeFile(
      path.join(tmpDir, 'Empresas0.csv'),
      '"60000000";"EMPRESA ZERO LTDA";"2062";"49";"100000,00";"03";""\n' +
        '"60000099";"NOVA EMPRESA CADASTRADA LTDA";"2062";"49";"50000,00";"02";""\n',
      'utf8',
    );
    await fs.writeFile(
      path.join(tmpDir, 'Estabelecimentos0.csv'),
      '"60000000";"0001";"10";"1";"ZERO";"08";"20261124";"01";"";"105";"20180101";"6201501";"";"AV";"PAULISTA";"100";"";"BELA VISTA";"01310100";"SP";"3550308";"11";"30001111";"";"";"";"";"a@b.br";"";""\n' +
        '"60000099";"0001";"99";"1";"NOVA";"02";"20261124";"00";"";"105";"20261124";"6201501";"";"AV";"BRASIL";"200";"";"CENTRO";"01001000";"SP";"3550308";"11";"30002222";"";"";"";"";"n@b.br";"";""\n',
      'utf8',
    );
    await fs.writeFile(path.join(tmpDir, 'Simples.csv'), '', 'utf8');
    await fs.writeFile(path.join(tmpDir, 'Socios0.csv'), '', 'utf8');

    const res2 = await executarEtlRfb({
      pool: fakePool as unknown as import('pg').Pool,
      dataDir: tmpDir,
      batchSize: 4,
    });
    assert.equal(res2.totalProcessados, 2);
    assert.equal(res2.totalAtivos, 1);
    assert.equal(res2.totalEncerradosOuInativos, 1);
    assert.equal(store.get('60000000000110|SP')?.situacao, 8);
    assert.equal(store.get('60000099000199|SP')?.situacao, 2);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
