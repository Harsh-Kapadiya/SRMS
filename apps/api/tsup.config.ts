import { defineConfig } from 'tsup';

// Bundle the API together with the workspace packages (@srms/db, @srms/shared,
// which ship as TypeScript source); npm dependencies stay external.
export default defineConfig({
  entry: ['src/server.ts', 'src/migrate.ts'],
  format: 'esm',
  target: 'node22',
  platform: 'node',
  sourcemap: true,
  clean: true,
  noExternal: [/^@srms\//],
});
