import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

// Migrations use the DIRECT (non-pooled) connection — required on Neon.
const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './migrations',
  dbCredentials: { url: url ?? 'postgresql://srms:srms@localhost:5432/srms' },
  strict: true,
  verbose: true,
});
