import { rm } from 'node:fs/promises'
import { build } from 'esbuild'

await rm(new URL('./dist/', import.meta.url), { recursive: true, force: true })

await Promise.all([
  build({
    entryPoints: ['src/index.ts'],
    outfile: 'dist/index.js',
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    target: 'es2022',
  }),
  build({
    entryPoints: ['src/client.ts'],
    outfile: 'dist/client.js',
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
  }),
])
