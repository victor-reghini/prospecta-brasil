export type FormatoArquivo = 'csv' | 'xlsx';

export type StatusPagamento = 'PENDING' | 'PAID' | 'FAILED' | 'REFUNDED';

export type StatusArquivo =
  | 'WAITING_PAYMENT'
  | 'PROCESSING'
  | 'READY'
  | 'EXPIRED'
  | 'FAILED';

export interface FiltrosProspeccao {
  uf?: string[];
  regiao?: string[];
  codigo_municipio_ibge?: number[];
  cnae_fiscal_principal?: number[];
  cnaes_secundarios?: number[];
  porte_empresa?: number[];
  natureza_juridica?: number[];
  capital_social_min?: number;
  capital_social_max?: number;
  data_inicio_min?: string;
  data_inicio_max?: string;
  matriz_filial?: 1 | 2;
  opcao_simples?: 'S' | 'N';
  opcao_mei?: 'S' | 'N';
  somente_com_email?: boolean;
  somente_com_telefone?: boolean;
  termo_busca?: string;
  excluir_leads_ja_comprados?: boolean;
}

export interface DetalheFaixaPreco {
  faixa: string;
  quantidade: number;
  valorUnitarioCentavos: number;
  subtotalCentavos: number;
}

export interface DetalhePrecoExportacao {
  totalRegistros: number;
  valorTotalCentavos: number;
  valorFormatado: string;
  faixas: DetalheFaixaPreco[];
}

export interface EmpresaAmostra {
  cnpj_mascarado: string;
  razao_social: string;
  nome_fantasia: string | null;
  uf: string;
  municipio_nome: string;
  cnae_fiscal_principal: number;
  porte_empresa: number | null;
  capital_social: string;
  possui_email: boolean;
  possui_telefone: boolean;
}

export interface EmpresaExportRow {
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

export interface PedidoExportacao {
  id: string;
  usuario_id: string;
  filtros_json: FiltrosProspeccao;
  query_hash: string;
  quantidade_registros: number;
  valor_total_centavos: number;
  stripe_session_id: string | null;
  stripe_payment_intent_id: string | null;
  status_pagamento: StatusPagamento;
  status_arquivo: StatusArquivo;
  s3_file_key: string | null;
  expira_em: Date | null;
  criado_em: Date;
  pago_em: Date | null;
}

export interface UsuarioAutenticado {
  id: string;
  email: string;
  nome?: string;
}

export interface ExportJobPayload {
  pedidoId: string;
  formatoArquivo: FormatoArquivo;
}

export interface EtlExecucaoRegistro {
  id: number;
  competencia: string;
  modo: string;
  total_processados: number;
  total_ativos: number;
  total_encerrados_ou_inativos: number;
  status: string;
  iniciado_em: Date;
  finalizado_em: Date | null;
  detalhes: string | null;
}

export interface EtlResumoStatus {
  total_empresas: number;
  total_ativas: number;
  total_encerradas_ou_inativas: number;
  ultima_execucao: EtlExecucaoRegistro | null;
}
