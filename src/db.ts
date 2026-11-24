import { Pool } from 'pg';
import QueryStream from 'pg-query-stream';
import { construirWhereEmpresas } from './filters.js';
import {
  EmpresaAmostra,
  EmpresaExportRow,
  EtlExecucaoRegistro,
  EtlResumoStatus,
  FiltrosProspeccao,
  PedidoExportacao,
  UsuarioAutenticado,
} from './types.js';

export interface CriarPedidoInput {
  usuario_id: string;
  filtros_json: FiltrosProspeccao;
  query_hash: string;
  quantidade_registros: number;
  valor_total_centavos: number;
}

export interface RegistrarWebhookPagamentoInput {
  event_id: string;
  event_type: string;
  pedido_id: string;
  stripe_payment_intent_id: string | null;
}

export interface DbRepository {
  contarEmpresasComFiltros(filtros: FiltrosProspeccao, usuarioId?: string): Promise<number>;
  buscarAmostraEmpresas(
    filtros: FiltrosProspeccao,
    usuarioId?: string,
    limite?: number,
  ): Promise<EmpresaAmostra[]>;
  criarPedidoExportacao(input: CriarPedidoInput): Promise<PedidoExportacao>;
  atualizarSessaoStripePedido(pedidoId: string, stripeSessionId: string): Promise<void>;
  buscarPedidoPorId(pedidoId: string, usuarioId?: string): Promise<PedidoExportacao | null>;
  listarPedidosUsuario(usuarioId: string): Promise<PedidoExportacao[]>;
  registrarPagamentoWebhookIdempotente(
    input: RegistrarWebhookPagamentoInput,
  ): Promise<{ duplicated: boolean }>;
  marcarPedidoArquivoPronto(pedidoId: string, s3FileKey: string, expiraEm: Date): Promise<void>;
  marcarPedidoArquivoFalhou(pedidoId: string): Promise<void>;
  inserirLeadsAdquiridosEmLote(
    usuarioId: string,
    pedidoId: string,
    cnpjs: string[],
  ): Promise<void>;
  streamEmpresasParaExportacao(
    filtros: FiltrosProspeccao,
    usuarioId: string,
    batchSize?: number,
  ): AsyncIterable<EmpresaExportRow>;
  garantirUsuario(usuario: UsuarioAutenticado): Promise<void>;
  obterResumoEtl(): Promise<EtlResumoStatus>;
  verificarSaude(): Promise<boolean>;
  close(): Promise<void>;
}

const COLUNAS_EXPORTACAO = `
  e.cnpj_completo,
  e.razao_social,
  e.nome_fantasia,
  e.situacao_cadastral,
  TO_CHAR(e.data_inicio_atividade, 'YYYY-MM-DD') AS data_inicio_atividade,
  e.matriz_filial,
  e.natureza_juridica,
  e.porte_empresa,
  e.capital_social::text AS capital_social,
  e.opcao_simples,
  e.opcao_mei,
  e.cnae_fiscal_principal,
  e.cnaes_secundarios,
  e.regiao,
  e.uf,
  e.codigo_municipio_ibge,
  e.municipio_nome,
  e.bairro,
  e.cep,
  e.logradouro,
  e.numero,
  e.complemento,
  e.ddd_1,
  e.telefone_1,
  e.ddd_2,
  e.telefone_2,
  e.email
`;

function mascararCnpj(cnpj: string): string {
  const limpo = cnpj.trim();
  if (limpo.length !== 14) return limpo;
  return `${limpo.slice(0, 2)}.***.***/${limpo.slice(8, 12)}-${limpo.slice(12, 14)}`;
}

export class PostgresRepository implements DbRepository {
  constructor(private readonly pool: Pool) {}

  async contarEmpresasComFiltros(
    filtros: FiltrosProspeccao,
    usuarioId?: string,
  ): Promise<number> {
    const { whereSql, params } = construirWhereEmpresas(filtros, usuarioId);
    const sql = `SELECT COUNT(*)::bigint AS total FROM empresas_prospect e WHERE ${whereSql}`;
    const result = await this.pool.query<{ total: string }>(sql, params);
    return Number(result.rows[0]?.total ?? 0);
  }

  async buscarAmostraEmpresas(
    filtros: FiltrosProspeccao,
    usuarioId?: string,
    limite = 5,
  ): Promise<EmpresaAmostra[]> {
    const { whereSql, params } = construirWhereEmpresas(filtros, usuarioId);
    params.push(Math.max(1, Math.min(limite, 20)));
    const limitParam = `$${params.length}`;

    const sql = `
      SELECT
        e.cnpj_completo,
        e.razao_social,
        e.nome_fantasia,
        e.uf,
        e.municipio_nome,
        e.cnae_fiscal_principal,
        e.porte_empresa,
        e.capital_social::text AS capital_social,
        e.possui_email,
        e.possui_telefone
      FROM empresas_prospect e
      WHERE ${whereSql}
      ORDER BY e.capital_social DESC, e.cnpj_completo ASC
      LIMIT ${limitParam}
    `;

    const result = await this.pool.query<{
      cnpj_completo: string;
      razao_social: string;
      nome_fantasia: string | null;
      uf: string;
      municipio_nome: string;
      cnae_fiscal_principal: number;
      porte_empresa: number | null;
      capital_social: string;
      possui_email: boolean;
      possui_telefone: boolean;
    }>(sql, params);

    return result.rows.map((row) => ({
      cnpj_mascarado: mascararCnpj(row.cnpj_completo),
      razao_social: row.razao_social,
      nome_fantasia: row.nome_fantasia,
      uf: row.uf,
      municipio_nome: row.municipio_nome,
      cnae_fiscal_principal: row.cnae_fiscal_principal,
      porte_empresa: row.porte_empresa,
      capital_social: row.capital_social,
      possui_email: row.possui_email,
      possui_telefone: row.possui_telefone,
    }));
  }

  async criarPedidoExportacao(input: CriarPedidoInput): Promise<PedidoExportacao> {
    const sql = `
      INSERT INTO pedidos_exportacao (
        usuario_id,
        filtros_json,
        query_hash,
        quantidade_registros,
        valor_total_centavos,
        status_pagamento,
        status_arquivo
      )
      VALUES ($1, $2::jsonb, $3, $4, $5, 'PENDING', 'WAITING_PAYMENT')
      RETURNING *
    `;

    const result = await this.pool.query<PedidoExportacao>(sql, [
      input.usuario_id,
      JSON.stringify(input.filtros_json),
      input.query_hash,
      input.quantidade_registros,
      input.valor_total_centavos,
    ]);

    return result.rows[0];
  }

  async atualizarSessaoStripePedido(pedidoId: string, stripeSessionId: string): Promise<void> {
    await this.pool.query(
      `UPDATE pedidos_exportacao SET stripe_session_id = $2 WHERE id = $1`,
      [pedidoId, stripeSessionId],
    );
  }

  async buscarPedidoPorId(pedidoId: string, usuarioId?: string): Promise<PedidoExportacao | null> {
    const sql = usuarioId
      ? `SELECT * FROM pedidos_exportacao WHERE id = $1 AND usuario_id = $2`
      : `SELECT * FROM pedidos_exportacao WHERE id = $1`;
    const params = usuarioId ? [pedidoId, usuarioId] : [pedidoId];
    const result = await this.pool.query<PedidoExportacao>(sql, params);
    return result.rows[0] ?? null;
  }

  async listarPedidosUsuario(usuarioId: string): Promise<PedidoExportacao[]> {
    const result = await this.pool.query<PedidoExportacao>(
      `SELECT * FROM pedidos_exportacao WHERE usuario_id = $1 ORDER BY criado_em DESC LIMIT 50`,
      [usuarioId],
    );
    return result.rows;
  }

  async registrarPagamentoWebhookIdempotente(
    input: RegistrarWebhookPagamentoInput,
  ): Promise<{ duplicated: boolean }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const inserted = await client.query<{ event_id: string }>(
        `
          INSERT INTO stripe_webhook_events (event_id, event_type)
          VALUES ($1, $2)
          ON CONFLICT (event_id) DO NOTHING
          RETURNING event_id
        `,
        [input.event_id, input.event_type],
      );

      if (inserted.rowCount === 0) {
        await client.query('ROLLBACK');
        return { duplicated: true };
      }

      await client.query(
        `
          UPDATE pedidos_exportacao
          SET
            status_pagamento = 'PAID',
            status_arquivo = 'PROCESSING',
            stripe_payment_intent_id = $2,
            pago_em = CURRENT_TIMESTAMP
          WHERE id = $1
        `,
        [input.pedido_id, input.stripe_payment_intent_id],
      );

      await client.query('COMMIT');
      return { duplicated: false };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async marcarPedidoArquivoPronto(
    pedidoId: string,
    s3FileKey: string,
    expiraEm: Date,
  ): Promise<void> {
    await this.pool.query(
      `
        UPDATE pedidos_exportacao
        SET status_arquivo = 'READY', s3_file_key = $2, expira_em = $3
        WHERE id = $1
      `,
      [pedidoId, s3FileKey, expiraEm],
    );
  }

  async marcarPedidoArquivoFalhou(pedidoId: string): Promise<void> {
    await this.pool.query(
      `UPDATE pedidos_exportacao SET status_arquivo = 'FAILED' WHERE id = $1`,
      [pedidoId],
    );
  }

  async inserirLeadsAdquiridosEmLote(
    usuarioId: string,
    pedidoId: string,
    cnpjs: string[],
  ): Promise<void> {
    if (cnpjs.length === 0) return;
    await this.pool.query(
      `
        INSERT INTO leads_adquiridos_usuario (usuario_id, cnpj_completo, pedido_id)
        SELECT $1, UNNEST($2::char(14)[]), $3
        ON CONFLICT (usuario_id, cnpj_completo) DO NOTHING
      `,
      [usuarioId, cnpjs, pedidoId],
    );
  }

  async *streamEmpresasParaExportacao(
    filtros: FiltrosProspeccao,
    usuarioId: string,
    batchSize = 5000,
  ): AsyncIterable<EmpresaExportRow> {
    const { whereSql, params } = construirWhereEmpresas(filtros, usuarioId);
    const sql = `SELECT ${COLUNAS_EXPORTACAO} FROM empresas_prospect e WHERE ${whereSql}`;

    const client = await this.pool.connect();
    try {
      const queryStream = new QueryStream(sql, params, { batchSize });
      const stream = client.query(queryStream);

      for await (const row of stream) {
        yield row as EmpresaExportRow;
      }
    } finally {
      client.release();
    }
  }

  async garantirUsuario(usuario: UsuarioAutenticado): Promise<void> {
    await this.pool.query(
      `
        INSERT INTO usuarios (id, email, nome, senha_hash)
        VALUES ($1, $2, $3, 'dev-placeholder')
        ON CONFLICT (id) DO NOTHING
      `,
      [usuario.id, usuario.email, usuario.nome ?? 'Usuário Prospecta'],
    );
  }

  async obterResumoEtl(): Promise<EtlResumoStatus> {
    const countsRes = await this.pool.query<{
      total: string;
      ativas: string;
      inativas: string;
    }>(`
      SELECT
        COUNT(*)::bigint AS total,
        COUNT(*) FILTER (WHERE situacao_cadastral = 2)::bigint AS ativas,
        COUNT(*) FILTER (WHERE situacao_cadastral <> 2)::bigint AS inativas
      FROM empresas_prospect
    `);

    let ultimaExecucao: EtlExecucaoRegistro | null = null;
    try {
      const execRes = await this.pool.query<EtlExecucaoRegistro>(
        `SELECT * FROM etl_execucoes ORDER BY id DESC LIMIT 1`,
      );
      ultimaExecucao = execRes.rows[0] ?? null;
    } catch {
      ultimaExecucao = null;
    }

    const row = countsRes.rows[0];
    return {
      total_empresas: Number(row?.total ?? 0),
      total_ativas: Number(row?.ativas ?? 0),
      total_encerradas_ou_inativas: Number(row?.inativas ?? 0),
      ultima_execucao: ultimaExecucao,
    };
  }

  async verificarSaude(): Promise<boolean> {
    const result = await this.pool.query('SELECT 1 AS ok');
    return result.rowCount === 1;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

export function createPoolFromEnv(): Pool {
  const connectionString =
    process.env.DATABASE_URL ??
    'postgres://prospecta:prospecta@localhost:5432/prospecta_brasil';
  return new Pool({ connectionString });
}
