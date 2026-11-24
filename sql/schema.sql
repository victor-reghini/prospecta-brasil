-- Schema da Plataforma de Prospecção B2B (Dados Públicos RFB + Stripe)

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS btree_gin;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================================
-- 1.1. Schema Analítico (Dados Governamentais RFB)
-- ============================================================================

CREATE TABLE IF NOT EXISTS empresas_prospect (
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
    cnaes_secundarios INTEGER[],

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

-- Partições para todas as 27 UFs do Brasil
CREATE TABLE IF NOT EXISTS empresas_prospect_ac PARTITION OF empresas_prospect FOR VALUES IN ('AC');
CREATE TABLE IF NOT EXISTS empresas_prospect_al PARTITION OF empresas_prospect FOR VALUES IN ('AL');
CREATE TABLE IF NOT EXISTS empresas_prospect_ap PARTITION OF empresas_prospect FOR VALUES IN ('AP');
CREATE TABLE IF NOT EXISTS empresas_prospect_am PARTITION OF empresas_prospect FOR VALUES IN ('AM');
CREATE TABLE IF NOT EXISTS empresas_prospect_ba PARTITION OF empresas_prospect FOR VALUES IN ('BA');
CREATE TABLE IF NOT EXISTS empresas_prospect_ce PARTITION OF empresas_prospect FOR VALUES IN ('CE');
CREATE TABLE IF NOT EXISTS empresas_prospect_df PARTITION OF empresas_prospect FOR VALUES IN ('DF');
CREATE TABLE IF NOT EXISTS empresas_prospect_es PARTITION OF empresas_prospect FOR VALUES IN ('ES');
CREATE TABLE IF NOT EXISTS empresas_prospect_go PARTITION OF empresas_prospect FOR VALUES IN ('GO');
CREATE TABLE IF NOT EXISTS empresas_prospect_ma PARTITION OF empresas_prospect FOR VALUES IN ('MA');
CREATE TABLE IF NOT EXISTS empresas_prospect_mt PARTITION OF empresas_prospect FOR VALUES IN ('MT');
CREATE TABLE IF NOT EXISTS empresas_prospect_ms PARTITION OF empresas_prospect FOR VALUES IN ('MS');
CREATE TABLE IF NOT EXISTS empresas_prospect_mg PARTITION OF empresas_prospect FOR VALUES IN ('MG');
CREATE TABLE IF NOT EXISTS empresas_prospect_pa PARTITION OF empresas_prospect FOR VALUES IN ('PA');
CREATE TABLE IF NOT EXISTS empresas_prospect_pb PARTITION OF empresas_prospect FOR VALUES IN ('PB');
CREATE TABLE IF NOT EXISTS empresas_prospect_pr PARTITION OF empresas_prospect FOR VALUES IN ('PR');
CREATE TABLE IF NOT EXISTS empresas_prospect_pe PARTITION OF empresas_prospect FOR VALUES IN ('PE');
CREATE TABLE IF NOT EXISTS empresas_prospect_pi PARTITION OF empresas_prospect FOR VALUES IN ('PI');
CREATE TABLE IF NOT EXISTS empresas_prospect_rj PARTITION OF empresas_prospect FOR VALUES IN ('RJ');
CREATE TABLE IF NOT EXISTS empresas_prospect_rn PARTITION OF empresas_prospect FOR VALUES IN ('RN');
CREATE TABLE IF NOT EXISTS empresas_prospect_rs PARTITION OF empresas_prospect FOR VALUES IN ('RS');
CREATE TABLE IF NOT EXISTS empresas_prospect_ro PARTITION OF empresas_prospect FOR VALUES IN ('RO');
CREATE TABLE IF NOT EXISTS empresas_prospect_rr PARTITION OF empresas_prospect FOR VALUES IN ('RR');
CREATE TABLE IF NOT EXISTS empresas_prospect_sc PARTITION OF empresas_prospect FOR VALUES IN ('SC');
CREATE TABLE IF NOT EXISTS empresas_prospect_sp PARTITION OF empresas_prospect FOR VALUES IN ('SP');
CREATE TABLE IF NOT EXISTS empresas_prospect_se PARTITION OF empresas_prospect FOR VALUES IN ('SE');
CREATE TABLE IF NOT EXISTS empresas_prospect_to PARTITION OF empresas_prospect FOR VALUES IN ('TO');

-- Índices Estratégicos para o Motor de Filtros
CREATE INDEX IF NOT EXISTS idx_prospect_filtros_core ON empresas_prospect (situacao_cadastral, uf, codigo_municipio_ibge, cnae_fiscal_principal);
CREATE INDEX IF NOT EXISTS idx_prospect_cnaes_sec ON empresas_prospect USING GIN (cnaes_secundarios);
CREATE INDEX IF NOT EXISTS idx_prospect_capital_porte ON empresas_prospect (porte_empresa, capital_social);
CREATE INDEX IF NOT EXISTS idx_prospect_contatos ON empresas_prospect (possui_email, possui_telefone) WHERE situacao_cadastral = 2;
CREATE INDEX IF NOT EXISTS idx_prospect_abertura ON empresas_prospect (data_inicio_atividade);

-- Tabela de Sócios (Enriquecimento de decisores)
CREATE TABLE IF NOT EXISTS socios_prospect (
    id BIGSERIAL PRIMARY KEY,
    cnpj_basico CHAR(8) NOT NULL,
    nome_socio VARCHAR(255) NOT NULL,
    cpf_cnpj_mascarado VARCHAR(14), -- Padrão RFB: ***123456**
    qualificacao_socio SMALLINT, -- Ex: 49 = Sócio-Administrador
    faixa_etaria SMALLINT
);
CREATE INDEX IF NOT EXISTS idx_socios_cnpj_basico ON socios_prospect (cnpj_basico);

-- ============================================================================
-- 1.2. Schema Transacional (Usuários, Pedidos e Deduplicação)
-- ============================================================================

CREATE TABLE IF NOT EXISTS usuarios (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    nome VARCHAR(255) NOT NULL,
    senha_hash VARCHAR(255) NOT NULL,
    stripe_customer_id VARCHAR(100) UNIQUE,
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS pedidos_exportacao (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    usuario_id UUID NOT NULL REFERENCES usuarios(id),

    -- Snapshot dos filtros e métricas
    filtros_json JSONB NOT NULL,
    query_hash VARCHAR(64) NOT NULL,
    quantidade_registros INTEGER NOT NULL,
    valor_total_centavos INTEGER NOT NULL,

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
CREATE TABLE IF NOT EXISTS stripe_webhook_events (
    event_id VARCHAR(255) PRIMARY KEY,
    event_type VARCHAR(100) NOT NULL,
    processado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Histórico de CNPJs adquiridos por usuário (Suporta o filtro "Excluir leads já comprados")
CREATE TABLE IF NOT EXISTS leads_adquiridos_usuario (
    usuario_id UUID NOT NULL REFERENCES usuarios(id),
    cnpj_completo CHAR(14) NOT NULL,
    pedido_id UUID NOT NULL REFERENCES pedidos_exportacao(id),
    adquirido_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (usuario_id, cnpj_completo)
);

-- Controle de execuções periódicas do ETL da RFB
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
