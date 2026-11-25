import express, { NextFunction, Request, Response } from 'express';
import path from 'path';
import { existsSync } from 'fs';
import {
  createCheckoutHandler,
  createQuotesHandler,
  StripeCheckoutLike,
} from './checkout.js';
import { CATALOGO_CNAES } from './cnaes.js';
import { DbRepository } from './db.js';
import { ESTADOS_BRASIL, MUNICIPIOS_BRASIL } from './localidades.js';
import { ExportStorage } from './storage.js';
import { UsuarioAutenticado } from './types.js';
import { formatarBRL } from './pricing.js';
import { createStripeWebhookHandler, StripeWebhookVerifier } from './webhook.js';
import { ExportQueue } from './worker.js';

declare global {
  namespace Express {
    interface Request {
      user?: UsuarioAutenticado;
      rawBody?: Buffer;
    }
  }
}

export interface AppDependencies {
  db: DbRepository;
  storage: ExportStorage;
  exportQueue: ExportQueue;
  stripe: (StripeCheckoutLike & StripeWebhookVerifier) | null;
  webhookSecret?: string;
  frontendUrl?: string;
  defaultUser?: UsuarioAutenticado;
  publicDir?: string;
  allowLocalhostFree?: boolean;
}

function resolveDefaultUser(): UsuarioAutenticado {
  return {
    id: process.env.DEV_DEFAULT_USER_ID || '00000000-0000-4000-8000-000000000001',
    email: process.env.DEV_DEFAULT_USER_EMAIL || 'demo@prospectabrasil.local',
    nome: 'Usuário Demonstração',
  };
}

export function createApp(deps: AppDependencies) {
  const app = express();
  const defaultUser = deps.defaultUser ?? resolveDefaultUser();
  const frontendUrl = deps.frontendUrl ?? process.env.FRONTEND_URL ?? 'http://localhost:3000';
  const webhookSecret = deps.webhookSecret ?? process.env.STRIPE_WEBHOOK_SECRET ?? '';
  const publicDir = deps.publicDir ?? path.resolve(process.cwd(), 'public');

  // Webhook do Stripe deve receber rawBody antes do parser JSON global
  app.post(
    '/webhooks/stripe',
    express.raw({ type: 'application/json' }),
    (req: Request, _res: Response, next: NextFunction) => {
      if (Buffer.isBuffer(req.body)) {
        req.rawBody = req.body;
      }
      next();
    },
    createStripeWebhookHandler({
      db: deps.db,
      stripe: deps.stripe,
      webhookSecret,
      exportQueue: deps.exportQueue,
    }),
  );

  app.use(express.json({ limit: '1mb' }));

  // Middleware de contexto de usuário (aceita cabeçalhos em dev ou usuário padrão)
  // ponytail: autenticação simplificada em dev; substituir por verificação JWT/Sessão antes de produção.
  app.use((req: Request, _res: Response, next: NextFunction) => {
    const headerId = req.header('x-user-id')?.trim();
    const headerEmail = req.header('x-user-email')?.trim();
    req.user = {
      id: headerId || defaultUser.id,
      email: headerEmail || defaultUser.email,
      nome: defaultUser.nome,
    };
    next();
  });

  app.get('/health', async (_req: Request, res: Response) => {
    try {
      const ok = await deps.db.verificarSaude();
      return res.status(ok ? 200 : 503).json({ status: ok ? 'ok' : 'unavailable' });
    } catch (err) {
      return res.status(503).json({
        status: 'unavailable',
        error: err instanceof Error ? err.message : 'Database connection error',
      });
    }
  });

  app.get('/api/cnaes', (_req: Request, res: Response) => {
    return res.status(200).json({ cnaes: CATALOGO_CNAES });
  });

  app.get('/api/localidades', (req: Request, res: Response) => {
    const ufsParam =
      typeof req.query.uf === 'string'
        ? req.query.uf
            .split(',')
            .map((s) => s.trim().toUpperCase())
            .filter(Boolean)
        : [];
    const regioesParam =
      typeof req.query.regiao === 'string'
        ? req.query.regiao
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : [];

    const regioesSet = new Set(regioesParam);
    const estados =
      regioesSet.size > 0
        ? ESTADOS_BRASIL.filter((e) => regioesSet.has(e.regiao))
        : ESTADOS_BRASIL;

    const ufsPermitidas = new Set(estados.map((e) => e.sigla));
    const ufsFiltroSet = new Set(ufsParam);
    const municipios = MUNICIPIOS_BRASIL.filter((m) => {
      if (ufsFiltroSet.size > 0) {
        return ufsFiltroSet.has(m.uf) && (regioesSet.size === 0 || ufsPermitidas.has(m.uf));
      }
      return ufsPermitidas.has(m.uf);
    });

    return res.status(200).json({ estados, municipios });
  });

  app.get('/api/etl/status', async (_req: Request, res: Response) => {
    try {
      const resumo = await deps.db.obterResumoEtl();
      return res.status(200).json(resumo);
    } catch (err) {
      return res.status(500).json({
        error: err instanceof Error ? err.message : 'Erro ao consultar status do ETL.',
      });
    }
  });

  app.post('/api/quotes', createQuotesHandler(deps.db));

  app.post(
    '/api/checkout',
    createCheckoutHandler({
      db: deps.db,
      stripe: deps.stripe,
      exportQueue: deps.exportQueue,
      frontendUrl,
      allowLocalhostFree: deps.allowLocalhostFree,
    }),
  );

  app.get('/api/pedidos', async (req: Request, res: Response) => {
    try {
      const usuario = req.user;
      if (!usuario) return res.status(401).json({ error: 'Usuário não autenticado.' });

      const pedidos = await deps.db.listarPedidosUsuario(usuario.id);
      return res.status(200).json({
        pedidos: pedidos.map((p) => ({
          ...p,
          valor_formatado: formatarBRL(p.valor_total_centavos),
        })),
      });
    } catch (error) {
      return res.status(500).json({
        error: error instanceof Error ? error.message : 'Erro ao listar pedidos.',
      });
    }
  });

  app.get('/api/pedidos/:id', async (req: Request, res: Response) => {
    try {
      const usuario = req.user;
      if (!usuario) return res.status(401).json({ error: 'Usuário não autenticado.' });

      const pedidoId = String(req.params.id);
      const pedido = await deps.db.buscarPedidoPorId(pedidoId, usuario.id);
      if (!pedido) {
        return res.status(404).json({ error: 'Pedido não encontrado.' });
      }

      let downloadUrl: string | null = null;
      const naoExpirado = !pedido.expira_em || new Date(pedido.expira_em).getTime() > Date.now();

      if (pedido.status_arquivo === 'READY' && pedido.s3_file_key && naoExpirado) {
        downloadUrl = await deps.storage.getDownloadUrl(pedido.s3_file_key);
      }

      return res.status(200).json({
        pedido: {
          ...pedido,
          valor_formatado: formatarBRL(pedido.valor_total_centavos),
        },
        downloadUrl,
      });
    } catch (error) {
      return res.status(500).json({
        error: error instanceof Error ? error.message : 'Erro ao consultar pedido.',
      });
    }
  });

  // Rota de download local para ambiente de desenvolvimento sem S3/R2
  app.get('/api/downloads/:key', (req: Request, res: Response) => {
    if (!deps.storage.resolveLocalFilePath) {
      return res.status(404).json({ error: 'Downloads locais não estão habilitados.' });
    }
    const key = decodeURIComponent(String(req.params.key));
    const filePath = deps.storage.resolveLocalFilePath(key);
    if (!existsSync(filePath)) {
      return res.status(404).json({ error: 'Arquivo de exportação não encontrado.' });
    }
    return res.download(filePath, path.basename(filePath));
  });

  if (existsSync(publicDir)) {
    app.use(express.static(publicDir));
  }

  return app;
}
