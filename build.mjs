import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const root = new URL('.', import.meta.url)
const template = await readFile(new URL('./src/client-template.js', root), 'utf8')

const moduleFiles = [
  './src/text-metrics.mjs',
  './src/flowchart-core.mjs',
  './src/sequence-core.mjs',
  './src/uml-graph-core.mjs',
  './src/diagram-dispatcher.mjs',
]

const bodies = []
for (const relPath of moduleFiles) {
  const raw = await readFile(new URL(relPath, root), 'utf8')
  const body = raw
    .replace(/^import\s+[^\n]+from\s+['"][^'"]+['"]\s*$/gmu, '')
    .replace(/^export\s*\{[\s\S]*?\}\s*$/mu, '')
    .trim()
  if (/\bexport\b/u.test(body)) throw new Error(`${relPath} contains an unsupported export`)
  if (/^\s*import\s+/mu.test(body)) throw new Error(`${relPath} contains an unsupported import`)
  bodies.push(body)
}

const marker = '    /* __DSH_FLOWCHART_CORE__ */'
if (!template.includes(marker)) throw new Error('client template marker is missing')
const output = template.replace(marker, () => bodies.join('\n\n'))
await writeFile(fileURLToPath(new URL('./client.js', root)), output.trimEnd() + '\n')
console.log('built client.js')
