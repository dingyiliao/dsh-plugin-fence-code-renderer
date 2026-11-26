/**
 * Parsers for UML Class, State, ER, and PlantUML Component/UseCase diagrams.
 * Each parser produces a graph object compatible with layoutFlowchart().
 */

import type { ParsedGraph } from './flowchart-core.ts'

const UML_UNSUPPORTED = /^(?:!include|!define|!pragma|!procedure|!function|@startmindmap|@startwbs|@startgantt|@startsalt|@startjson|@startyaml|@startditaa|repeat\b|while\s*\(|fork\b|\|[^|]+\||nwdiag\b|salt\b)/iu

// ==================== Class Diagram (Mermaid + PlantUML) ====================

const UML_ID = '[A-Za-z0-9_][\\w.]*(?:-[A-Za-z0-9_][\\w.]*)*'
const CLASS_REL_RE = new RegExp('^(' + UML_ID + ')(?:\\s+"([^"]*)")?\\s+(<\\|--|<\\|\\.\\.|--\\|>|\\.\\.\\|>|\\*--|--\\*|o--|--o|<-->|<--|-->|--|\\.\\.>|\\.\\.<|\\.\\.)\\s+(?:"([^"]*)"\\s+)?(' + UML_ID + ')(?:\\s*:\\s*(.*))?$', 'u')

/**
 * Parse a Mermaid classDiagram or PlantUML class diagram.
 */
function parseClassDiagram(source: string): ParsedGraph | null {
  if (typeof source !== 'string' || source.length > 20_000) return null
  const rawLines = source.replace(/\r/g, '').replace(/%%\{[\s\S]*?\}%%/gu, '').split('\n')

  const nodes = []
  const byId = new Map()
  const edges = []
  const subgraphs = []
  const sgStack = []
  let direction = 'TD'
  let sgCounter = 0
  let currentClass = null
  let inSkipBlock = false

  const ensureClassNode = (id, displayTitle = '', stereotype = '') => {
    const cleanId = String(id ?? '').trim()
    if (!cleanId || !/^[A-Za-z0-9_][\w.-]*$/u.test(cleanId)) return null
    let node = byId.get(cleanId)
    if (node === undefined) {
      if (nodes.length >= 80) return null
      node = {
        id: cleanId,
        label: displayTitle || cleanId,
        shape: 'uml_class',
        subgraphId: sgStack.length > 0 ? sgStack[sgStack.length - 1] : null,
        sections: {
          stereotype: stereotype || '',
          title: displayTitle || cleanId,
          attrs: [],
          methods: [],
        },
      }
      nodes.push(node)
      byId.set(cleanId, node)
    } else {
      if (displayTitle && node.sections.title === node.id) {
        node.sections.title = displayTitle
        node.label = displayTitle
      }
      if (stereotype && !node.sections.stereotype) {
        node.sections.stereotype = stereotype
      }
    }
    return node
  }

  for (const rawLine of rawLines) {
    const line = stripUmlComment(rawLine).trim()
    if (line === '') continue
    if (UML_UNSUPPORTED.test(line)) return null

    if (inSkipBlock) {
      if (line.includes('}')) inSkipBlock = false
      continue
    }

    if (/^(?:classDiagram|@startuml(?:\s+.*)?|@enduml|title\s+.*|hide\s+.*|show\s+.*)$/iu.test(line)) continue
    if (/^skinparam\b/iu.test(line)) {
      if (line.includes('{') && !line.includes('}')) inSkipBlock = true
      continue
    }

    const dirMatch = /^(?:direction|left\s+to\s+right\s+direction|top\s+to\s+bottom\s+direction)\s*(TD|TB|BT|LR|RL)?$/iu.exec(line)
    if (dirMatch !== null) {
      if (/left\s+to\s+right/iu.test(line)) direction = 'LR'
      else if (/top\s+to\s+bottom/iu.test(line)) direction = 'TD'
      else if (dirMatch[1]) {
        const up = dirMatch[1].toUpperCase()
        direction = up === 'LR' || up === 'RL' || up === 'BT' ? up : 'TD'
      }
      continue
    }

    if (currentClass !== null) {
      if (line === '}') {
        currentClass = null
        continue
      }
      const stereoMatch = /^<<\s*([^>]+?)\s*>>$/u.exec(line)
      if (stereoMatch !== null) {
        currentClass.sections.stereotype = stereoMatch[1].trim()
      } else if (line.includes('(') && line.includes(')')) {
        currentClass.sections.methods.push(line)
      } else if (line !== '--' && line !== '==') {
        currentClass.sections.attrs.push(line)
      }
      continue
    }

    // Namespace / package block
    const nsMatch = /^(?:namespace|package)\s+("[^"]+"|[A-Za-z0-9_][\w.-]*)(?:\s+as\s+([A-Za-z0-9_][\w.-]*))?\s*\{$/iu.exec(line)
    if (nsMatch !== null) {
      sgCounter += 1
      const title = nsMatch[1].replace(/^"|"$/g, '')
      const id = nsMatch[2] || ('ns_' + sgCounter)
      subgraphs.push({ id, title, parentId: sgStack.length > 0 ? sgStack[sgStack.length - 1] : null })
      sgStack.push(id)
      continue
    }

    if (line === '}') {
      if (sgStack.length > 0) sgStack.pop()
      continue
    }

    // Class / interface / abstract class / enum declaration
    const clsMatch = /^(?:(abstract)\s+)?(class|interface|enum|struct)\s+([A-Za-z0-9_][\w.-]*)(?:\s*\[\s*"([^"]+)"\s*\])?(?:\s+as\s+"([^"]+)")?(?:\s*<<\s*([^>]+?)\s*>>)?(?:\s*\{)?$/iu.exec(line)
    if (clsMatch !== null) {
      const isAbstract = Boolean(clsMatch[1])
      const kind = clsMatch[2].toLowerCase()
      const id = clsMatch[3]
      const title = clsMatch[4] || clsMatch[5] || id
      const stereo = clsMatch[6] || (kind === 'interface' ? 'interface' : kind === 'enum' ? 'enumeration' : isAbstract ? 'abstract' : '')
      const node = ensureClassNode(id, title, stereo)
      if (node === null) return null
      if (line.endsWith('{')) currentClass = node
      continue
    }

    // Inline member: ClassName : +member
    const inlineMatch = /^([A-Za-z0-9_][\w.-]*)\s*:\s*(.+)$/u.exec(line)
    if (inlineMatch !== null && !/[<>.*o-]{2}/.test(inlineMatch[1])) {
      const node = ensureClassNode(inlineMatch[1])
      if (node === null) return null
      const member = inlineMatch[2].trim()
      if (member.startsWith('<<') && member.endsWith('>>')) {
        node.sections.stereotype = member.slice(2, -2).trim()
      } else if (member.includes('(') && member.includes(')')) {
        node.sections.methods.push(member)
      } else {
        node.sections.attrs.push(member)
      }
      continue
    }

    // Relationship
    const relMatch = CLASS_REL_RE.exec(line)
    if (relMatch !== null) {
      const leftId = relMatch[1]
      const leftCard = relMatch[2] ?? ''
      const op = relMatch[3]
      const rightCard = relMatch[4] ?? ''
      const rightId = relMatch[5]
      const rawLabel = (relMatch[6] ?? '').trim()

      const leftNode = ensureClassNode(leftId)
      const rightNode = ensureClassNode(rightId)
      if (leftNode === null || rightNode === null) return null
      if (edges.length >= 160) return null

      const parsedOp = decodeClassRelation(op, leftId, rightId)
      const cardPart = [leftCard, rightCard].filter(Boolean).join(' .. ')
      const label = rawLabel && cardPart ? `${rawLabel} (${cardPart})` : (rawLabel || cardPart)

      edges.push({
        from: parsedOp.from,
        to: parsedOp.to,
        label,
        style: parsedOp.dashed ? 'dashed' : 'normal',
        hasStartArrow: parsedOp.startMarker !== 'none',
        hasEndArrow: parsedOp.endMarker !== 'none',
        startMarker: parsedOp.startMarker,
        endMarker: parsedOp.endMarker,
      })
      continue
    }
  }

  if (nodes.length === 0) return null
  return { direction, nodes, edges, subgraphs }
}

function decodeClassRelation(op, left, right) {
  const dashed = op.includes('..')
  // Keep inheritance pointing from child -> parent so child sits below parent in TD layout,
  // OR preserve arrow direction with hollow_triangle marker on parent!
  switch (op) {
    case '<|--':
    case '<|..':
      // Parent <|-- Child : arrow points to Parent (left), Child (right) inherits Parent
      return { from: left, to: right, dashed, startMarker: 'hollow_triangle', endMarker: 'none' }
    case '--|>':
    case '..|>':
      return { from: left, to: right, dashed, startMarker: 'none', endMarker: 'hollow_triangle' }
    case '*--':
      return { from: left, to: right, dashed: false, startMarker: 'filled_diamond', endMarker: 'none' }
    case '--*':
      return { from: left, to: right, dashed: false, startMarker: 'none', endMarker: 'filled_diamond' }
    case 'o--':
      return { from: left, to: right, dashed: false, startMarker: 'hollow_diamond', endMarker: 'none' }
    case '--o':
      return { from: left, to: right, dashed: false, startMarker: 'none', endMarker: 'hollow_diamond' }
    case '<--':
    case '..<':
      return { from: left, to: right, dashed, startMarker: 'arrow', endMarker: 'none' }
    case '<-->':
      return { from: left, to: right, dashed: false, startMarker: 'arrow', endMarker: 'arrow' }
    case '--':
    case '..':
      return { from: left, to: right, dashed, startMarker: 'none', endMarker: 'none' }
    default:
      return { from: left, to: right, dashed, startMarker: 'none', endMarker: 'arrow' }
  }
}

// ==================== State Diagram (Mermaid) ====================

/**
 * Parse a Mermaid stateDiagram / stateDiagram-v2 document.
 */
function parseStateDiagram(source: string): ParsedGraph | null {
  if (typeof source !== 'string' || source.length > 20_000) return null
  const rawLines = source.replace(/\r/g, '').replace(/%%\{[\s\S]*?\}%%/gu, '').split('\n')

  const nodes = []
  const byId = new Map()
  const edges = []
  const subgraphs = []
  const sgStack = []
  let direction = 'TD'
  let startCount = 0
  let endCount = 0
  let inNote = false

  const ensureStateNode = (id, label = '', shape = 'rounded') => {
    let node = byId.get(id)
    if (node === undefined) {
      if (nodes.length >= 80) return null
      node = {
        id,
        label: label || id,
        shape: shape || 'rounded',
        subgraphId: sgStack.length > 0 ? sgStack[sgStack.length - 1] : null,
      }
      nodes.push(node)
      byId.set(id, node)
    } else {
      if (label && node.label === node.id) node.label = label
      if (shape && node.shape === 'rounded') node.shape = shape
    }
    return node
  }

  for (const rawLine of rawLines) {
    const line = stripUmlComment(rawLine).trim()
    if (line === '') continue
    if (inNote) {
      if (/^end\s+note$/iu.test(line)) inNote = false
      continue
    }
    if (/^(?:stateDiagram(?:-v2)?|@startuml(?:\s+.*)?|@enduml|title\s+.*|hide\s+.*)$/iu.test(line)) continue
    if (/^skinparam\b/iu.test(line)) continue
    if (/^note\b/iu.test(line)) {
      if (!line.includes(':')) inNote = true
      continue
    }

    const dirMatch = /^direction\s+(TD|TB|BT|LR|RL)$/iu.exec(line)
    if (dirMatch !== null) {
      const up = dirMatch[1].toUpperCase()
      direction = up === 'LR' || up === 'RL' || up === 'BT' ? up : 'TD'
      continue
    }

    // Composite state { ... }
    const compMatch = /^state\s+(?:"([^"]+)"\s+as\s+)?([A-Za-z0-9_][\w-]*)\s*\{$/iu.exec(line)
    if (compMatch !== null) {
      const id = compMatch[2]
      const title = compMatch[1] || id
      subgraphs.push({ id, title, parentId: sgStack.length > 0 ? sgStack[sgStack.length - 1] : null })
      sgStack.push(id)
      continue
    }

    if (line === '}') {
      if (sgStack.length > 0) sgStack.pop()
      continue
    }

    // Stereotyped state: state id <<choice>> | <<fork>> | <<join>>
    const stereoState = /^state\s+([A-Za-z0-9_][\w-]*)\s+<<\s*(choice|fork|join)\s*>>$/iu.exec(line)
    if (stereoState !== null) {
      const kind = stereoState[2].toLowerCase()
      const shape = kind === 'choice' ? 'diamond' : 'state_bar'
      if (ensureStateNode(stereoState[1], '', shape) === null) return null
      continue
    }

    // state "Description" as S1
    const aliasState = /^state\s+"([^"]+)"\s+as\s+([A-Za-z0-9_][\w-]*)$/iu.exec(line)
    if (aliasState !== null) {
      if (ensureStateNode(aliasState[2], aliasState[1], 'rounded') === null) return null
      continue
    }

    // Transition: A --> B : label
    const trans = /^(\[\*\]|[A-Za-z0-9_][\w-]*)\s*(-->|->)\s*(\[\*\]|[A-Za-z0-9_][\w-]*)(?:\s*:\s*(.*))?$/u.exec(line)
    if (trans !== null) {
      const rawFrom = trans[1]
      const rawTo = trans[3]
      const label = (trans[4] ?? '').trim()

      let fromId = rawFrom
      if (rawFrom === '[*]') {
        startCount += 1
        fromId = '__state_start_' + startCount
        if (ensureStateNode(fromId, ' ', 'state_start') === null) return null
      } else if (ensureStateNode(fromId) === null) return null

      let toId = rawTo
      if (rawTo === '[*]') {
        endCount += 1
        toId = '__state_end_' + endCount
        if (ensureStateNode(toId, ' ', 'state_end') === null) return null
      } else if (ensureStateNode(toId) === null) return null

      if (edges.length >= 160) return null
      edges.push({
        from: fromId,
        to: toId,
        label,
        style: 'normal',
        hasStartArrow: false,
        hasEndArrow: true,
      })
      continue
    }

    // State description: S1 : Description
    const descMatch = /^([A-Za-z0-9_][\w-]*)\s*:\s*(.+)$/u.exec(line)
    if (descMatch !== null) {
      if (ensureStateNode(descMatch[1], descMatch[2].trim(), 'rounded') === null) return null
      continue
    }
  }

  if (nodes.length === 0) return null
  return { direction, nodes, edges, subgraphs }
}

// ==================== ER Diagram (Mermaid) ====================

const ER_CARD = '(?:\\|\\||\\|o|o\\||\\}\\||\\|\\{|\\}o|o\\{)'
const ER_REL_RE = new RegExp('^([A-Za-z0-9_][\\w-]*)\\s+(' + ER_CARD + ')(\\.\\.|--)(' + ER_CARD + ')\\s+([A-Za-z0-9_][\\w-]*)\\s*:\\s*(.+)$', 'u')

/**
 * Parse a Mermaid erDiagram document.
 */
function parseErDiagram(source: string): ParsedGraph | null {
  if (typeof source !== 'string' || source.length > 20_000) return null
  const rawLines = source.replace(/\r/g, '').replace(/%%\{[\s\S]*?\}%%/gu, '').split('\n')

  const nodes = []
  const byId = new Map()
  const edges = []
  let direction = 'TD'
  let currentEntity = null

  const ensureEntity = (id) => {
    let node = byId.get(id)
    if (node === undefined) {
      if (nodes.length >= 80) return null
      node = {
        id,
        label: id,
        shape: 'uml_class',
        subgraphId: null,
        sections: { stereotype: '', title: id, attrs: [], methods: [] },
      }
      nodes.push(node)
      byId.set(id, node)
    }
    return node
  }

  for (const rawLine of rawLines) {
    const line = stripUmlComment(rawLine).trim()
    if (line === '') continue
    if (/^erDiagram$/iu.test(line)) continue

    const dirMatch = /^direction\s+(TD|TB|BT|LR|RL)$/iu.exec(line)
    if (dirMatch !== null) {
      const up = dirMatch[1].toUpperCase()
      direction = up === 'LR' || up === 'RL' || up === 'BT' ? up : 'TD'
      continue
    }

    if (currentEntity !== null) {
      if (line === '}') {
        currentEntity = null
        continue
      }
      currentEntity.sections.attrs.push(line.replace(/\s+"[^"]*"\s*$/u, ''))
      continue
    }

    const blockMatch = /^([A-Za-z0-9_][\w-]*)\s*\{$/u.exec(line)
    if (blockMatch !== null) {
      const node = ensureEntity(blockMatch[1])
      if (node === null) return null
      currentEntity = node
      continue
    }

    const rel = ER_REL_RE.exec(line)
    if (rel !== null) {
      const left = ensureEntity(rel[1])
      const right = ensureEntity(rel[5])
      if (left === null || right === null) return null
      if (edges.length >= 160) return null
      const leftC = formatErCard(rel[2])
      const rightC = formatErCard(rel[4])
      const rawLabel = rel[6].trim().replace(/^"|"$/g, '')
      edges.push({
        from: left.id,
        to: right.id,
        label: `${leftC} ${rawLabel} ${rightC}`.trim(),
        style: rel[3] === '..' ? 'dashed' : 'normal',
        hasStartArrow: false,
        hasEndArrow: false,
        startMarker: 'none',
        endMarker: 'none',
      })
    }
  }

  if (nodes.length === 0) return null
  return { direction, nodes, edges, subgraphs: [] }
}

function formatErCard(sym) {
  if (sym === '||') return '1'
  if (sym === '|o' || sym === 'o|') return '0..1'
  if (sym === '}|' || sym === '|{') return '1..*'
  return '0..*'
}

// ==================== PlantUML Component / UseCase / Deployment ====================

/**
 * Parse a PlantUML Component / UseCase / Deployment graph.
 * Returns null for unsupported activity/swimlane/complex syntax so it falls back cleanly.
 */
function parsePlantUmlGraph(source: string): ParsedGraph | null {
  if (typeof source !== 'string' || source.length > 20_000) return null
  const rawLines = source.replace(/\r/g, '').split('\n')

  const nodes = []
  const byId = new Map()
  const edges = []
  const subgraphs = []
  const sgStack = []
  let direction = 'TD'
  let sgCounter = 0
  let inSkipBlock = false

  const ensureNode = (id, label, shape) => {
    const cleanId = String(id ?? '').trim()
    if (!cleanId || !/^[A-Za-z0-9_][\w.-]*$/u.test(cleanId)) return null
    let node = byId.get(cleanId)
    if (node === undefined) {
      if (nodes.length >= 80) return null
      node = {
        id: cleanId,
        label: label || cleanId,
        shape: shape || 'rect',
        subgraphId: sgStack.length > 0 ? sgStack[sgStack.length - 1] : null,
      }
      nodes.push(node)
      byId.set(cleanId, node)
    } else {
      if (label && node.label === node.id) node.label = label
      if (shape && node.shape === 'rect') node.shape = shape
    }
    return node
  }

  for (const rawLine of rawLines) {
    const line = stripUmlComment(rawLine).trim()
    if (line === '') continue
    if (UML_UNSUPPORTED.test(line)) return null
    if (line.startsWith(':') && line.endsWith(';')) return null
    if (/^(?:start|stop|end|if\s*\(|elseif\s*\(|else\b|endif\b)/iu.test(line)) return null

    if (inSkipBlock) {
      if (line.includes('}')) inSkipBlock = false
      continue
    }

    if (/^(?:@startuml(?:\s+.*)?|@enduml|title\s+.*|hide\s+.*)$/iu.test(line)) continue
    if (/^skinparam\b/iu.test(line)) {
      if (line.includes('{') && !line.includes('}')) inSkipBlock = true
      continue
    }
    if (/^left\s+to\s+right\s+direction$/iu.test(line)) { direction = 'LR'; continue }
    if (/^top\s+to\s+bottom\s+direction$/iu.test(line)) { direction = 'TD'; continue }

    // Container block: package / node / folder / frame / cloud / rectangle ... {
    const pkgMatch = /^(?:package|node|folder|frame|cloud|rectangle|database|together)\s+("[^"]+"|\[[^\]]+\]|[A-Za-z0-9_][\w.-]*)(?:\s+as\s+([A-Za-z0-9_][\w.-]*))?\s*\{$/iu.exec(line)
    if (pkgMatch !== null) {
      sgCounter += 1
      const title = pkgMatch[1].replace(/^["\[]|["\]]$/g, '')
      const id = pkgMatch[2] || ('pkg_' + sgCounter)
      subgraphs.push({ id, title, parentId: sgStack.length > 0 ? sgStack[sgStack.length - 1] : null })
      sgStack.push(id)
      continue
    }

    if (line === '}') {
      if (sgStack.length > 0) sgStack.pop()
      continue
    }

    // Component [Label] as Id | (UseCase) as Id | actor/database/queue/node/component/usecase
    const compDecl = /^(\[[^\]]+\]|\([^)]+\))\s*(?:as\s+([A-Za-z0-9_][\w.-]*))?$/iu.exec(line)
    if (compDecl !== null) {
      const raw = compDecl[1]
      const isUseCase = raw.startsWith('(')
      const label = raw.slice(1, -1).trim()
      const id = compDecl[2] || makeSafePlantId(label)
      if (ensureNode(id, label, isUseCase ? 'stadium' : 'rect') === null) return null
      continue
    }

    const kwDecl = /^(actor|database|queue|component|usecase|rectangle|cloud|node|storage|artifact|interface)\s+("[^"]+"|\[[^\]]+\]|\([^)]+\)|[A-Za-z0-9_][\w.-]*)(?:\s+as\s+([A-Za-z0-9_][\w.-]*))?$/iu.exec(line)
    if (kwDecl !== null) {
      const kw = kwDecl[1].toLowerCase()
      const rawLabel = kwDecl[2].replace(/^["\[\(]|["\]\)]$/g, '').trim()
      const id = kwDecl[3] || makeSafePlantId(rawLabel)
      const shape = kw === 'actor' ? 'actor'
        : kw === 'database' ? 'cylinder'
          : kw === 'usecase' ? 'stadium'
            : kw === 'interface' ? 'circle'
              : kw === 'queue' ? 'subroutine'
                : 'rect'
      if (ensureNode(id, rawLabel, shape) === null) return null
      continue
    }

    // Link: [A] --> [B] : label  or  A ..> B : label  or  (UC1) --> (UC2)
    const linkMatch = /^(\[[^\]]+\]|\([^)]+\)|[A-Za-z0-9_][\w.-]*)\s*(<-->|<--|-->|<-|->|<\.\.|\.\.>|-\.->|==>|---|--|\.\.)\s*(\[[^\]]+\]|\([^)]+\)|[A-Za-z0-9_][\w.-]*)(?:\s*:\s*(.*))?$/u.exec(line)
    if (linkMatch !== null) {
      const fromMeta = decodePlantEndpoint(linkMatch[1])
      const op = linkMatch[2]
      const toMeta = decodePlantEndpoint(linkMatch[3])
      const label = (linkMatch[4] ?? '').trim()

      const fromNode = ensureNode(fromMeta.id, fromMeta.label, fromMeta.shape)
      const toNode = ensureNode(toMeta.id, toMeta.label, toMeta.shape)
      if (fromNode === null || toNode === null) return null
      if (edges.length >= 160) return null

      const dashed = op.includes('..') || op.includes('-.')
      const thick = op.includes('==')
      const hasStart = op.startsWith('<')
      const hasEnd = op.endsWith('>')

      edges.push({
        from: fromNode.id,
        to: toNode.id,
        label,
        style: dashed ? 'dashed' : thick ? 'thick' : 'normal',
        hasStartArrow: hasStart,
        hasEndArrow: hasEnd,
      })
      continue
    }
  }

  if (nodes.length === 0 || (edges.length === 0 && nodes.length < 2)) return null
  return { direction, nodes, edges, subgraphs }
}

function decodePlantEndpoint(token) {
  const t = token.trim()
  if (t.startsWith('[') && t.endsWith(']')) {
    const label = t.slice(1, -1).trim()
    return { id: makeSafePlantId(label), label, shape: 'rect' }
  }
  if (t.startsWith('(') && t.endsWith(')')) {
    const label = t.slice(1, -1).trim()
    return { id: makeSafePlantId(label), label, shape: 'stadium' }
  }
  return { id: t, label: t, shape: 'rect' }
}

function makeSafePlantId(label) {
  const ascii = label.replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '')
  if (ascii && /^[A-Za-z0-9_]/u.test(ascii)) return ascii
  let hash = 0
  for (const ch of label) hash = ((hash << 5) - hash + (ch.codePointAt(0) ?? 0)) | 0
  return 'p_' + Math.abs(hash).toString(36)
}

function stripUmlComment(line) {
  const trimmed = line.trim()
  if (trimmed.startsWith('%%') || trimmed.startsWith("'")) return ''
  let quote = ''
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]
    if (quote !== '') {
      if (ch === '\\') { i += 1; continue }
      if (ch === quote) quote = ''
      continue
    }
    if (ch === '"' || ch === "'") { quote = ch; continue }
    if (ch === '%' && line[i + 1] === '%') return line.slice(0, i)
  }
  return line
}

export { parseClassDiagram, parseErDiagram, parsePlantUmlGraph, parseStateDiagram }
