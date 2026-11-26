import { layoutFlowchart, parseFlowchart } from './flowchart-core.ts'
import { layoutSequenceDiagram, parseSequenceDiagram } from './sequence-core.ts'
import { parseClassDiagram, parseErDiagram, parsePlantUmlGraph, parseStateDiagram } from './uml-graph-core.ts'

const SUPPORTED_FENCE_LANGUAGES = ['flowchart', 'graph', 'mermaid', 'plantuml', 'puml', 'uml']
type DiagramLayout = NonNullable<ReturnType<typeof layoutFlowchart>> | NonNullable<ReturnType<typeof layoutSequenceDiagram>>

/**
 * Parse and lay out a supported diagram fence into a renderable model.
 * Returns null when the source is unsupported, invalid, or too complex so the
 * caller falls back to the stock code block.
 * @param {string} lang
 * @param {string} source
 * @returns {object | null}
 */
function parseAndLayoutDiagram(lang: string, source: string): DiagramLayout | null {
  if (typeof source !== 'string' || source.length === 0 || source.length > 20_000) return null
  const normLang = String(lang ?? '').trim().toLowerCase()
  const lines = source.replace(/\r/g, '').split('\n')

  let firstLine = ''
  for (const raw of lines) {
    const t = raw.trim()
    if (t === '' || t.startsWith('%%') || t.startsWith("'")) continue
    firstLine = t
    break
  }
  if (firstLine === '') return null

  // Immediately bail on preprocessor macros or unsupported diagram types
  if (/^@(?:startmindmap|startwbs|startgantt|startsalt|startjson|startyaml|startditaa|startebnf|startregex)\b/iu.test(firstLine)) {
    return null
  }
  if (/^\s*!(?:include|define|pragma|procedure|function)\b/imu.test(source)) {
    return null
  }

  const isPlantUml = normLang === 'plantuml' || normLang === 'puml' || normLang === 'uml' || /^@startuml\b/iu.test(firstLine)

  if (isPlantUml) {
    return dispatchPlantUml(source, lines)
  }

  if (/^sequenceDiagram\b/iu.test(firstLine)) {
    return layoutSequenceDiagram(parseSequenceDiagram(source))
  }
  if (/^classDiagram\b/iu.test(firstLine)) {
    return layoutFlowchart(parseClassDiagram(source))
  }
  if (/^stateDiagram(?:-v2)?\b/iu.test(firstLine)) {
    return layoutFlowchart(parseStateDiagram(source))
  }
  if (/^erDiagram\b/iu.test(firstLine)) {
    return layoutFlowchart(parseErDiagram(source))
  }

  return layoutFlowchart(parseFlowchart(source))
}

function dispatchPlantUml(source: string, lines: string[]) {
  // Reject PlantUML activity / swimlane / unsupported DSLs cleanly
  for (const raw of lines) {
    const t = raw.trim()
    if (t.startsWith(':') && t.endsWith(';')) return null
    if (/^(?:start|stop|if\s*\(|elseif\s*\(|endif\b|repeat\b|while\s*\(|fork\b|\|[^|]+\||nwdiag\b|salt\b)/iu.test(t)) {
      return null
    }
  }

  const body = lines.map(l => l.trim()).filter(l => l !== '' && !l.startsWith("'"))
  const hasClassSyntax = body.some(l =>
    /^(?:(?:abstract\s+)?class|interface|enum|struct)\s+/iu.test(l) ||
    /(?:<\|--|<\|\.\.|--\|>|\.\.\|>|\*--|--\*|o--|--o)/.test(l)
  )
  if (hasClassSyntax) {
    return layoutFlowchart(parseClassDiagram(source))
  }

  const hasStateStartEnd = body.some(l => /\[\*\]\s*(?:-->|->)|(?:-->|->)\s*\[\*\]/.test(l))
  if (hasStateStartEnd) {
    return layoutFlowchart(parseStateDiagram(source))
  }

  const hasComponentSyntax = body.some(l =>
    /^(?:component|usecase|package|node|folder|frame|cloud|storage|artifact)\s+/iu.test(l) ||
    /\[[^\]]+\]\s*(?:as\b|<--|-->|\.\.>|<\.\.|---)/.test(l) ||
    /\([^)]+\)\s*(?:as\b|<--|-->|\.\.>|<\.\.|---)/.test(l)
  )
  if (hasComponentSyntax) {
    return layoutFlowchart(parsePlantUmlGraph(source))
  }

  const hasSequenceSyntax = body.some(l =>
    /^(?:participant|autonumber|activate|deactivate|alt|opt|loop)\b/iu.test(l) ||
    /^(?:"[^"]+"|[A-Za-z0-9_][\w.-]*)\s*(?:<-->>|<->>|<-->|<->|-->>|->>|-->|->|<-|<--)\s*(?:"[^"]+"|[A-Za-z0-9_][\w.-]*)\s*:/.test(l)
  )
  if (hasSequenceSyntax) {
    return layoutSequenceDiagram(parseSequenceDiagram(source))
  }

  return layoutFlowchart(parsePlantUmlGraph(source))
}

export { SUPPORTED_FENCE_LANGUAGES, parseAndLayoutDiagram }
