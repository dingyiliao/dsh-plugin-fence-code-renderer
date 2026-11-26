import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = new URL('.', import.meta.url)

const moduleFiles = [
  './src/text-metrics.ts',
  './src/flowchart-core.ts',
  './src/sequence-core.ts',
  './src/uml-graph-core.ts',
  './src/diagram-dispatcher.ts',
]

async function compile(path: string): Promise<string> {
  const source = await readFile(new URL(path, root), 'utf8')
  const result = ts.transpileModule(source, {
    fileName: path,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      newLine: ts.NewLineKind.LineFeed,
    },
    reportDiagnostics: true,
  })
  const errors = result.diagnostics?.filter(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error) ?? []
  if (errors.length > 0) {
    throw new Error(`${path}: ${errors.map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')).join('\n')}`)
  }
  return result.outputText
}

const bodies = []
for (const relPath of moduleFiles) {
  const body = (await compile(relPath))
    .replace(/^import\s+[^\n]+from\s+['"][^'"]+['"]\s*;?\s*$/gmu, '')
    .replace(/^export\s*\{[\s\S]*?\}\s*;?\s*$/mu, '')
    .trim()
  if (/\bexport\b/u.test(body)) throw new Error(`${relPath} contains an unsupported export`)
  if (/^\s*import\s+/mu.test(body)) throw new Error(`${relPath} contains an unsupported import`)
  bodies.push(body)
}

const marker = '    /* __DSH_FLOWCHART_CORE__ */'
const template = await compile('./src/client-template.ts')
if (!template.includes(marker)) throw new Error('client template marker is missing')
const output = template.replace(marker, () => bodies.join('\n\n'))
await writeFile(fileURLToPath(new URL('./client.js', root)), output.trimEnd() + '\n')
await writeFile(fileURLToPath(new URL('./index.js', root)), (await compile('./src/index.ts')).trimEnd() + '\n')
console.log('built client.js')
