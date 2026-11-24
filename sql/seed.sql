-- Dados de desenvolvimento local para validação da plataforma Prospecta Brasil

INSERT INTO usuarios (id, email, nome, senha_hash)
VALUES (
    '00000000-0000-4000-8000-000000000001',
    'demo@prospectabrasil.local',
    'Usuário Demonstração',
    'dev-hash-nao-usar-em-producao'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO empresas_prospect (
    cnpj_basico, cnpj_ordem, cnpj_dv, cnpj_completo,
    razao_social, nome_fantasia, situacao_cadastral, data_inicio_atividade, matriz_filial,
    natureza_juridica, porte_empresa, capital_social, opcao_simples, opcao_mei,
    cnae_fiscal_principal, cnaes_secundarios,
    regiao, uf, codigo_municipio_ibge, municipio_nome, bairro, cep, logradouro, numero, complemento,
    ddd_1, telefone_1, ddd_2, telefone_2, email
)
VALUES
    (
        '11222333', '0001', '81', '11222333000181',
        'TECNOLOGIA PAULISTA SOLUCOES DIGITAIS LTDA', 'TECH PAULISTA', 2, '2018-04-12', 1,
        2062, 3, 250000.00, 'S', 'N',
        6201501, ARRAY[6202300, 6209100],
        'Sudeste', 'SP', 3550308, 'SAO PAULO', 'BELA VISTA', '01310100', 'AVENIDA PAULISTA', '1000', 'CONJ 1201',
        '11', '30001122', NULL, NULL, 'contato@techpaulista.exemplo.br'
    ),
    (
        '22333444', '0001', '52', '22333444000152',
        'SUL LOGISTICA E TRANSPORTES RODOVIARIOS SA', 'SUL LOG', 2, '2014-09-03', 1,
        2054, 5, 1850000.00, 'N', 'N',
        4930202, ARRAY[4930201, 5211799],
        'Sul', 'PR', 4106902, 'CURITIBA', 'BATEL', '80420090', 'RUA BISPO DOM JOSE', '2450', 'SALA 402',
        '41', '33445566', '41', '999887766', 'comercial@sullog.exemplo.br'
    ),
    (
        '33444555', '0001', '23', '33444555000123',
        'MINAS ENGENHARIA E OBRAS INDUSTRIAIS LTDA', 'MINAS ENG', 2, '2020-01-20', 1,
        2062, 3, 600000.00, 'S', 'N',
        4120400, ARRAY[7112000],
        'Sudeste', 'MG', 3106200, 'BELO HORIZONTE', 'SAVASSI', '30130170', 'AVENIDA GETULIO VARGAS', '880', NULL,
        '31', '32224455', NULL, NULL, 'licitacoes@minaseng.exemplo.br'
    ),
    (
        '44555666', '0001', '94', '44555666000194',
        'NORDESTE COMERCIO ALIMENTICIO ME', 'SABOR NORDESTE', 2, '2022-06-15', 1,
        2062, 2, 45000.00, 'S', 'N',
        4711302, ARRAY[4721102],
        'Nordeste', 'BA', 2927408, 'SALVADOR', 'PITUBA', '41810011', 'AVENIDA PAULO VI', '410', 'LOJA B',
        '71', '34567890', NULL, NULL, NULL
    ),
    (
        '55666777', '0001', '65', '55666777000165',
        'CARIOCA CONSULTORIA EM GESTAO EMPRESARIAL LTDA', 'CARIOCA GESTAO', 4, '2011-03-08', 1,
        2062, 2, 80000.00, 'N', 'N',
        7020400, NULL,
        'Sudeste', 'RJ', 3304557, 'RIO DE JANEIRO', 'CENTRO', '20040002', 'AVENIDA RIO BRANCO', '156', 'SALA 901',
        '21', '22334455', NULL, NULL, 'contato@cariocagestao.exemplo.br'
    )
ON CONFLICT (cnpj_completo, uf) DO NOTHING;

INSERT INTO socios_prospect (cnpj_basico, nome_socio, cpf_cnpj_mascarado, qualificacao_socio, faixa_etaria)
VALUES
    ('11222333', 'MARIANA ALMEIDA FERREIRA', '***456789**', 49, 4),
    ('22333444', 'ROBERTO CARLOS MENDES', '***112233**', 10, 6),
    ('33444555', 'FELIPE AUGUSTO RIBEIRO', '***998877**', 49, 5)
ON CONFLICT DO NOTHING;
