import { Request, Response } from 'express';
import Stripe from 'stripe';
import { DbRepository } from './db.js';
import { gerarQueryHash, normalizarFiltros } from './filters.js';
import { calcularPrecoExportacaoCentavos, detalharPrecoExportacao } from './pricing.js';
import { FormatoArquivo } from './types.js';
import { ExportQueue } from './worker.js';

export interface StripeCheckoutLike {
  checkout: {
    sessions: {
      create(
        params: Stripe.Checkout.SessionCreateParams,
      ): Promise<{ id: string; url: string | null }>;
    };
  };
}

export interface CheckoutDeps {
  db: DbRepository;
  stripe: StripeCheckoutLike | null;
  exportQueue: ExportQueue;
  frontendUrl: string;
  allowLocalhostFree?: boolean;
}

const LOCALHOST_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export function isLocalhostRequest(req: Request): boolean {
  const hostname = (req.hostname || '').toLowerCase();
  if (LOCALHOST_HOSTS.has(hostname)) {
    return true;
  }

  const hostHeader = (req.header('host') || '').toLowerCase();
  if (!hostHeader) return false;

  if (hostHeader.startsWith('[::1]')) {
    return true;
  }

  const hostSemPorta = hostHeader.split(':')[0];
  return LOCALHOST_HOSTS.has(hostSemPorta);
}

export function createStripeClientFromEnv(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key || key.includes('substitua_aqui')) {
    return null;
  }
  return new Stripe(key, {
    apiVersion: '2024-06-20' as Stripe.LatestApiVersion,
  });
}

export function createQuotesHandler(db: DbRepository) {
  return async function calcularCotacao(req: Request, res: Response) {
    try {
      const usuario = req.user;
      if (!usuario) {
        return res.status(401).json({ error: 'Usuário não autenticado.' });
      }

      const filtros = normalizarFiltros(req.body?.filtros ?? req.body);
      const totalRegistros = await db.contarEmpresasComFiltros(filtros, usuario.id);
      const queryHash = gerarQueryHash(filtros);

      if (totalRegistros === 0) {
        return res.status(200).json({
          quantidadeRegistros: 0,
          valorTotalCentavos: 0,
          valorFormatado: 'R$ 0,00',
          faixas: [],
          queryHash,
          amostra: [],
        });
      }

      const detalhePreco = detalharPrecoExportacao(totalRegistros);
      const amostra = await db.buscarAmostraEmpresas(filtros, usuario.id, 5);

      return res.status(200).json({
        quantidadeRegistros: totalRegistros,
        valorTotalCentavos: detalhePreco.valorTotalCentavos,
        valorFormatado: detalhePreco.valorFormatado,
        faixas: detalhePreco.faixas,
        queryHash,
        amostra,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erro ao calcular cotação.';
      return res.status(400).json({ error: message });
    }
  };
}

export function createCheckoutHandler(deps: CheckoutDeps) {
  return async function criarSessaoCheckout(req: Request, res: Response) {
    try {
      const usuario = req.user;
      if (!usuario) {
        return res.status(401).json({ error: 'Usuário não autenticado.' });
      }

      const localhostBypass =
        deps.allowLocalhostFree !== false &&
        isLocalhostRequest(req) &&
        req.header('x-force-stripe') !== 'true';

      if (!localhostBypass && !deps.stripe) {
        return res.status(503).json({
          error: 'STRIPE_SECRET_KEY não configurada no servidor.',
        });
      }

      const filtros = normalizarFiltros(req.body?.filtros);
      const formatoBruto = req.body?.formatoArquivo;
      const formatoArquivo: FormatoArquivo = formatoBruto === 'xlsx' ? 'xlsx' : 'csv';

      const totalRegistros = await deps.db.contarEmpresasComFiltros(filtros, usuario.id);
      if (totalRegistros === 0) {
        return res.status(400).json({
          error: 'Nenhuma empresa encontrada para os filtros aplicados.',
        });
      }

      const valorCentavos = calcularPrecoExportacaoCentavos(totalRegistros);
      const queryHash = gerarQueryHash(filtros);

      const pedido = await deps.db.criarPedidoExportacao({
        usuario_id: usuario.id,
        filtros_json: filtros,
        query_hash: queryHash,
        quantidade_registros: totalRegistros,
        valor_total_centavos: valorCentavos,
      });

      if (localhostBypass) {
        await deps.db.registrarPagamentoWebhookIdempotente({
          event_id: `localhost_free_${pedido.id}`,
          event_type: 'localhost.free_export',
          pedido_id: pedido.id,
          stripe_payment_intent_id: `pi_localhost_free_${pedido.id}`,
        });

        await deps.exportQueue.add('gerar-planilha-leads', {
          pedidoId: pedido.id,
          formatoArquivo,
        });

        return res.status(201).json({
          checkoutUrl: `${deps.frontendUrl}/?pedido=${pedido.id}&status=sucesso&modo=localhost`,
          pedidoId: pedido.id,
          quantidadeRegistros: totalRegistros,
          valorTotalCentavos: valorCentavos,
          modoLocalhost: true,
        });
      }

      const session = await deps.stripe!.checkout.sessions.create({
        mode: 'payment',
        payment_method_types: ['card', 'boleto'],
        customer_email: usuario.email,
        line_items: [
          {
            price_data: {
              currency: 'brl',
              unit_amount: valorCentavos,
              product_data: {
                name: `Lista de Prospecção B2B (${totalRegistros.toLocaleString('pt-BR')} empresas)`,
                description: `Exportação segmentada em formato ${formatoArquivo.toUpperCase()} - Dados Públicos RFB`,
              },
            },
            quantity: 1,
          },
        ],
        metadata: {
          pedido_id: pedido.id,
          usuario_id: usuario.id,
          formato_arquivo: formatoArquivo,
          query_hash: queryHash,
        },
        success_url: `${deps.frontendUrl}/?pedido=${pedido.id}&status=sucesso`,
        cancel_url: `${deps.frontendUrl}/?status=cancelado`,
      });

      await deps.db.atualizarSessaoStripePedido(pedido.id, session.id);

      return res.status(201).json({
        checkoutUrl: session.url,
        pedidoId: pedido.id,
        quantidadeRegistros: totalRegistros,
        valorTotalCentavos: valorCentavos,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erro ao criar sessão de checkout.';
      return res.status(500).json({ error: message });
    }
  };
}
