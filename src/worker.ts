import { once } from 'events';
import { format } from 'fast-csv';
import { DbRepository } from './db.js';
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

function formatarLinhaCsv(row: EmpresaExportRow): Record<string, string | number> {
  return {
    cnpj_completo: row.cnpj_completo,
    razao_social: row.razao_social,
    nome_fantasia: row.nome_fantasia ?? '',
    situacao_cadastral: row.situacao_cadastral,
    data_inicio_atividade: row.data_inicio_atividade ?? '',
    matriz_filial: row.matriz_filial ?? '',
    natureza_juridica: row.natureza_juridica ?? '',
    porte_empresa: row.porte_empresa ?? '',
    capital_social: row.capital_social,
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
 * Executa a exportação em streaming (PostgreSQL cursor -> fast-csv -> S3/Local)
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

  const s3FileKey = `exports/${pedido.usuario_id}/${pedido.id}.csv`;
  const csvStream = format({ headers: true, writeBOM: true });
  const uploadPromise = storage.uploadStream(s3FileKey, csvStream, 'text/csv; charset=utf-8');

  let loteCnpjs: string[] = [];
  let totalExportado = 0;

  try {
    for await (const row of db.streamEmpresasParaExportacao(
      pedido.filtros_json,
      pedido.usuario_id,
      batchSize,
    )) {
      const linha = formatarLinhaCsv(row);
      if (!csvStream.write(linha)) {
        await once(csvStream, 'drain');
      }

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

    csvStream.end();
    await uploadPromise;

    const expiraEm = new Date(Date.now() + EXPIRATION_HOURS * 60 * 60 * 1000);
    await db.marcarPedidoArquivoPronto(pedido.id, s3FileKey, expiraEm);

    return { s3FileKey, totalExportado };
  } catch (error) {
    csvStream.destroy(error instanceof Error ? error : new Error(String(error)));
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
