import { PassThrough } from 'node:stream';
import ExcelJS from 'exceljs';
import { DbRepository } from './db.js';
import { formatarBRL } from './pricing.js';
import { ExportStorage } from './storage.js';
import { EmpresaExportRow, ExportJobPayload } from './types.js';

export interface ExportQueue {
  add(jobName: 'gerar-planilha-leads', payload: ExportJobPayload): Promise<void>;
}

export interface WorkerDependencies {
  db: DbRepository;
  storage: ExportStorage;
  batchSize?: number;
}

const DEFAULT_BATCH_SIZE = 5000;
const EXPIRATION_HOURS = 24;

function formatarCapitalSocialBrl(capitalSocial: string): string {
  const valor = Number(capitalSocial);
  if (!Number.isFinite(valor)) return formatarBRL(0);
  return formatarBRL(Math.round(valor * 100));
}

function formatarLinhaPlanilha(row: EmpresaExportRow): Record<string, string | number> {
  return {
    cnpj_completo: row.cnpj_completo,
    razao_social: row.razao_social,
    nome_fantasia: row.nome_fantasia ?? '',
    situacao_cadastral: row.situacao_cadastral,
    data_inicio_atividade: row.data_inicio_atividade ?? '',
    matriz_filial: row.matriz_filial ?? '',
    natureza_juridica: row.natureza_juridica ?? '',
    porte_empresa: row.porte_empresa ?? '',
    capital_social: formatarCapitalSocialBrl(row.capital_social),
    opcao_simples: row.opcao_simples ?? '',
    opcao_mei: row.opcao_mei ?? '',
    cnae_fiscal_principal: row.cnae_fiscal_principal,
    cnaes_secundarios: row.cnaes_secundarios ? row.cnaes_secundarios.join(';') : '',
    regiao: row.regiao,
    uf: row.uf,
    codigo_municipio_ibge: row.codigo_municipio_ibge,
    municipio_nome: row.municipio_nome,
    bairro: row.bairro ?? '',
    cep: row.cep ?? '',
    logradouro: row.logradouro ?? '',
    numero: row.numero ?? '',
    complemento: row.complemento ?? '',
    ddd_1: row.ddd_1 ?? '',
    telefone_1: row.telefone_1 ?? '',
    ddd_2: row.ddd_2 ?? '',
    telefone_2: row.telefone_2 ?? '',
    email: row.email ?? '',
  };
}

/**
 * Executa a exportação em streaming (PostgreSQL cursor -> ExcelJS WorkbookWriter -> S3/Local)
 * e registra os CNPJs adquiridos em lotes para deduplicação futura.
 */
export async function processarExportacaoPedido(
  payload: ExportJobPayload,
  deps: WorkerDependencies,
): Promise<{ s3FileKey: string; totalExportado: number }> {
  const { db, storage, batchSize = DEFAULT_BATCH_SIZE } = deps;
  const pedido = await db.buscarPedidoPorId(payload.pedidoId);

  if (!pedido) {
    throw new Error(`Pedido não encontrado para exportação: ${payload.pedidoId}`);
  }

  const s3FileKey = `exports/${pedido.usuario_id}/${pedido.id}.xlsx`;
  const passThrough = new PassThrough();
  const uploadPromise = storage.uploadStream(
    s3FileKey,
    passThrough,
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  );

  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
    stream: passThrough,
    useStyles: true,
    useSharedStrings: false,
  });

  const worksheet = workbook.addWorksheet('Empresas B2B');
  worksheet.columns = [
    { header: 'CNPJ Completo', key: 'cnpj_completo', width: 18 },
    { header: 'Razão Social', key: 'razao_social', width: 42 },
    { header: 'Nome Fantasia', key: 'nome_fantasia', width: 30 },
    { header: 'Situação Cadastral', key: 'situacao_cadastral', width: 18 },
    { header: 'Data Início Atividade', key: 'data_inicio_atividade', width: 20 },
    { header: 'Matriz/Filial', key: 'matriz_filial', width: 14 },
    { header: 'Natureza Jurídica', key: 'natureza_juridica', width: 18 },
    { header: 'Porte Empresa', key: 'porte_empresa', width: 14 },
    { header: 'Capital Social', key: 'capital_social', width: 20 },
    { header: 'Optante Simples', key: 'opcao_simples', width: 15 },
    { header: 'Optante MEI', key: 'opcao_mei', width: 13 },
    { header: 'CNAE Principal', key: 'cnae_fiscal_principal', width: 15 },
    { header: 'CNAEs Secundários', key: 'cnaes_secundarios', width: 24 },
    { header: 'Região', key: 'regiao', width: 15 },
    { header: 'UF', key: 'uf', width: 6 },
    { header: 'Código Município IBGE', key: 'codigo_municipio_ibge', width: 20 },
    { header: 'Município', key: 'municipio_nome', width: 26 },
    { header: 'Bairro', key: 'bairro', width: 22 },
    { header: 'CEP', key: 'cep', width: 12 },
    { header: 'Logradouro', key: 'logradouro', width: 34 },
    { header: 'Número', key: 'numero', width: 10 },
    { header: 'Complemento', key: 'complemento', width: 22 },
    { header: 'DDD 1', key: 'ddd_1', width: 8 },
    { header: 'Telefone 1', key: 'telefone_1', width: 16 },
    { header: 'DDD 2', key: 'ddd_2', width: 8 },
    { header: 'Telefone 2', key: 'telefone_2', width: 16 },
    { header: 'E-mail', key: 'email', width: 32 },
  ];

  let loteCnpjs: string[] = [];
  let totalExportado = 0;

  try {
    for await (const row of db.streamEmpresasParaExportacao(
      pedido.filtros_json,
      pedido.usuario_id,
      batchSize,
    )) {
      const linha = formatarLinhaPlanilha(row);
      worksheet.addRow(linha).commit();

      totalExportado += 1;
      loteCnpjs.push(row.cnpj_completo);

      if (loteCnpjs.length >= batchSize) {
        await db.inserirLeadsAdquiridosEmLote(pedido.usuario_id, pedido.id, loteCnpjs);
        loteCnpjs = [];
      }
    }

    if (loteCnpjs.length > 0) {
      await db.inserirLeadsAdquiridosEmLote(pedido.usuario_id, pedido.id, loteCnpjs);
    }

    worksheet.commit();
    await workbook.commit();
    await uploadPromise;

    const expiraEm = new Date(Date.now() + EXPIRATION_HOURS * 60 * 60 * 1000);
    await db.marcarPedidoArquivoPronto(pedido.id, s3FileKey, expiraEm);

    return { s3FileKey, totalExportado };
  } catch (error) {
    passThrough.destroy(error instanceof Error ? error : new Error(String(error)));
    await uploadPromise.catch(() => undefined);
    await db.marcarPedidoArquivoFalhou(pedido.id).catch(() => undefined);
    throw error;
  }
}

/**
 * Fila em memória para execução imediata em processo único.
 * ponytail: fila em memória; substituir por BullMQ/SQS quando houver múltiplos workers.
 */
export class InMemoryExportQueue implements ExportQueue {
  private readonly pendingJobs = new Set<Promise<void>>();

  constructor(private readonly deps: WorkerDependencies) {}

  async add(jobName: 'gerar-planilha-leads', payload: ExportJobPayload): Promise<void> {
    if (jobName !== 'gerar-planilha-leads') {
      throw new Error(`Job desconhecido: ${jobName}`);
    }

    const jobPromise = new Promise<void>((resolve) => {
      setImmediate(async () => {
        try {
          await processarExportacaoPedido(payload, this.deps);
        } catch (err) {
          console.error(`Falha no worker de exportação (pedido ${payload.pedidoId}):`, err);
        } finally {
          resolve();
        }
      });
    });

    this.pendingJobs.add(jobPromise);
    void jobPromise.finally(() => this.pendingJobs.delete(jobPromise));
  }

  async waitForIdle(): Promise<void> {
    await Promise.all(Array.from(this.pendingJobs));
  }
}
