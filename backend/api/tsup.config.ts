import { defineConfig } from 'tsup';

// Bundle the API together with the workspace packages (@srms/database, @srms/shared,
// which ship as TypeScript source); npm dependencies stay external.
export default defineConfig({
  entry: ['src/server.ts', 'src/run-migrations.ts'],
  format: 'esm',
  target: 'node22',
  platform: 'node',
  sourcemap: true,
  clean: true,
  noExternal: [/^@srms\//],
});
