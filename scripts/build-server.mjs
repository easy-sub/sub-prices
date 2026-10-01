import { build } from 'esbuild'

await build({
  entryPoints: ['server/index.mjs'],
  outfile: 'build/server.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20'
})
