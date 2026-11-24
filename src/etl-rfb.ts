import 'dotenv/config';
import { execFile } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { promisify } from 'node:util';
import { Pool, PoolClient } from 'pg';

import { CATALOGO_CNAES } from './cnaes.js';
import { createPoolFromEnv } from './db.js';
import { ESTADOS_BRASIL, MUNICIPIOS_BRASIL } from './localidades.js';

const execFileAsync = promisify(execFile);

const ESTADOS_POR_SIGLA = new Map(ESTADOS_BRASIL.map((e) => [e.sigla, e]));
const MUNICIPIOS_POR_CODIGO = new Map(MUNICIPIOS_BRASIL.map((m) => [m.codigo_ibge, m]));

export interface EmpresaUpsertRecord {
  cnpj_basico: string;
  cnpj_ordem: string;
  cnpj_dv: string;
  cnpj_completo: string;
  razao_social: string;
  nome_fantasia: string | null;
  situacao_cadastral: number;
  data_inicio_atividade: string | null;
  matriz_filial: number | null;
  natureza_juridica: number | null;
  porte_empresa: number | null;
  capital_social: string;
  opcao_simples: string | null;
  opcao_mei: string | null;
  cnae_fiscal_principal: number;
  cnaes_secundarios: number[] | null;
  regiao: string;
  uf: string;
  codigo_municipio_ibge: number;
  municipio_nome: string;
  bairro: string | null;
  cep: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  ddd_1: string | null;
  telefone_1: string | null;
  ddd_2: string | null;
  telefone_2: string | null;
  email: string | null;
}

export interface SocioInsertRecord {
  cnpj_basico: string;
  nome_socio: string;
  cpf_cnpj_mascarado: string | null;
  qualificacao_socio: number | null;
  faixa_etaria: number | null;
}

export interface EtlOptions {
  pool: Pool;
  dataDir?: string;
  downloadRemote?: boolean;
  baseUrl?: string;
  competencia?: string;
  batchSize?: number;
  totalInicialSintetico?: number;
}

export interface EtlResultado {
  execucaoId: number;
  competencia: string;
  modo: string;
  totalProcessados: number;
  totalAtivos: number;
  totalEncerradosOuInativos: number;
  totalSocios: number;
}

interface EmpresaBasicoInfo {
  razao_social: string;
  natureza_juridica: number | null;
  capital_social: string;
  porte_empresa: number | null;
}

interface SimplesInfo {
  opcao_simples: 'S' | 'N';
  opcao_mei: 'S' | 'N';
}

export function parseSemicolonCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ';' && !inQuotes) {
      fields.push(current);
      current = '';
    } else if (ch !== '\r') {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

export function parseCapitalSocial(raw: string | undefined): string {
  if (!raw) return '0.00';
  const cleaned = raw.trim().replace(/\./g, '').replace(',', '.');
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed) || parsed < 0) return '0.00';
  return parsed.toFixed(2);
}

export function parseDataRfb(raw: string | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed === '00000000') return null;
  if (/^\d{8}$/.test(trimmed)) {
    const yyyy = trimmed.slice(0, 4);
    const mm = trimmed.slice(4, 6);
    const dd = trimmed.slice(6, 8);
    const month = Number(mm);
    const day = Number(dd);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${yyyy}-${mm}-${dd}`;
    }
    return null;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }
  return null;
}

export function parseCnaesSecundarios(raw: string | undefined): number[] | null {
  if (!raw) return null;
  const itens = Array.from(
    new Set(
      raw
        .split(',')
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isInteger(n) && n > 0),
    ),
  );
  return itens.length > 0 ? itens : null;
}

function truncar(val: string | undefined, max: number): string | null {
  if (!val) return null;
  const t = val.trim();
  if (!t) return null;
  return t.slice(0, max);
}

function parseIntOrNull(val: string | undefined): number | null {
  if (!val) return null;
  const n = Number(val.trim());
  return Number.isInteger(n) ? n : null;
}

function criarLinhaCsv(campos: Array<string | number | null | undefined>): string {
  return (
    campos
      .map((campo) => {
        const s = campo === null || campo === undefined ? '' : String(campo);
        return `"${s.replace(/"/g, '""')}"`;
      })
      .join(';') + '\n'
  );
}

/**
 * Gera um conjunto inicial de arquivos CSV no layout oficial da Receita Federal
 * cobrindo todas as 27 UFs, cidades e CNAEs da plataforma para carga local imediata.
 */
export async function gerarLoteRfbOficialCsv(
  dataDir: string,
  totalEmpresas = 60000,
): Promise<{ empresasCount: number; sociosCount: number }> {
  await mkdir(dataDir, { recursive: true });

  const empresasStream = createWriteStream(path.join(dataDir, 'Empresas0.csv'), 'utf8');
  const simplesStream = createWriteStream(path.join(dataDir, 'Simples.csv'), 'utf8');
  const estabStream = createWriteStream(path.join(dataDir, 'Estabelecimentos0.csv'), 'utf8');
  const sociosStream = createWriteStream(path.join(dataDir, 'Socios0.csv'), 'utf8');

  const prefixosRazao = [
    'BRASIL', 'NACIONAL', 'HORIZONTE', 'ATUAL', 'ALIANCA', 'INTEGRADA',
    'PRIME', 'NOVA', 'CENTRAL', 'VANGUARDA', 'SUL', 'NORTE', 'SOLUCOES',
    'AVANCADA', 'ESTRATEGICA', 'MODERNA', 'MERCANTIL', 'EXPRESSO',
  ];
  const sufixosRazao = ['LTDA', 'SA', 'ME', 'EPP', 'SERVICOS LTDA', 'COMERCIO LTDA'];
  const logradouros = [
    'AVENIDA BRASIL', 'RUA QUINZE DE NOVEMBRO', 'AVENIDA PAULISTA',
    'RUA DAS FLORES', 'AVENIDA GETULIO VARGAS', 'RUA TIRADENTES',
  ];
  const bairros = ['CENTRO', 'INDUSTRIAL', 'BOA VISTA', 'JARDIM AMERICA', 'VILA NOVA'];
  const nomesSocios = [
    'CARLOS EDUARDO SILVA', 'MARIANA COSTA OLIVEIRA', 'FERNANDO HENRIQUE SANTOS',
    'PATRICIA ALMEIDA SOUZA', 'RICARDO PEREIRA LIMA', 'JULIANA RODRIGUES FERREIRA',
  ];

  const portes = [2, 3, 5, 1];
  const naturezas = [2062, 2054, 2135, 2305];

  let sociosCount = 0;

  for (let i = 0; i < totalEmpresas; i += 1) {
    const cnpjBasico = String(60000000 + i).padStart(8, '0');
    const cnpjOrdem = i % 11 === 0 ? '0002' : '0001';
    const cnpjDv = String((10 + (i * 7) % 89)).padStart(2, '0');

    const municipio = MUNICIPIOS_BRASIL[i % MUNICIPIOS_BRASIL.length];
    const uf = municipio.uf;
    const cnaePrincipal = CATALOGO_CNAES[i % CATALOGO_CNAES.length];
    const cnaeSec1 = CATALOGO_CNAES[(i + 3) % CATALOGO_CNAES.length].codigo;
    const cnaeSec2 = CATALOGO_CNAES[(i + 7) % CATALOGO_CNAES.length].codigo;

    const porte = portes[i % portes.length];
    const natureza = naturezas[i % naturezas.length];
    const capitalBase =
      porte === 5 ? 1200000 + (i % 50) * 85000 : porte === 3 ? 180000 + (i % 30) * 15000 : 35000 + (i % 20) * 5000;
    const capitalBr = capitalBase.toFixed(2).replace('.', ',');

    const prefixo = prefixosRazao[i % prefixosRazao.length];
    const sufixo = sufixosRazao[(i + 2) % sufixosRazao.length];
    const razaoSocial = `${prefixo} ${municipio.nome.toUpperCase()} ${cnaePrincipal.secao.split(' ')[0].toUpperCase()} ${i + 1} ${sufixo}`;
    const nomeFantasia = i % 5 === 0 ? '' : `${prefixo} ${cnaePrincipal.secao.split(' ')[0].toUpperCase()}`;

    const simples = porte === 2 || porte === 3 ? (i % 4 === 0 ? 'N' : 'S') : 'N';
    const mei = porte === 2 && i % 5 === 0 ? 'S' : 'N';

    // ~92% ativas (02) e ~8% encerradas/baixadas ou inaptas (08/04/03)
    let situacao = '02';
    if (i % 25 === 24) situacao = '08';
    else if (i % 37 === 36) situacao = '04';
    else if (i % 53 === 52) situacao = '03';

    const ano = 2005 + (i % 20);
    const mes = String(1 + (i % 12)).padStart(2, '0');
    const dia = String(1 + (i % 28)).padStart(2, '0');
    const dataInicio = `${ano}${mes}${dia}`;

    const matrizFilial = cnpjOrdem === '0001' ? '1' : '2';
    const ddd = String(11 + (i % 78)).padStart(2, '0');
    const tel1 = i % 7 === 0 ? '' : `3${String(1000000 + (i % 8999999)).padStart(7, '0')}`;
    const email = i % 4 === 0 ? '' : `contato${i + 1}@empresa${cnpjBasico}.exemplo.br`;

    empresasStream.write(
      criarLinhaCsv([cnpjBasico, razaoSocial, natureza, 49, capitalBr, porte, '']),
    );
    simplesStream.write(
      criarLinhaCsv([cnpjBasico, simples, simples === 'S' ? dataInicio : '', '', mei, mei === 'S' ? dataInicio : '', '']),
    );
    estabStream.write(
      criarLinhaCsv([
        cnpjBasico,
        cnpjOrdem,
        cnpjDv,
        matrizFilial,
        nomeFantasia,
        situacao,
        dataInicio,
        '00',
        '',
        '105',
        dataInicio,
        cnaePrincipal.codigo,
        `${cnaeSec1},${cnaeSec2}`,
        'AVENIDA',
        logradouros[i % logradouros.length],
        String(100 + (i % 1900)),
        i % 3 === 0 ? `SALA ${10 + (i % 90)}` : '',
        bairros[i % bairros.length],
        String(10000000 + (i % 89999999)),
        uf,
        municipio.codigo_ibge,
        tel1 ? ddd : '',
        tel1,
        '',
        '',
        '',
        '',
        email,
        '',
        '',
      ]),
    );

    if (i % 4 === 0) {
      sociosStream.write(
        criarLinhaCsv([
          cnpjBasico,
          '2',
          nomesSocios[i % nomesSocios.length],
          `***${String(100000 + (i % 899999))}**`,
          '49',
          dataInicio,
          '105',
          '',
          '',
          '',
          String(3 + (i % 5)),
        ]),
      );
      sociosCount += 1;
    }
  }

  await Promise.all([
    new Promise<void>((resolve) => empresasStream.end(resolve)),
    new Promise<void>((resolve) => simplesStream.end(resolve)),
    new Promise<void>((resolve) => estabStream.end(resolve)),
    new Promise<void>((resolve) => sociosStream.end(resolve)),
  ]);

  return { empresasCount: totalEmpresas, sociosCount };
}

/**
 * Baixa arquivos ZIP oficiais da Receita Federal quando explicitamente habilitado.
 */
export async function baixarArquivosRemotosRfb(
  dataDir: string,
  baseUrl: string,
): Promise<void> {
  await mkdir(dataDir, { recursive: true });
  const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const arquivos = ['Empresas0.zip', 'Simples.zip', 'Estabelecimentos0.zip', 'Socios0.zip'];

  for (const arquivo of arquivos) {
    const zipPath = path.join(dataDir, arquivo);
    await execFileAsync('curl', ['-fsSL', '--max-time', '120', '-o', zipPath, `${normalizedBase}${arquivo}`]);
    await execFileAsync('unzip', ['-o', zipPath, '-d', dataDir]);
  }
}

export async function garantirTabelaEtl(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS etl_execucoes (
      id BIGSERIAL PRIMARY KEY,
      competencia VARCHAR(20) NOT NULL,
      modo VARCHAR(40) NOT NULL,
      total_processados INTEGER NOT NULL DEFAULT 0,
      total_ativos INTEGER NOT NULL DEFAULT 0,
      total_encerrados_ou_inativos INTEGER NOT NULL DEFAULT 0,
      status VARCHAR(20) NOT NULL,
      iniciado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      finalizado_em TIMESTAMP,
      detalhes TEXT
    );
  `);
}

async function lerLinhasArquivoCsv(
  filePath: string,
  onFields: (fields: string[]) => Promise<void> | void,
): Promise<void> {
  const stream = createReadStream(filePath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of rl) {
    if (!line || !line.trim()) continue;
    const fields = parseSemicolonCsvLine(line);
    await onFields(fields);
  }
}

export async function upsertEmpresasBatch(
  client: PoolClient,
  lote: EmpresaUpsertRecord[],
): Promise<void> {
  if (lote.length === 0) return;

  // Deduplica pela chave primária (cnpj_completo, uf) dentro do mesmo lote
  const unicos = new Map<string, EmpresaUpsertRecord>();
  for (const item of lote) {
    unicos.set(`${item.cnpj_completo}|${item.uf}`, item);
  }
  const registros = Array.from(unicos.values());

  await client.query(
    `
      INSERT INTO empresas_prospect (
        cnpj_basico, cnpj_ordem, cnpj_dv, cnpj_completo,
        razao_social, nome_fantasia, situacao_cadastral, data_inicio_atividade, matriz_filial,
        natureza_juridica, porte_empresa, capital_social, opcao_simples, opcao_mei,
        cnae_fiscal_principal, cnaes_secundarios,
        regiao, uf, codigo_municipio_ibge, municipio_nome,
        bairro, cep, logradouro, numero, complemento,
        ddd_1, telefone_1, ddd_2, telefone_2, email
      )
      SELECT
        t.cnpj_basico, t.cnpj_ordem, t.cnpj_dv, t.cnpj_completo,
        t.razao_social, t.nome_fantasia, t.situacao_cadastral, t.data_inicio_atividade, t.matriz_filial,
        t.natureza_juridica, t.porte_empresa, t.capital_social, t.opcao_simples, t.opcao_mei,
        t.cnae_fiscal_principal,
        CASE WHEN t.cnaes_sec_txt = '' OR t.cnaes_sec_txt IS NULL THEN NULL ELSE t.cnaes_sec_txt::int[] END,
        t.regiao, t.uf, t.codigo_municipio_ibge, t.municipio_nome,
        t.bairro, t.cep, t.logradouro, t.numero, t.complemento,
        t.ddd_1, t.telefone_1, t.ddd_2, t.telefone_2, t.email
      FROM UNNEST(
        $1::char(8)[], $2::char(4)[], $3::char(2)[], $4::char(14)[],
        $5::varchar(255)[], $6::varchar(255)[], $7::smallint[], $8::date[], $9::smallint[],
        $10::smallint[], $11::smallint[], $12::numeric(15,2)[], $13::char(1)[], $14::char(1)[],
        $15::int[], $16::text[],
        $17::varchar(20)[], $18::char(2)[], $19::int[], $20::varchar(100)[],
        $21::varchar(100)[], $22::char(8)[], $23::varchar(255)[], $24::varchar(20)[], $25::varchar(150)[],
        $26::char(2)[], $27::varchar(15)[], $28::char(2)[], $29::varchar(15)[], $30::varchar(255)[]
      ) AS t(
        cnpj_basico, cnpj_ordem, cnpj_dv, cnpj_completo,
        razao_social, nome_fantasia, situacao_cadastral, data_inicio_atividade, matriz_filial,
        natureza_juridica, porte_empresa, capital_social, opcao_simples, opcao_mei,
        cnae_fiscal_principal, cnaes_sec_txt,
        regiao, uf, codigo_municipio_ibge, municipio_nome,
        bairro, cep, logradouro, numero, complemento,
        ddd_1, telefone_1, ddd_2, telefone_2, email
      )
      ON CONFLICT (cnpj_completo, uf) DO UPDATE SET
        razao_social = EXCLUDED.razao_social,
        nome_fantasia = EXCLUDED.nome_fantasia,
        situacao_cadastral = EXCLUDED.situacao_cadastral,
        data_inicio_atividade = EXCLUDED.data_inicio_atividade,
        matriz_filial = EXCLUDED.matriz_filial,
        natureza_juridica = EXCLUDED.natureza_juridica,
        porte_empresa = EXCLUDED.porte_empresa,
        capital_social = EXCLUDED.capital_social,
        opcao_simples = EXCLUDED.opcao_simples,
        opcao_mei = EXCLUDED.opcao_mei,
        cnae_fiscal_principal = EXCLUDED.cnae_fiscal_principal,
        cnaes_secundarios = EXCLUDED.cnaes_secundarios,
        regiao = EXCLUDED.regiao,
        codigo_municipio_ibge = EXCLUDED.codigo_municipio_ibge,
        municipio_nome = EXCLUDED.municipio_nome,
        bairro = EXCLUDED.bairro,
        cep = EXCLUDED.cep,
        logradouro = EXCLUDED.logradouro,
        numero = EXCLUDED.numero,
        complemento = EXCLUDED.complemento,
        ddd_1 = EXCLUDED.ddd_1,
        telefone_1 = EXCLUDED.telefone_1,
        ddd_2 = EXCLUDED.ddd_2,
        telefone_2 = EXCLUDED.telefone_2,
        email = EXCLUDED.email,
        atualizado_em = CURRENT_TIMESTAMP
    `,
    [
      registros.map((r) => r.cnpj_basico),
      registros.map((r) => r.cnpj_ordem),
      registros.map((r) => r.cnpj_dv),
      registros.map((r) => r.cnpj_completo),
      registros.map((r) => r.razao_social),
      registros.map((r) => r.nome_fantasia),
      registros.map((r) => r.situacao_cadastral),
      registros.map((r) => r.data_inicio_atividade),
      registros.map((r) => r.matriz_filial),
      registros.map((r) => r.natureza_juridica),
      registros.map((r) => r.porte_empresa),
      registros.map((r) => r.capital_social),
      registros.map((r) => r.opcao_simples),
      registros.map((r) => r.opcao_mei),
      registros.map((r) => r.cnae_fiscal_principal),
      registros.map((r) => (r.cnaes_secundarios?.length ? `{${r.cnaes_secundarios.join(',')}}` : null)),
      registros.map((r) => r.regiao),
      registros.map((r) => r.uf),
      registros.map((r) => r.codigo_municipio_ibge),
      registros.map((r) => r.municipio_nome),
      registros.map((r) => r.bairro),
      registros.map((r) => r.cep),
      registros.map((r) => r.logradouro),
      registros.map((r) => r.numero),
      registros.map((r) => r.complemento),
      registros.map((r) => r.ddd_1),
      registros.map((r) => r.telefone_1),
      registros.map((r) => r.ddd_2),
      registros.map((r) => r.telefone_2),
      registros.map((r) => r.email),
    ],
  );
}

export async function upsertSociosBatch(
  client: PoolClient,
  lote: SocioInsertRecord[],
): Promise<void> {
  if (lote.length === 0) return;

  await client.query(
    `
      INSERT INTO socios_prospect (
        cnpj_basico, nome_socio, cpf_cnpj_mascarado, qualificacao_socio, faixa_etaria
      )
      SELECT
        s.cnpj_basico, s.nome_socio, s.cpf_cnpj_mascarado, s.qualificacao_socio, s.faixa_etaria
      FROM UNNEST(
        $1::char(8)[], $2::varchar(255)[], $3::varchar(14)[], $4::smallint[], $5::smallint[]
      ) AS s(cnpj_basico, nome_socio, cpf_cnpj_mascarado, qualificacao_socio, faixa_etaria)
      WHERE NOT EXISTS (
        SELECT 1
        FROM socios_prospect existing
        WHERE existing.cnpj_basico = s.cnpj_basico
          AND existing.nome_socio = s.nome_socio
      )
    `,
    [
      lote.map((s) => s.cnpj_basico),
      lote.map((s) => s.nome_socio),
      lote.map((s) => s.cpf_cnpj_mascarado),
      lote.map((s) => s.qualificacao_socio),
      lote.map((s) => s.faixa_etaria),
    ],
  );
}

async function listarArquivosPorPrefixo(dataDir: string, prefixo: string): Promise<string[]> {
  const entries = await readdir(dataDir);
  const matching: string[] = [];
  for (const name of entries.sort()) {
    if (name.toLowerCase().startsWith(prefixo.toLowerCase()) && name.toLowerCase().endsWith('.csv')) {
      const fullPath = path.join(dataDir, name);
      const info = await stat(fullPath);
      if (info.isFile()) matching.push(fullPath);
    }
  }
  return matching;
}

/**
 * Executa o pipeline ETL completo (Empresas + Simples + Estabelecimentos + Sócios)
 * realizando upsert idempotente para novas empresas e encerradas/baixadas.
 */
export async function executarEtlRfb(options: EtlOptions): Promise<EtlResultado> {
  const dataDir = path.resolve(options.dataDir ?? process.env.RFB_DATA_DIR ?? './data/rfb');
  const downloadRemote = options.downloadRemote ?? process.env.RFB_DOWNLOAD_REMOTE === 'true';
  const baseUrl =
    options.baseUrl ??
    process.env.RFB_BASE_URL ??
    'https://arquivos.receitafederal.gov.br/dados/cnpj/dados_abertos_cnpj/';
  const batchSize = options.batchSize ?? 2500;
  const competencia = options.competencia ?? new Date().toISOString().slice(0, 7);

  await garantirTabelaEtl(options.pool);
  await mkdir(dataDir, { recursive: true });

  let modo = 'LOCAL_CSV';
  if (downloadRemote) {
    modo = 'REMOTE_RFB';
    await baixarArquivosRemotosRfb(dataDir, baseUrl);
  }

  let estabFiles = await listarArquivosPorPrefixo(dataDir, 'Estabelecimentos');
  if (estabFiles.length === 0) {
    modo = 'GENERATED_RFB_CSV';
    await gerarLoteRfbOficialCsv(dataDir, options.totalInicialSintetico ?? 60000);
    estabFiles = await listarArquivosPorPrefixo(dataDir, 'Estabelecimentos');
  }

  const execInsert = await options.pool.query<{ id: string }>(
    `
      INSERT INTO etl_execucoes (competencia, modo, status)
      VALUES ($1, $2, 'RUNNING')
      RETURNING id
    `,
    [competencia, modo],
  );
  const execucaoId = Number(execInsert.rows[0].id);

  let totalProcessados = 0;
  let totalAtivos = 0;
  let totalEncerradosOuInativos = 0;
  let totalSocios = 0;

  try {
    const simplesMap = new Map<string, SimplesInfo>();
    const simplesFiles = await listarArquivosPorPrefixo(dataDir, 'Simples');
    for (const filePath of simplesFiles) {
      await lerLinhasArquivoCsv(filePath, (fields) => {
        const cnpjBasico = fields[0]?.trim().padStart(8, '0').slice(0, 8);
        if (!cnpjBasico || cnpjBasico === '00000000') return;
        simplesMap.set(cnpjBasico, {
          opcao_simples: fields[1]?.trim().toUpperCase() === 'S' ? 'S' : 'N',
          opcao_mei: fields[4]?.trim().toUpperCase() === 'S' ? 'S' : 'N',
        });
      });
    }

    const empresasMap = new Map<string, EmpresaBasicoInfo>();
    const empresasFiles = await listarArquivosPorPrefixo(dataDir, 'Empresas');
    for (const filePath of empresasFiles) {
      await lerLinhasArquivoCsv(filePath, (fields) => {
        const cnpjBasico = fields[0]?.trim().padStart(8, '0').slice(0, 8);
        const razao = truncar(fields[1], 255);
        if (!cnpjBasico || !razao) return;
        empresasMap.set(cnpjBasico, {
          razao_social: razao,
          natureza_juridica: parseIntOrNull(fields[2]),
          capital_social: parseCapitalSocial(fields[4]),
          porte_empresa: parseIntOrNull(fields[5]),
        });
      });
    }

    const client = await options.pool.connect();
    try {
      let loteEmpresas: EmpresaUpsertRecord[] = [];

      const flushEmpresas = async () => {
        if (loteEmpresas.length === 0) return;
        await client.query('BEGIN');
        try {
          await upsertEmpresasBatch(client, loteEmpresas);
          await client.query('COMMIT');
          loteEmpresas = [];
        } catch (err) {
          await client.query('ROLLBACK');
          throw err;
        }
      };

      for (const filePath of estabFiles) {
        await lerLinhasArquivoCsv(filePath, async (fields) => {
          const cnpjBasico = (fields[0] ?? '').trim().padStart(8, '0').slice(0, 8);
          const cnpjOrdem = (fields[1] ?? '').trim().padStart(4, '0').slice(0, 4);
          const cnpjDv = (fields[2] ?? '').trim().padStart(2, '0').slice(0, 2);
          const uf = (fields[19] ?? '').trim().toUpperCase();
          const estadoInfo = ESTADOS_POR_SIGLA.get(uf);
          const cnaePrincipal = parseIntOrNull(fields[11]);

          if (!cnpjBasico || !estadoInfo || !cnaePrincipal) {
            return;
          }

          const cnpjCompleto = `${cnpjBasico}${cnpjOrdem}${cnpjDv}`;
          if (cnpjCompleto.length !== 14) return;

          const empresaBase = empresasMap.get(cnpjBasico);
          const simplesInfo = simplesMap.get(cnpjBasico);
          const situacao = parseIntOrNull(fields[5]) ?? 2;
          const codigoMunicipio = parseIntOrNull(fields[20]) ?? 0;
          const municipioInfo = MUNICIPIOS_POR_CODIGO.get(codigoMunicipio);

          const record: EmpresaUpsertRecord = {
            cnpj_basico: cnpjBasico,
            cnpj_ordem: cnpjOrdem,
            cnpj_dv: cnpjDv,
            cnpj_completo: cnpjCompleto,
            razao_social: empresaBase?.razao_social ?? `EMPRESA ${cnpjBasico}`,
            nome_fantasia: truncar(fields[4], 255),
            situacao_cadastral: situacao,
            data_inicio_atividade: parseDataRfb(fields[10]),
            matriz_filial: parseIntOrNull(fields[3]),
            natureza_juridica: empresaBase?.natureza_juridica ?? null,
            porte_empresa: empresaBase?.porte_empresa ?? null,
            capital_social: empresaBase?.capital_social ?? '0.00',
            opcao_simples: simplesInfo?.opcao_simples ?? null,
            opcao_mei: simplesInfo?.opcao_mei ?? null,
            cnae_fiscal_principal: cnaePrincipal,
            cnaes_secundarios: parseCnaesSecundarios(fields[12]),
            regiao: estadoInfo.regiao,
            uf,
            codigo_municipio_ibge: codigoMunicipio,
            municipio_nome: (municipioInfo?.nome ?? `MUNICIPIO ${codigoMunicipio}`).toUpperCase().slice(0, 100),
            bairro: truncar(fields[17], 100),
            cep: truncar((fields[18] ?? '').replace(/\D/g, ''), 8),
            logradouro: truncar(
              [fields[13]?.trim(), fields[14]?.trim()].filter(Boolean).join(' '),
              255,
            ),
            numero: truncar(fields[15], 20),
            complemento: truncar(fields[16], 150),
            ddd_1: truncar(fields[21], 2),
            telefone_1: truncar(fields[22], 15),
            ddd_2: truncar(fields[23], 2),
            telefone_2: truncar(fields[24], 15),
            email: truncar(fields[27], 255),
          };

          totalProcessados += 1;
          if (situacao === 2) {
            totalAtivos += 1;
          } else {
            totalEncerradosOuInativos += 1;
          }

          loteEmpresas.push(record);
          if (loteEmpresas.length >= batchSize) {
            await flushEmpresas();
          }
        });
      }

      await flushEmpresas();

      const sociosFiles = await listarArquivosPorPrefixo(dataDir, 'Socios');
      let loteSocios: SocioInsertRecord[] = [];
      const flushSocios = async () => {
        if (loteSocios.length === 0) return;
        await client.query('BEGIN');
        try {
          await upsertSociosBatch(client, loteSocios);
          await client.query('COMMIT');
          loteSocios = [];
        } catch (err) {
          await client.query('ROLLBACK');
          throw err;
        }
      };

      for (const filePath of sociosFiles) {
        await lerLinhasArquivoCsv(filePath, async (fields) => {
          const cnpjBasico = (fields[0] ?? '').trim().padStart(8, '0').slice(0, 8);
          const nomeSocio = truncar(fields[2], 255);
          if (!cnpjBasico || !nomeSocio) return;

          loteSocios.push({
            cnpj_basico: cnpjBasico,
            nome_socio: nomeSocio,
            cpf_cnpj_mascarado: truncar(fields[3], 14),
            qualificacao_socio: parseIntOrNull(fields[4]),
            faixa_etaria: parseIntOrNull(fields[10]),
          });
          totalSocios += 1;

          if (loteSocios.length >= batchSize) {
            await flushSocios();
          }
        });
      }

      await flushSocios();
    } finally {
      client.release();
    }

    await options.pool.query(
      `
        UPDATE etl_execucoes
        SET
          total_processados = $2,
          total_ativos = $3,
          total_encerrados_ou_inativos = $4,
          status = 'COMPLETED',
          finalizado_em = CURRENT_TIMESTAMP,
          detalhes = $5
        WHERE id = $1
      `,
      [
        execucaoId,
        totalProcessados,
        totalAtivos,
        totalEncerradosOuInativos,
        `Sócios processados: ${totalSocios}`,
      ],
    );

    return {
      execucaoId,
      competencia,
      modo,
      totalProcessados,
      totalAtivos,
      totalEncerradosOuInativos,
      totalSocios,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    await options.pool
      .query(
        `
          UPDATE etl_execucoes
          SET status = 'FAILED', finalizado_em = CURRENT_TIMESTAMP, detalhes = $2
          WHERE id = $1
        `,
        [execucaoId, msg],
      )
      .catch(() => undefined);
    throw error;
  }
}

async function runCli() {
  const args = new Set(process.argv.slice(2));
  const watchMode = args.has('--watch');
  const downloadRemote = args.has('--download-remote');
  const intervalHours = Number(process.env.ETL_SYNC_INTERVAL_HOURS || '24');

  const pool = createPoolFromEnv();
  let running = false;

  const executarUmaVez = async () => {
    if (running) return;
    running = true;
    try {
      const resultado = await executarEtlRfb({ pool, downloadRemote });
      console.log(
        `[ETL RFB] Execução #${resultado.execucaoId} (${resultado.modo}) concluída: ${resultado.totalProcessados} estabelecimentos (${resultado.totalAtivos} ativos, ${resultado.totalEncerradosOuInativos} encerrados/inativos), ${resultado.totalSocios} sócios.`,
      );
    } finally {
      running = false;
    }
  };

  await executarUmaVez();

  if (!watchMode) {
    await pool.end();
    return;
  }

  const intervalMs = Math.max(1, intervalHours) * 60 * 60 * 1000;
  console.log(`[ETL RFB] Modo periódico ativo. Próxima sincronização a cada ${intervalHours}h.`);
  const timer = setInterval(() => {
    executarUmaVez().catch((err) => console.error('[ETL RFB] Falha na sincronização periódica:', err));
  }, intervalMs);

  const stop = async () => {
    clearInterval(timer);
    await pool.end();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

const executedBase = path.basename(process.argv[1] ?? '');
if (executedBase === 'etl-rfb.ts' || executedBase === 'etl-rfb.js') {
  runCli().catch((err) => {
    console.error('[ETL RFB] Erro fatal:', err);
    process.exit(1);
  });
}
