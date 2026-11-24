import { DetalheFaixaPreco, DetalhePrecoExportacao } from './types.js';

const TAXA_MINIMA_CENTAVOS = 1990;
const LIMITE_TAXA_MINIMA = 500;
const LIMITE_FAIXA_1 = 4500; // 501 a 5.000
const LIMITE_FAIXA_2 = 20000; // 5.001 a 25.000

/**
 * Calcula o valor da exportação em centavos usando faixas progressivas.
 */
export function calcularPrecoExportacaoCentavos(totalRegistros: number): number {
  if (!Number.isInteger(totalRegistros) || totalRegistros <= 0) {
    throw new Error('A consulta não retornou registros.');
  }

  if (totalRegistros <= LIMITE_TAXA_MINIMA) {
    return TAXA_MINIMA_CENTAVOS;
  }

  let totalCentavos = TAXA_MINIMA_CENTAVOS;
  let restantes = totalRegistros - LIMITE_TAXA_MINIMA;

  // Faixa 1: próximos 4.500 registros (501 a 5.000) a 4 centavos
  const qtdFaixa1 = Math.min(restantes, LIMITE_FAIXA_1);
  totalCentavos += qtdFaixa1 * 4;
  restantes -= qtdFaixa1;

  // Faixa 2: próximos 20.000 registros (5.001 a 25.000) a 2,5 centavos
  if (restantes > 0) {
    const qtdFaixa2 = Math.min(restantes, LIMITE_FAIXA_2);
    totalCentavos += Math.round(qtdFaixa2 * 2.5);
    restantes -= qtdFaixa2;
  }

  // Faixa 3: acima de 25.000 registros a 1,5 centavos
  if (restantes > 0) {
    totalCentavos += Math.round(restantes * 1.5);
  }

  return totalCentavos;
}

export function formatarBRL(centavos: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(centavos / 100);
}

/**
 * Retorna o detalhamento completo das faixas aplicadas para exibição na cotação.
 */
export function detalharPrecoExportacao(totalRegistros: number): DetalhePrecoExportacao {
  const valorTotalCentavos = calcularPrecoExportacaoCentavos(totalRegistros);
  const faixas: DetalheFaixaPreco[] = [
    {
      faixa: 'Base (até 500 registros)',
      quantidade: Math.min(totalRegistros, LIMITE_TAXA_MINIMA),
      valorUnitarioCentavos: TAXA_MINIMA_CENTAVOS,
      subtotalCentavos: TAXA_MINIMA_CENTAVOS,
    },
  ];

  let restantes = Math.max(0, totalRegistros - LIMITE_TAXA_MINIMA);

  if (restantes > 0) {
    const qtdFaixa1 = Math.min(restantes, LIMITE_FAIXA_1);
    faixas.push({
      faixa: 'Faixa 1 (501 a 5.000)',
      quantidade: qtdFaixa1,
      valorUnitarioCentavos: 4,
      subtotalCentavos: qtdFaixa1 * 4,
    });
    restantes -= qtdFaixa1;
  }

  if (restantes > 0) {
    const qtdFaixa2 = Math.min(restantes, LIMITE_FAIXA_2);
    faixas.push({
      faixa: 'Faixa 2 (5.001 a 25.000)',
      quantidade: qtdFaixa2,
      valorUnitarioCentavos: 2.5,
      subtotalCentavos: Math.round(qtdFaixa2 * 2.5),
    });
    restantes -= qtdFaixa2;
  }

  if (restantes > 0) {
    faixas.push({
      faixa: 'Faixa 3 (acima de 25.000)',
      quantidade: restantes,
      valorUnitarioCentavos: 1.5,
      subtotalCentavos: Math.round(restantes * 1.5),
    });
  }

  return {
    totalRegistros,
    valorTotalCentavos,
    valorFormatado: formatarBRL(valorTotalCentavos),
    faixas,
  };
}
