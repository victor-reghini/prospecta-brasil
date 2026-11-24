import crypto from 'crypto';
import { FiltrosProspeccao } from './types.js';

const UFS_VALIDAS = new Set([
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO',
  'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI',
  'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
]);

const REGIOES_VALIDAS = new Set([
  'Norte', 'Nordeste', 'Centro-Oeste', 'Sudeste', 'Sul',
]);

function limparArrayStrings(valor: unknown): string[] | undefined {
  if (!Array.isArray(valor)) return undefined;
  const itens = Array.from(
    new Set(
      valor
        .map((item) => (typeof item === 'string' ? item.trim() : ''))
        .filter((item) => item.length > 0),
    ),
  ).sort();
  return itens.length > 0 ? itens : undefined;
}

function limparArrayInteiros(valor: unknown): number[] | undefined {
  if (!Array.isArray(valor)) return undefined;
  const itens = Array.from(
    new Set(
      valor
        .map((item) => Number(item))
        .filter((num) => Number.isInteger(num) && num > 0),
    ),
  ).sort((a, b) => a - b);
  return itens.length > 0 ? itens : undefined;
}

function limparNumeroNaoNegativo(valor: unknown): number | undefined {
  if (valor === undefined || valor === null || valor === '') return undefined;
  const num = Number(valor);
  if (!Number.isFinite(num) || num < 0) return undefined;
  return num;
}

function limparDataISO(valor: unknown): string | undefined {
  if (typeof valor !== 'string') return undefined;
  const trimmed = valor.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return undefined;
  return trimmed;
}

/**
 * Normaliza e valida os filtros recebidos para evitar variações na geração do query_hash.
 */
export function normalizarFiltros(raw: unknown): FiltrosProspeccao {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {};
  }

  const input = raw as Record<string, unknown>;
  const normalizado: FiltrosProspeccao = {};

  const ufs = limparArrayStrings(input.uf)?.map((u) => u.toUpperCase()).filter((u) => UFS_VALIDAS.has(u));
  if (ufs && ufs.length > 0) normalizado.uf = Array.from(new Set(ufs)).sort();

  const regioes = limparArrayStrings(input.regiao)?.filter((r) => REGIOES_VALIDAS.has(r));
  if (regioes && regioes.length > 0) normalizado.regiao = regioes;

  const municipios = limparArrayInteiros(input.codigo_municipio_ibge);
  if (municipios) normalizado.codigo_municipio_ibge = municipios;

  const cnaesPrincipais = limparArrayInteiros(input.cnae_fiscal_principal);
  if (cnaesPrincipais) normalizado.cnae_fiscal_principal = cnaesPrincipais;

  const cnaesSecundarios = limparArrayInteiros(input.cnaes_secundarios);
  if (cnaesSecundarios) normalizado.cnaes_secundarios = cnaesSecundarios;

  const portes = limparArrayInteiros(input.porte_empresa);
  if (portes) normalizado.porte_empresa = portes;

  const naturezas = limparArrayInteiros(input.natureza_juridica);
  if (naturezas) normalizado.natureza_juridica = naturezas;

  const capMin = limparNumeroNaoNegativo(input.capital_social_min);
  if (capMin !== undefined) normalizado.capital_social_min = capMin;

  const capMax = limparNumeroNaoNegativo(input.capital_social_max);
  if (capMax !== undefined) normalizado.capital_social_max = capMax;

  const dataMin = limparDataISO(input.data_inicio_min);
  if (dataMin) normalizado.data_inicio_min = dataMin;

  const dataMax = limparDataISO(input.data_inicio_max);
  if (dataMax) normalizado.data_inicio_max = dataMax;

  const matrizFilial = Number(input.matriz_filial);
  if (matrizFilial === 1 || matrizFilial === 2) {
    normalizado.matriz_filial = matrizFilial;
  }

  if (input.opcao_simples === 'S' || input.opcao_simples === 'N') {
    normalizado.opcao_simples = input.opcao_simples;
  }

  if (input.opcao_mei === 'S' || input.opcao_mei === 'N') {
    normalizado.opcao_mei = input.opcao_mei;
  }

  if (input.somente_com_email === true) {
    normalizado.somente_com_email = true;
  }

  if (input.somente_com_telefone === true) {
    normalizado.somente_com_telefone = true;
  }

  if (typeof input.termo_busca === 'string' && input.termo_busca.trim().length > 0) {
    normalizado.termo_busca = input.termo_busca.trim().slice(0, 120);
  }

  if (input.excluir_leads_ja_comprados === true) {
    normalizado.excluir_leads_ja_comprados = true;
  }

  return normalizado;
}

/**
 * Gera um hash SHA-256 determinístico a partir dos filtros normalizados.
 */
export function gerarQueryHash(filtros: FiltrosProspeccao): string {
  const normalizado = normalizarFiltros(filtros);
  const ordenado: Record<string, unknown> = {};
  for (const chave of Object.keys(normalizado).sort()) {
    ordenado[chave] = (normalizado as Record<string, unknown>)[chave];
  }
  return crypto.createHash('sha256').update(JSON.stringify(ordenado)).digest('hex');
}

export interface WhereClauseResult {
  whereSql: string;
  params: unknown[];
}

/**
 * Constrói cláusula WHERE parametrizada para empresas_prospect (alias e).
 * Sempre força situacao_cadastral = 2 (Ativa), conforme especificação.
 */
export function construirWhereEmpresas(
  filtros: FiltrosProspeccao,
  usuarioId?: string,
): WhereClauseResult {
  const f = normalizarFiltros(filtros);
  const conditions: string[] = ['e.situacao_cadastral = 2'];
  const params: unknown[] = [];

  const addParam = (valor: unknown): string => {
    params.push(valor);
    return `$${params.length}`;
  };

  if (f.uf?.length) {
    conditions.push(`e.uf = ANY(${addParam(f.uf)}::char(2)[])`);
  }

  if (f.regiao?.length) {
    conditions.push(`e.regiao = ANY(${addParam(f.regiao)}::varchar[])`);
  }

  if (f.codigo_municipio_ibge?.length) {
    conditions.push(`e.codigo_municipio_ibge = ANY(${addParam(f.codigo_municipio_ibge)}::int[])`);
  }

  if (f.cnae_fiscal_principal?.length) {
    conditions.push(`e.cnae_fiscal_principal = ANY(${addParam(f.cnae_fiscal_principal)}::int[])`);
  }

  if (f.cnaes_secundarios?.length) {
    conditions.push(`e.cnaes_secundarios && ${addParam(f.cnaes_secundarios)}::int[]`);
  }

  if (f.porte_empresa?.length) {
    conditions.push(`e.porte_empresa = ANY(${addParam(f.porte_empresa)}::smallint[])`);
  }

  if (f.natureza_juridica?.length) {
    conditions.push(`e.natureza_juridica = ANY(${addParam(f.natureza_juridica)}::smallint[])`);
  }

  if (f.capital_social_min !== undefined) {
    conditions.push(`e.capital_social >= ${addParam(f.capital_social_min)}`);
  }

  if (f.capital_social_max !== undefined) {
    conditions.push(`e.capital_social <= ${addParam(f.capital_social_max)}`);
  }

  if (f.data_inicio_min) {
    conditions.push(`e.data_inicio_atividade >= ${addParam(f.data_inicio_min)}::date`);
  }

  if (f.data_inicio_max) {
    conditions.push(`e.data_inicio_atividade <= ${addParam(f.data_inicio_max)}::date`);
  }

  if (f.matriz_filial !== undefined) {
    conditions.push(`e.matriz_filial = ${addParam(f.matriz_filial)}`);
  }

  if (f.opcao_simples) {
    conditions.push(`e.opcao_simples = ${addParam(f.opcao_simples)}`);
  }

  if (f.opcao_mei) {
    conditions.push(`e.opcao_mei = ${addParam(f.opcao_mei)}`);
  }

  if (f.somente_com_email) {
    conditions.push('e.possui_email = TRUE');
  }

  if (f.somente_com_telefone) {
    conditions.push('e.possui_telefone = TRUE');
  }

  if (f.termo_busca) {
    const padrao = `%${f.termo_busca}%`;
    const p = addParam(padrao);
    conditions.push(`(e.razao_social ILIKE ${p} OR COALESCE(e.nome_fantasia, '') ILIKE ${p})`);
  }

  if (f.excluir_leads_ja_comprados) {
    if (!usuarioId) {
      throw new Error('usuarioId é obrigatório para excluir leads já comprados.');
    }
    const pUsuario = addParam(usuarioId);
    conditions.push(
      `NOT EXISTS (SELECT 1 FROM leads_adquiridos_usuario l WHERE l.usuario_id = ${pUsuario} AND l.cnpj_completo = e.cnpj_completo)`,
    );
  }

  return {
    whereSql: conditions.join(' AND '),
    params,
  };
}
