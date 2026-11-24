import 'dotenv/config';
import { createApp } from './app.js';
import { createStripeClientFromEnv } from './checkout.js';
import { createPoolFromEnv, PostgresRepository } from './db.js';
import { executarEtlRfb } from './etl-rfb.js';
import { createStorageFromEnv } from './storage.js';
import { InMemoryExportQueue } from './worker.js';

async function main() {
  const port = Number(process.env.PORT ?? 3000);
  const pool = createPoolFromEnv();
  const db = new PostgresRepository(pool);
  const storage = createStorageFromEnv();
  const exportQueue = new InMemoryExportQueue({ db, storage });
  const stripe = createStripeClientFromEnv();

  const app = createApp({
    db,
    storage,
    exportQueue,
    stripe,
  });

  const server = app.listen(port, () => {
    console.log(`Prospecta Brasil API executando em http://localhost:${port}`);
  });

  const syncHours = Number(process.env.ETL_SYNC_INTERVAL_HOURS ?? 0);
  let etlTimer: NodeJS.Timeout | null = null;
  let etlRunning = false;
  if (Number.isFinite(syncHours) && syncHours > 0) {
    const intervalMs = syncHours * 60 * 60 * 1000;
    etlTimer = setInterval(() => {
      if (etlRunning) return;
      etlRunning = true;
      executarEtlRfb({ pool })
        .then((res) => {
          console.log(
            `[ETL RFB] Sincronização periódica #${res.execucaoId}: ${res.totalProcessados} processados.`,
          );
        })
        .catch((err) => console.error('[ETL RFB] Erro na sincronização periódica:', err))
        .finally(() => {
          etlRunning = false;
        });
    }, intervalMs);
    etlTimer.unref();
  }

  const shutdown = async () => {
    console.log('Encerrando servidor...');
    if (etlTimer) clearInterval(etlTimer);
    server.close(async () => {
      await db.close();
      process.exit(0);
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('Erro fatal ao iniciar servidor:', err);
  process.exit(1);
});
