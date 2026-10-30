import { createApp } from './app';
import { pool } from './db';
import { env } from './env';
import { startWorker } from './sms';

const server = createApp().listen(env.PORT, () => {
  console.log(JSON.stringify({ level: 'info', msg: `SRMS API listening on :${env.PORT}`, demoMode: env.DEMO_MODE, sms: env.SMS_PROVIDER }));
});
const stopWorker = env.WORKER_ENABLED ? startWorker() : () => undefined;

// Render sends SIGTERM on deploys: finish in-flight requests, then close the pool.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    stopWorker();
    server.close(() => void pool.end().then(() => process.exit(0)));
    setTimeout(() => process.exit(1), 10_000).unref();
  });
}
