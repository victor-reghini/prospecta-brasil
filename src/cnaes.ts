export interface CnaeCatalogItem {
  codigo: number;
  codigoFormatado: string;
  descricao: string;
  secao: string;
}

/**
 * Catálogo expandido com 120+ CNAEs B2B oficiais da tabela RFB/IBGE,
 * organizados por setor econômico e incluindo todos os códigos do seed.
 */
export const CATALOGO_CNAES: CnaeCatalogItem[] = [
  // Tecnologia e Software
  { codigo: 6201501, codigoFormatado: '6201-5/01', descricao: 'Desenvolvimento de programas de computador sob encomenda', secao: 'Tecnologia e Software' },
  { codigo: 6201502, codigoFormatado: '6201-5/02', descricao: 'Web design', secao: 'Tecnologia e Software' },
  { codigo: 6202300, codigoFormatado: '6202-3/00', descricao: 'Desenvolvimento e licenciamento de programas de computador customizáveis', secao: 'Tecnologia e Software' },
  { codigo: 6203100, codigoFormatado: '6203-1/00', descricao: 'Desenvolvimento e licenciamento de programas de computador não-customizáveis', secao: 'Tecnologia e Software' },
  { codigo: 6204000, codigoFormatado: '6204-0/00', descricao: 'Consultoria em tecnologia da informação', secao: 'Tecnologia e Software' },
  { codigo: 6209100, codigoFormatado: '6209-1/00', descricao: 'Suporte técnico, manutenção e outros serviços em tecnologia da informação', secao: 'Tecnologia e Software' },
  { codigo: 6311900, codigoFormatado: '6311-9/00', descricao: 'Tratamento de dados, provedores de serviços de aplicação e hospedagem na internet', secao: 'Tecnologia e Software' },
  { codigo: 6319400, codigoFormatado: '6319-4/00', descricao: 'Portais, provedores de conteúdo e outros serviços de informação na internet', secao: 'Tecnologia e Software' },
  { codigo: 6110803, codigoFormatado: '6110-8/03', descricao: 'Serviços de comunicação multimídia - SCM', secao: 'Tecnologia e Software' },
  { codigo: 6190699, codigoFormatado: '6190-6/99', descricao: 'Outras atividades de telecomunicações não especificadas anteriormente', secao: 'Tecnologia e Software' },
  { codigo: 9511800, codigoFormatado: '9511-8/00', descricao: 'Reparação e manutenção de computadores e de equipamentos periféricos', secao: 'Tecnologia e Software' },

  // Transporte e Logística
  { codigo: 4930201, codigoFormatado: '4930-2/01', descricao: 'Transporte rodoviário de carga, exceto produtos perigosos e mudanças, municipal', secao: 'Transporte e Logística' },
  { codigo: 4930202, codigoFormatado: '4930-2/02', descricao: 'Transporte rodoviário de carga, exceto produtos perigosos e mudanças, intermunicipal, interestadual e internacional', secao: 'Transporte e Logística' },
  { codigo: 4930203, codigoFormatado: '4930-2/03', descricao: 'Transporte rodoviário de produtos perigosos', secao: 'Transporte e Logística' },
  { codigo: 4930204, codigoFormatado: '4930-2/04', descricao: 'Transporte rodoviário de mudanças', secao: 'Transporte e Logística' },
  { codigo: 5211701, codigoFormatado: '5211-7/01', descricao: 'Armazéns gerais - emissão de warrant', secao: 'Transporte e Logística' },
  { codigo: 5211799, codigoFormatado: '5211-7/99', descricao: 'Depósitos de mercadorias para terceiros, exceto armazéns gerais e guarda-móveis', secao: 'Transporte e Logística' },
  { codigo: 5212500, codigoFormatado: '5212-5/00', descricao: 'Carga e descarga', secao: 'Transporte e Logística' },
  { codigo: 5250804, codigoFormatado: '5250-8/04', descricao: 'Organização logística do transporte de carga', secao: 'Transporte e Logística' },
  { codigo: 5250803, codigoFormatado: '5250-8/03', descricao: 'Agenciamento de cargas, exceto para o transporte marítimo', secao: 'Transporte e Logística' },
  { codigo: 5320202, codigoFormatado: '5320-2/02', descricao: 'Serviços de entrega rápida', secao: 'Transporte e Logística' },

  // Construção e Engenharia
  { codigo: 4120400, codigoFormatado: '4120-4/00', descricao: 'Construção de edifícios', secao: 'Construção e Engenharia' },
  { codigo: 4110700, codigoFormatado: '4110-7/00', descricao: 'Incorporação de empreendimentos imobiliários', secao: 'Construção e Engenharia' },
  { codigo: 4211101, codigoFormatado: '4211-1/01', descricao: 'Construção de rodovias e ferrovias', secao: 'Construção e Engenharia' },
  { codigo: 4221902, codigoFormatado: '4221-9/02', descricao: 'Construção de estações e redes de distribuição de energia elétrica', secao: 'Construção e Engenharia' },
  { codigo: 4299599, codigoFormatado: '4299-5/99', descricao: 'Outras obras de engenharia civil não especificadas anteriormente', secao: 'Construção e Engenharia' },
  { codigo: 4313400, codigoFormatado: '4313-4/00', descricao: 'Obras de terraplenagem', secao: 'Construção e Engenharia' },
  { codigo: 4321500, codigoFormatado: '4321-5/00', descricao: 'Instalação e manutenção elétrica', secao: 'Construção e Engenharia' },
  { codigo: 4322301, codigoFormatado: '4322-3/01', descricao: 'Instalações hidráulicas, sanitárias e de gás', secao: 'Construção e Engenharia' },
  { codigo: 4322302, codigoFormatado: '4322-3/02', descricao: 'Instalação e manutenção de sistemas centrais de ar condicionado, de ventilação e refrigeração', secao: 'Construção e Engenharia' },
  { codigo: 4330404, codigoFormatado: '4330-4/04', descricao: 'Serviços de pintura de edifícios em geral', secao: 'Construção e Engenharia' },
  { codigo: 4399103, codigoFormatado: '4399-1/03', descricao: 'Obras de alvenaria', secao: 'Construção e Engenharia' },
  { codigo: 7111100, codigoFormatado: '7111-1/00', descricao: 'Serviços de arquitetura', secao: 'Construção e Engenharia' },
  { codigo: 7112000, codigoFormatado: '7112-0/00', descricao: 'Serviços de engenharia', secao: 'Construção e Engenharia' },

  // Consultoria e Serviços Corporativos
  { codigo: 7020400, codigoFormatado: '7020-4/00', descricao: 'Atividades de consultoria em gestão empresarial, exceto consultoria técnica específica', secao: 'Consultoria e Serviços Corporativos' },
  { codigo: 6911701, codigoFormatado: '6911-7/01', descricao: 'Serviços advocatícios', secao: 'Consultoria e Serviços Corporativos' },
  { codigo: 6920601, codigoFormatado: '6920-6/01', descricao: 'Atividades de contabilidade', secao: 'Consultoria e Serviços Corporativos' },
  { codigo: 6920602, codigoFormatado: '6920-6/02', descricao: 'Atividades de consultoria e auditoria contábil e tributária', secao: 'Consultoria e Serviços Corporativos' },
  { codigo: 7311400, codigoFormatado: '7311-4/00', descricao: 'Agências de publicidade', secao: 'Consultoria e Serviços Corporativos' },
  { codigo: 7319002, codigoFormatado: '7319-0/02', descricao: 'Promoção de vendas', secao: 'Consultoria e Serviços Corporativos' },
  { codigo: 7319003, codigoFormatado: '7319-0/03', descricao: 'Marketing direto', secao: 'Consultoria e Serviços Corporativos' },
  { codigo: 7490104, codigoFormatado: '7490-1/04', descricao: 'Atividades de intermediação e agenciamento de serviços e negócios em geral', secao: 'Consultoria e Serviços Corporativos' },
  { codigo: 7810800, codigoFormatado: '7810-8/00', descricao: 'Seleção e agenciamento de mão-de-obra', secao: 'Consultoria e Serviços Corporativos' },
  { codigo: 7820500, codigoFormatado: '7820-5/00', descricao: 'Locação de mão-de-obra temporária', secao: 'Consultoria e Serviços Corporativos' },
  { codigo: 8011101, codigoFormatado: '8011-1/01', descricao: 'Atividades de vigilância e segurança privada', secao: 'Consultoria e Serviços Corporativos' },
  { codigo: 8111700, codigoFormatado: '8111-7/00', descricao: 'Serviços combinados para apoio a edifícios, exceto condomínios prediais', secao: 'Consultoria e Serviços Corporativos' },
  { codigo: 8121400, codigoFormatado: '8121-4/00', descricao: 'Limpeza em prédios e em domicílios', secao: 'Consultoria e Serviços Corporativos' },
  { codigo: 8211300, codigoFormatado: '8211-3/00', descricao: 'Serviços combinados de escritório e apoio administrativo', secao: 'Consultoria e Serviços Corporativos' },
  { codigo: 8219999, codigoFormatado: '8219-9/99', descricao: 'Preparação de documentos e serviços especializados de apoio administrativo', secao: 'Consultoria e Serviços Corporativos' },

  // Comércio Atacadista
  { codigo: 4619200, codigoFormatado: '4619-2/00', descricao: 'Representantes comerciais e agentes do comércio de mercadorias em geral não especializado', secao: 'Comércio Atacadista' },
  { codigo: 4623109, codigoFormatado: '4623-1/09', descricao: 'Comércio atacadista de alimentos para animais', secao: 'Comércio Atacadista' },
  { codigo: 4632001, codigoFormatado: '4632-0/01', descricao: 'Comércio atacadista de cereais e leguminosas beneficiados', secao: 'Comércio Atacadista' },
  { codigo: 4637199, codigoFormatado: '4637-1/99', descricao: 'Comércio atacadista especializado em outros produtos alimentícios', secao: 'Comércio Atacadista' },
  { codigo: 4639701, codigoFormatado: '4639-7/01', descricao: 'Comércio atacadista de produtos alimentícios em geral', secao: 'Comércio Atacadista' },
  { codigo: 4644301, codigoFormatado: '4644-3/01', descricao: 'Comércio atacadista de medicamentos e drogas de uso humano', secao: 'Comércio Atacadista' },
  { codigo: 4645101, codigoFormatado: '4645-1/01', descricao: 'Comércio atacadista de instrumentos e materiais para uso médico, cirúrgico e hospitalar', secao: 'Comércio Atacadista' },
  { codigo: 4646001, codigoFormatado: '4646-0/01', descricao: 'Comércio atacadista de cosméticos e produtos de perfumaria', secao: 'Comércio Atacadista' },
  { codigo: 4649499, codigoFormatado: '4649-4/99', descricao: 'Comércio atacadista de outros equipamentos e artigos de uso pessoal e doméstico', secao: 'Comércio Atacadista' },
  { codigo: 4651601, codigoFormatado: '4651-6/01', descricao: 'Comércio atacadista de equipamentos de informática', secao: 'Comércio Atacadista' },
  { codigo: 4661300, codigoFormatado: '4661-3/00', descricao: 'Comércio atacadista de máquinas, aparelhos e equipamentos para uso agropecuário', secao: 'Comércio Atacadista' },
  { codigo: 4663000, codigoFormatado: '4663-0/00', descricao: 'Comércio atacadista de máquinas e equipamentos para uso industrial; partes e peças', secao: 'Comércio Atacadista' },
  { codigo: 4679699, codigoFormatado: '4679-6/99', descricao: 'Comércio atacadista de materiais de construção em geral', secao: 'Comércio Atacadista' },
  { codigo: 4684299, codigoFormatado: '4684-2/99', descricao: 'Comércio atacadista de outros produtos químicos e petroquímicos', secao: 'Comércio Atacadista' },
  { codigo: 4686902, codigoFormatado: '4686-9/02', descricao: 'Comércio atacadista de embalagens', secao: 'Comércio Atacadista' },

  // Comércio Varejista
  { codigo: 4711302, codigoFormatado: '4711-3/02', descricao: 'Comércio varejista de mercadorias em geral, com predominância de produtos alimentícios - supermercados', secao: 'Comércio Varejista' },
  { codigo: 4712100, codigoFormatado: '4712-1/00', descricao: 'Comércio varejista de mercadorias em geral, com predominância de produtos alimentícios - minimercados', secao: 'Comércio Varejista' },
  { codigo: 4721102, codigoFormatado: '4721-1/02', descricao: 'Padaria e confeitaria com predominância de revenda', secao: 'Comércio Varejista' },
  { codigo: 4729699, codigoFormatado: '4729-6/99', descricao: 'Comércio varejista de produtos alimentícios em geral', secao: 'Comércio Varejista' },
  { codigo: 4744001, codigoFormatado: '4744-0/01', descricao: 'Comércio varejista de ferragens e ferramentas', secao: 'Comércio Varejista' },
  { codigo: 4744099, codigoFormatado: '4744-0/99', descricao: 'Comércio varejista de materiais de construção em geral', secao: 'Comércio Varejista' },
  { codigo: 4751201, codigoFormatado: '4751-2/01', descricao: 'Comércio varejista especializado de equipamentos e suprimentos de informática', secao: 'Comércio Varejista' },
  { codigo: 4754701, codigoFormatado: '4754-7/01', descricao: 'Comércio varejista de móveis', secao: 'Comércio Varejista' },
  { codigo: 4771701, codigoFormatado: '4771-7/01', descricao: 'Comércio varejista de produtos farmacêuticos, sem manipulação de fórmulas', secao: 'Comércio Varejista' },
  { codigo: 4781400, codigoFormatado: '4781-4/00', descricao: 'Comércio varejista de artigos do vestuário e acessórios', secao: 'Comércio Varejista' },
  { codigo: 4789099, codigoFormatado: '4789-0/99', descricao: 'Comércio varejista de outros produtos não especificados anteriormente', secao: 'Comércio Varejista' },

  // Indústria de Transformação
  { codigo: 1412601, codigoFormatado: '1412-6/01', descricao: 'Confecção de peças de vestuário, exceto roupas íntimas e as confeccionadas sob medida', secao: 'Indústria de Transformação' },
  { codigo: 1622699, codigoFormatado: '1622-6/99', descricao: 'Fabricação de outros artigos de carpintaria para construção', secao: 'Indústria de Transformação' },
  { codigo: 1731100, codigoFormatado: '1731-1/00', descricao: 'Fabricação de embalagens de papel', secao: 'Indústria de Transformação' },
  { codigo: 1813099, codigoFormatado: '1813-0/99', descricao: 'Impressão de material para outros usos', secao: 'Indústria de Transformação' },
  { codigo: 2063100, codigoFormatado: '2063-1/00', descricao: 'Fabricação de cosméticos, produtos de perfumaria e de higiene pessoal', secao: 'Indústria de Transformação' },
  { codigo: 2222600, codigoFormatado: '2222-6/00', descricao: 'Fabricação de embalagens de material plástico', secao: 'Indústria de Transformação' },
  { codigo: 2229399, codigoFormatado: '2229-3/99', descricao: 'Fabricação de artefatos de material plástico para outros usos', secao: 'Indústria de Transformação' },
  { codigo: 2330302, codigoFormatado: '2330-3/02', descricao: 'Fabricação de artefatos de cimento para uso na construção', secao: 'Indústria de Transformação' },
  { codigo: 3101200, codigoFormatado: '3101-2/00', descricao: 'Fabricação de móveis com predominância de madeira', secao: 'Indústria de Transformação' },

  // Indústria Alimentícia e Bebidas
  { codigo: 1011201, codigoFormatado: '1011-2/01', descricao: 'Frigorífico - abate de bovinos', secao: 'Indústria Alimentícia e Bebidas' },
  { codigo: 1052000, codigoFormatado: '1052-0/00', descricao: 'Fabricação de laticínios', secao: 'Indústria Alimentícia e Bebidas' },
  { codigo: 1091101, codigoFormatado: '1091-1/01', descricao: 'Fabricação de produtos de panificação industrial', secao: 'Indústria Alimentícia e Bebidas' },
  { codigo: 1099699, codigoFormatado: '1099-6/99', descricao: 'Fabricação de outros produtos alimentícios não especificados anteriormente', secao: 'Indústria Alimentícia e Bebidas' },
  { codigo: 1113502, codigoFormatado: '1113-5/02', descricao: 'Fabricação de cervejas e chopes', secao: 'Indústria Alimentícia e Bebidas' },

  // Metalurgia, Máquinas e Equipamentos
  { codigo: 2511000, codigoFormatado: '2511-0/00', descricao: 'Fabricação de estruturas metálicas', secao: 'Metalurgia, Máquinas e Equipamentos' },
  { codigo: 2512800, codigoFormatado: '2512-8/00', descricao: 'Fabricação de esquadrias de metal', secao: 'Metalurgia, Máquinas e Equipamentos' },
  { codigo: 2539001, codigoFormatado: '2539-0/01', descricao: 'Serviços de usinagem, tornearia e solda', secao: 'Metalurgia, Máquinas e Equipamentos' },
  { codigo: 2599399, codigoFormatado: '2599-3/99', descricao: 'Fabricação de outros produtos de metal não especificados anteriormente', secao: 'Metalurgia, Máquinas e Equipamentos' },
  { codigo: 2710401, codigoFormatado: '2710-4/01', descricao: 'Fabricação de geradores de corrente contínua e alternada, peças e acessórios', secao: 'Metalurgia, Máquinas e Equipamentos' },
  { codigo: 2829199, codigoFormatado: '2829-1/99', descricao: 'Fabricação de outras máquinas e equipamentos de uso geral', secao: 'Metalurgia, Máquinas e Equipamentos' },
  { codigo: 2833000, codigoFormatado: '2833-0/00', descricao: 'Fabricação de máquinas e equipamentos para a agricultura e pecuária', secao: 'Metalurgia, Máquinas e Equipamentos' },
  { codigo: 3314799, codigoFormatado: '3314-7/99', descricao: 'Manutenção e reparação de outras máquinas e equipamentos da indústria mecânica', secao: 'Metalurgia, Máquinas e Equipamentos' },

  // Saúde e Odontologia
  { codigo: 8610101, codigoFormatado: '8610-1/01', descricao: 'Atividades de atendimento hospitalar, exceto pronto-socorro e unidades para atendimento a urgências', secao: 'Saúde e Odontologia' },
  { codigo: 8630501, codigoFormatado: '8630-5/01', descricao: 'Atividade médica ambulatorial com recursos para realização de procedimentos cirúrgicos', secao: 'Saúde e Odontologia' },
  { codigo: 8630502, codigoFormatado: '8630-5/02', descricao: 'Atividade médica ambulatorial com recursos para realização de exames complementares', secao: 'Saúde e Odontologia' },
  { codigo: 8630503, codigoFormatado: '8630-5/03', descricao: 'Atividade médica ambulatorial restrita a consultas', secao: 'Saúde e Odontologia' },
  { codigo: 8630504, codigoFormatado: '8630-5/04', descricao: 'Atividade odontológica', secao: 'Saúde e Odontologia' },
  { codigo: 8640202, codigoFormatado: '8640-2/02', descricao: 'Laboratórios clínicos', secao: 'Saúde e Odontologia' },
  { codigo: 8650004, codigoFormatado: '8650-0/04', descricao: 'Atividades de fisioterapia', secao: 'Saúde e Odontologia' },

  // Educação e Treinamento
  { codigo: 8513900, codigoFormatado: '8513-9/00', descricao: 'Ensino fundamental', secao: 'Educação e Treinamento' },
  { codigo: 8531700, codigoFormatado: '8531-7/00', descricao: 'Educação superior - graduação', secao: 'Educação e Treinamento' },
  { codigo: 8599604, codigoFormatado: '8599-6/04', descricao: 'Treinamento em desenvolvimento profissional e gerencial', secao: 'Educação e Treinamento' },
  { codigo: 8593700, codigoFormatado: '8593-7/00', descricao: 'Ensino de idiomas', secao: 'Educação e Treinamento' },

  // Serviços Financeiros e Seguros
  { codigo: 6462000, codigoFormatado: '6462-0/00', descricao: 'Holdings de instituições não-financeiras', secao: 'Serviços Financeiros e Seguros' },
  { codigo: 6463800, codigoFormatado: '6463-8/00', descricao: 'Outras sociedades de participação, exceto holdings', secao: 'Serviços Financeiros e Seguros' },
  { codigo: 6499999, codigoFormatado: '6499-9/99', descricao: 'Outras atividades de serviços financeiros não especificadas anteriormente', secao: 'Serviços Financeiros e Seguros' },
  { codigo: 6619302, codigoFormatado: '6619-3/02', descricao: 'Correspondentes de instituições financeiras', secao: 'Serviços Financeiros e Seguros' },
  { codigo: 6622300, codigoFormatado: '6622-3/00', descricao: 'Corretores e agentes de seguros, de planos de previdência complementar e de saúde', secao: 'Serviços Financeiros e Seguros' },

  // Atividades Imobiliárias
  { codigo: 6810201, codigoFormatado: '6810-2/01', descricao: 'Compra e venda de imóveis próprios', secao: 'Atividades Imobiliárias' },
  { codigo: 6810202, codigoFormatado: '6810-2/02', descricao: 'Aluguel de imóveis próprios', secao: 'Atividades Imobiliárias' },
  { codigo: 6821801, codigoFormatado: '6821-8/01', descricao: 'Corretagem na compra e venda e avaliação de imóveis', secao: 'Atividades Imobiliárias' },
  { codigo: 6822600, codigoFormatado: '6822-6/00', descricao: 'Gestão e administração da propriedade imobiliária', secao: 'Atividades Imobiliárias' },

  // Agronegócio e Pecuária
  { codigo: 111302, codigoFormatado: '0111-3/02', descricao: 'Cultivo de milho', secao: 'Agronegócio e Pecuária' },
  { codigo: 115600, codigoFormatado: '0115-6/00', descricao: 'Cultivo de soja', secao: 'Agronegócio e Pecuária' },
  { codigo: 113000, codigoFormatado: '0113-0/00', descricao: 'Cultivo de cana-de-açúcar', secao: 'Agronegócio e Pecuária' },
  { codigo: 151201, codigoFormatado: '0151-2/01', descricao: 'Criação de bovinos para corte', secao: 'Agronegócio e Pecuária' },
  { codigo: 161003, codigoFormatado: '0161-0/03', descricao: 'Serviço de preparação de terreno, cultivo e colheita', secao: 'Agronegócio e Pecuária' },

  // Energia, Saneamento e Meio Ambiente
  { codigo: 3511501, codigoFormatado: '3511-5/01', descricao: 'Geração de energia elétrica', secao: 'Energia, Saneamento e Meio Ambiente' },
  { codigo: 3811400, codigoFormatado: '3811-4/00', descricao: 'Coleta de resíduos não-perigosos', secao: 'Energia, Saneamento e Meio Ambiente' },
  { codigo: 3832700, codigoFormatado: '3832-7/00', descricao: 'Recuperação de materiais plásticos', secao: 'Energia, Saneamento e Meio Ambiente' },

  // Hospedagem, Eventos e Alimentação
  { codigo: 5510801, codigoFormatado: '5510-8/01', descricao: 'Hotéis', secao: 'Hospedagem, Eventos e Alimentação' },
  { codigo: 5611201, codigoFormatado: '5611-2/01', descricao: 'Restaurantes e similares', secao: 'Hospedagem, Eventos e Alimentação' },
  { codigo: 5620101, codigoFormatado: '5620-1/01', descricao: 'Fornecimento de alimentos preparados preponderantemente para empresas', secao: 'Hospedagem, Eventos e Alimentação' },
  { codigo: 8230001, codigoFormatado: '8230-0/01', descricao: 'Serviços de organização de feiras, congressos, exposições e festas', secao: 'Hospedagem, Eventos e Alimentação' },

  // Comércio e Manutenção Automotiva
  { codigo: 4511101, codigoFormatado: '4511-1/01', descricao: 'Comércio a varejo de automóveis, camionetas e utilitários novos', secao: 'Comércio e Manutenção Automotiva' },
  { codigo: 4520001, codigoFormatado: '4520-0/01', descricao: 'Serviços de manutenção e reparação mecânica de veículos automotores', secao: 'Comércio e Manutenção Automotiva' },
  { codigo: 4530703, codigoFormatado: '4530-7/03', descricao: 'Comércio a varejo de peças e acessórios novos para veículos automotores', secao: 'Comércio e Manutenção Automotiva' },
  { codigo: 7711000, codigoFormatado: '7711-0/00', descricao: 'Locação de automóveis sem condutor', secao: 'Comércio e Manutenção Automotiva' },
];
