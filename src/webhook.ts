import { Request, Response } from 'express';
import Stripe from 'stripe';
import { DbRepository } from './db.js';
import { FormatoArquivo } from './types.js';
import { ExportQueue } from './worker.js';

export interface StripeWebhookVerifier {
  webhooks: {
    constructEvent(
      payload: string | Buffer,
      header: string | string[],
      secret: string,
    ): Stripe.Event;
  };
}

export interface WebhookDeps {
  db: DbRepository;
  stripe: StripeWebhookVerifier | null;
  webhookSecret: string;
  exportQueue: ExportQueue;
}

export function createStripeWebhookHandler(deps: WebhookDeps) {
  return async function handleStripeWebhook(req: Request, res: Response) {
    if (!deps.stripe || !deps.webhookSecret) {
      return res.status(503).json({
        error: 'Webhook Stripe não configurado (STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET).',
      });
    }

    const sig = req.headers['stripe-signature'];
    if (!sig) {
      return res.status(400).send('Webhook Error: Cabeçalho stripe-signature ausente.');
    }

    const rawBody = req.rawBody ?? (Buffer.isBuffer(req.body) ? req.body : undefined);
    if (!rawBody) {
      return res.status(400).send('Webhook Error: Corpo bruto (rawBody) ausente.');
    }

    let event: Stripe.Event;
    try {
      event = deps.stripe.webhooks.constructEvent(rawBody, sig, deps.webhookSecret);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Assinatura inválida';
      console.error(`Falha na assinatura do Webhook: ${message}`);
      return res.status(400).send(`Webhook Error: ${message}`);
    }

    if (
      event.type === 'checkout.session.completed' ||
      event.type === 'checkout.session.async_payment_succeeded'
    ) {
      const session = event.data.object as Stripe.Checkout.Session;

      if (session.payment_status === 'paid') {
        const pedidoId = session.metadata?.pedido_id;
        const formatoArquivo: FormatoArquivo =
          session.metadata?.formato_arquivo === 'csv' ? 'csv' : 'xlsx';

        if (!pedidoId) {
          return res.status(400).json({ error: 'Metadata pedido_id ausente na sessão Stripe.' });
        }

        const { duplicated } = await deps.db.registrarPagamentoWebhookIdempotente({
          event_id: event.id,
          event_type: event.type,
          pedido_id: pedidoId,
          stripe_payment_intent_id:
            typeof session.payment_intent === 'string' ? session.payment_intent : null,
        });

        if (duplicated) {
          return res.status(200).json({ received: true, duplicated: true });
        }

        await deps.exportQueue.add('gerar-planilha-leads', {
          pedidoId,
          formatoArquivo,
        });
      }
    }

    return res.status(200).json({ received: true });
  };
}
