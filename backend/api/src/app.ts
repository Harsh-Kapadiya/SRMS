import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { sql } from 'drizzle-orm';
import { authRouter } from './auth';
import { db } from './db';
import { env } from './env';
import { authenticate, errorHandler, notFound, requestLog } from './http';
import { adminRouter } from './routes/admin';
import { beneficiaryRouter } from './routes/beneficiary';
import { dealerRouter } from './routes/dealer';
import { officialRouter } from './routes/official';
import { publicRouter } from './routes/public';

/**
 * LLD Module 0 — SRMS Main Control: validate the session, route the request to
 * the module for the caller's role, return the response.
 */
export function createApp() {
  const app = express();
  app.set('trust proxy', env.TRUST_PROXY);
  app.disable('x-powered-by');
  app.use(helmet());
  const origins = env.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean);
  if (origins.length) app.use(cors({ origin: origins, credentials: true }));
  app.use(express.json({ limit: '100kb' }));
  app.use(requestLog);

  app.get('/health', async (_req, res) => {
    await db.execute(sql`select 1`);
    res.json({ ok: true, time: new Date().toISOString() });
  });

  app.use(authenticate);
  app.use('/auth', authRouter);
  app.use('/public', publicRouter);
  app.use('/me', beneficiaryRouter);
  app.use('/dealer', dealerRouter);
  app.use('/official', officialRouter);
  app.use('/admin', adminRouter);

  app.use(() => {
    throw notFound('Endpoint');
  });
  app.use(errorHandler);
  return app;
}
