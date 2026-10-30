/** CLI for database tasks:  tsx src/cli.ts migrate | bootstrap | seed */
import 'dotenv/config';
import { bootstrap } from './bootstrap';
import { createDb, createPool } from './client';
import { runMigrations } from './migrate';
import { seed } from './seed';

const command = process.argv[2];
const started = Date.now();
try {
  if (command === 'migrate') {
    await runMigrations();
    console.log(`✔ migrations applied in ${Date.now() - started} ms`);
  } else if (command === 'bootstrap') {
    const pool = createPool();
    try {
      await bootstrap(createDb(pool));
    } finally {
      await pool.end();
    }
  } else if (command === 'seed') {
    await seed();
  } else {
    console.error('usage: tsx src/cli.ts migrate | bootstrap | seed');
    process.exitCode = 2;
  }
} catch (err) {
  console.error(`✖ ${command} failed:`, err);
  process.exitCode = 1;
}
