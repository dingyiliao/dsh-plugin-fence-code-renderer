/**
 * Dependency-free Mermaid-style flowchart parser and layered layout engine.
 * Supports flowchart/graph directions, common Mermaid node shapes, subgraphs,
 * chained & fan-out edges, edge styles, CJK-aware text wrapping, cycle-safe
 * longest-path layering, crossing minimization, and smooth edge routing.
 */

import { clamp, measureTextWidth, wrapLabel } from './text-metrics.ts'

export type ParsedGraph = {
  direction: string
  nodes: Array<{
    id: string
    label: string
    shape: string
    subgraphId?: string | null
    sections?: { stereotype?: string; title?: string; attrs?: string[]; methods?: string[] }
  }>
  edges: Array<{
    from: string
    to: string
    label: string
    style?: string
    hasStartArrow?: boolean
    hasEndArrow?: boolean
    startMarker?: string
    endMarker?: string
  }>
  subgraphs?: Array<{ id: string; title: string; parentId: string | null }>
}

const MAX_SOURCE_LENGTH = 20_000
const MAX_NODES = 80
const MAX_EDGES = 160

const NON_FLOWCHART_HEADER = /^(?:sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram|journey|gantt|pie|gitGraph|mindmap|timeline|quadrantChart|requirementDiagram|C4(?:Context|Container|Component|Dynamic|Deployment)|sankey-beta|xychart-beta|block-beta|packet-beta|kanban|architecture-beta)\b/iu
const IGNORED_DIRECTIVE = /^(?:direction|classDef|class|style|linkStyle|click|accTitle|accDescr)\b/iu

const SHAPE_DEFS = [
  { open: '(((', close: ')))', shape: 'doublecircle' },
  { open: '((', close: '))', shape: 'circle' },
  { open: '([', close: '])', shape: 'stadium' },
  { open: '[[', close: ']]', shape: 'subroutine' },
  { open: '[(', close: ')]', shape: 'cylinder' },
  { open: '{{', close: '}}', shape: 'hexagon' },
  { open: '[/', close: '/]', shape: 'parallelogram' },
  { open: '[\\', close: '\\]', shape: 'parallelogram_alt' },
  { open: '[/', close: '\\]', shape: 'trapezoid' },
  { open: '[\\', close: '/]', shape: 'trapezoid_alt' },
  { open: '(', close: ')', shape: 'rounded' },
  { open: '[', close: ']', shape: 'rect' },
  { open: '{', close: '}', shape: 'diamond' },
  { open: '>', close: ']', shape: 'asymmetric' },
]

/**
 * Parse a Mermaid-style flowchart document.
 */
function parseFlowchart(source: string): ParsedGraph | null {
  if (typeof source !== 'string' || source.length > MAX_SOURCE_LENGTH) return null
  const cleaned = source.replace(/\r/g, '').replace(/%%\{[\s\S]*?\}%%/gu, '')
  const rawLines = cleaned.split('\n')

  for (const rawLine of rawLines) {
    const trimmed = rawLine.trim()
    if (trimmed === '' || trimmed.startsWith('%%')) continue
    if (NON_FLOWCHART_HEADER.test(trimmed)) return null
    break
  }

  const nodes = []
  const byId = new Map()
  const edges = []
  const subgraphs = []
  const subgraphStack = []
  let hasHeader = false
  let hasExplicitShape = false
  let direction = 'TD'
  let subgraphCounter = 0

  const currentSubgraphId = () => (subgraphStack.length > 0 ? subgraphStack[subgraphStack.length - 1] : null)

  const ensureNode = (parsed) => {
    if (parsed === null) return null
    if (parsed.explicitShape) hasExplicitShape = true
    let node = byId.get(parsed.id)
    const sgId = currentSubgraphId()
    if (node === undefined) {
      if (nodes.length >= MAX_NODES) return null
      node = {
        id: parsed.id,
        label: parsed.label,
        shape: parsed.shape,
        subgraphId: sgId,
      }
      nodes.push(node)
      byId.set(node.id, node)
    } else {
      if (parsed.explicitShape && (node.label === node.id || node.shape === 'rect')) {
        node.label = parsed.label
        node.shape = parsed.shape
      }
      if (node.subgraphId === null && sgId !== null) {
        node.subgraphId = sgId
      }
    }
    return node
  }

  for (const rawLine of rawLines) {
    let line = stripLineComment(rawLine).trim()
    if (line === '') continue

    const directive = /^(?:flowchart|graph)(?:\s+(TD|TB|BT|LR|RL))?(?:\s*;?\s*$|\s+([\s\S]*))$/iu.exec(line)
    if (directive !== null) {
      hasHeader = true
      direction = normalizeDirection(directive[1])
      line = (directive[2] ?? '').trim()
      if (line === '') continue
    }

    const sgMatch = /^subgraph\s+(.+)$/iu.exec(line)
    if (sgMatch !== null) {
      hasHeader = true
      subgraphCounter += 1
      const sg = parseSubgraphHeader(sgMatch[1], subgraphCounter, currentSubgraphId())
      subgraphs.push(sg)
      subgraphStack.push(sg.id)
      continue
    }

    if (/^end$/iu.test(line)) {
      if (subgraphStack.length > 0) subgraphStack.pop()
      continue
    }

    if (IGNORED_DIRECTIVE.test(line)) continue

    for (const statement of splitStatements(line)) {
      const stmtEdges = parseStatement(statement, ensureNode)
      if (stmtEdges === null) continue
      if (edges.length + stmtEdges.length > MAX_EDGES) return null
      edges.push(...stmtEdges)
    }
  }

  if (nodes.length === 0) return null
  if (!hasHeader && edges.length === 0 && !hasExplicitShape) return null

  const resolved = resolveSubgraphNodeAliases(nodes, edges, subgraphs)
  if (resolved.nodes.length === 0) return null

  return { direction, nodes: resolved.nodes, edges: resolved.edges, subgraphs }
}

function resolveSubgraphNodeAliases(nodes, edges, subgraphs) {
  if (subgraphs.length === 0) return { nodes, edges }
  let curNodes = nodes.slice()
  let curEdges = edges.slice()

  for (const sg of subgraphs) {
    const ghostIdx = curNodes.findIndex(n => n.id === sg.id && n.label === n.id && n.shape === 'rect')
    if (ghostIdx === -1) continue
    const members = curNodes.filter(n => n.subgraphId === sg.id && n.id !== sg.id)
    if (members.length === 0) continue

    const memberIds = new Set(members.map(m => m.id))
    const hasInnerIn = new Set()
    const hasInnerOut = new Set()
    for (const edge of curEdges) {
      if (memberIds.has(edge.from) && memberIds.has(edge.to) && edge.from !== edge.to) {
        hasInnerOut.add(edge.from)
        hasInnerIn.add(edge.to)
      }
    }
    const entries = members.filter(m => !hasInnerIn.has(m.id))
    const exits = members.filter(m => !hasInnerOut.has(m.id))
    const entryTargets = entries.length > 0 ? entries : [members[0]]
    const exitSources = exits.length > 0 ? exits : [members[members.length - 1]]

    const nextEdges = []
    for (const edge of curEdges) {
      const fromList = edge.from === sg.id ? exitSources.map(n => n.id) : [edge.from]
      const toList = edge.to === sg.id ? entryTargets.map(n => n.id) : [edge.to]
      for (const f of fromList) {
        for (const t of toList) {
          if (nextEdges.length < MAX_EDGES) {
            nextEdges.push({ ...edge, from: f, to: t })
          }
        }
      }
    }
    curEdges = nextEdges
    curNodes.splice(ghostIdx, 1)
  }

  return { nodes: curNodes, edges: curEdges }
}

function normalizeDirection(value) {
  const upper = String(value ?? '').toUpperCase()
  return upper === 'LR' || upper === 'RL' || upper === 'BT' ? upper : 'TD'
}

function parseSubgraphHeader(raw, index, parentId) {
  const trimmed = raw.trim()
  const bracketed = /^([A-Za-z0-9_][\w-]*)\s*\[([\s\S]+)\]$/u.exec(trimmed)
  if (bracketed !== null) {
    return { id: bracketed[1], title: cleanLabel(bracketed[2]), parentId }
  }
  return { id: 'subgraph_' + index, title: cleanLabel(trimmed), parentId }
}

/**
 * Strip %% comments outside quotes and bracketed labels.
 */
function stripLineComment(line) {
  let quote = ''
  let depth = 0
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]
    if (quote !== '') {
      if (ch === '\\') { i += 1; continue }
      if (ch === quote) quote = ''
      continue
    }
    if (ch === '"' || ch === "'") { quote = ch; continue }
    if (ch === '[' || ch === '(' || ch === '{') { depth += 1; continue }
    if ((ch === ']' || ch === ')' || ch === '}') && depth > 0) { depth -= 1; continue }
    if (depth === 0 && ch === '%' && line[i + 1] === '%') {
      return line.slice(0, i)
    }
  }
  return line
}

/**
 * Split a line on ';' only when outside quotes and node brackets.
 */
function splitStatements(line) {
  const result = []
  let quote = ''
  let depth = 0
  let start = 0
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]
    if (quote !== '') {
      if (ch === '\\') { i += 1; continue }
      if (ch === quote) quote = ''
      continue
    }
    if (ch === '"' || ch === "'") { quote = ch; continue }
    if (ch === '[' || ch === '(' || ch === '{') { depth += 1; continue }
    if ((ch === ']' || ch === ')' || ch === '}') && depth > 0) { depth -= 1; continue }
    if (depth === 0 && ch === ';') {
      const part = line.slice(start, i).trim()
      if (part !== '') result.push(part)
      start = i + 1
    }
  }
  const tail = line.slice(start).trim()
  if (tail !== '') result.push(tail)
  return result
}

/**
 * Parse a single statement possibly containing '&' groups and chained edges.
 */
function parseStatement(statement, ensureNode) {
  let pos = skipSpaces(statement, 0)
  if (pos >= statement.length) return []

  const firstGroup = readNodeGroup(statement, pos, ensureNode)
  if (firstGroup === null || firstGroup.nodes.length === 0) return null

  pos = skipSpaces(statement, firstGroup.nextPos)
  if (pos >= statement.length) return []

  const result = []
  let fromNodes = firstGroup.nodes

  while (pos < statement.length) {
    const edgeMatch = matchEdgeOperator(statement, pos)
    if (edgeMatch === null) break
    pos = skipSpaces(statement, edgeMatch.nextPos)
    const toGroup = readNodeGroup(statement, pos, ensureNode)
    if (toGroup === null || toGroup.nodes.length === 0) break

    for (const fromNode of fromNodes) {
      for (const toNode of toGroup.nodes) {
        result.push({
          from: fromNode.id,
          to: toNode.id,
          label: edgeMatch.label,
          style: edgeMatch.style,
          hasStartArrow: edgeMatch.hasStartArrow,
          hasEndArrow: edgeMatch.hasEndArrow,
        })
      }
    }
    fromNodes = toGroup.nodes
    pos = skipSpaces(statement, toGroup.nextPos)
  }

  return result
}

function skipSpaces(str, pos) {
  while (pos < str.length && (str[pos] === ' ' || str[pos] === '\t')) pos += 1
  return pos
}

function readNodeGroup(str, startPos, ensureNode) {
  const nodes = []
  let pos = startPos
  while (pos < str.length) {
    pos = skipSpaces(str, pos)
    const token = readNodeTokenAt(str, pos)
    if (token === null) break
    const node = ensureNode(token.node)
    if (node !== null) nodes.push(node)
    pos = skipSpaces(str, token.nextPos)
    if (str[pos] === '&') {
      pos += 1
      continue
    }
    break
  }
  if (nodes.length === 0) return null
  return { nodes, nextPos: pos }
}

/**
 * Read a node identifier and optional shape brackets at str[pos].
 */
function readNodeTokenAt(str, pos) {
  const slice = str.slice(pos)
  const idMatch = /^([A-Za-z0-9_][\w-]*)/u.exec(slice)
  if (idMatch === null) return null

  const id = idMatch[1]
  let cur = pos + id.length
  const afterId = skipSpaces(str, cur)
  const openCh = str[afterId]

  if (openCh !== '[' && openCh !== '(' && openCh !== '{' && openCh !== '>') {
    cur = skipClassSuffix(str, cur)
    return { node: { id, label: id, shape: 'rect', explicitShape: false }, nextPos: cur }
  }

  // Only treat whitespace before shape opener if it's directly attached or standard bracket
  if (afterId > cur && openCh === '>') {
    // '>' after space is likely not asymmetric node syntax
    cur = skipClassSuffix(str, cur)
    return { node: { id, label: id, shape: 'rect', explicitShape: false }, nextPos: cur }
  }

  // Scan balanced shape payload starting at afterId
  const endPos = scanShapeEnd(str, afterId)
  if (endPos === -1) {
    cur = skipClassSuffix(str, cur)
    return { node: { id, label: id, shape: 'rect', explicitShape: false }, nextPos: cur }
  }

  const rawShape = str.slice(afterId, endPos)
  const parsedShape = decodeNodeShape(rawShape)
  const nextPos = skipClassSuffix(str, endPos)

  return {
    node: {
      id,
      label: parsedShape.label,
      shape: parsedShape.shape,
      explicitShape: true,
    },
    nextPos,
  }
}

function skipClassSuffix(str, pos) {
  const match = /^:::[A-Za-z0-9_-]+/u.exec(str.slice(pos))
  return match !== null ? pos + match[0].length : pos
}

function scanShapeEnd(str, start) {
  const open = str[start]
  const expectedTopClose = open === '(' ? ')' : open === '{' ? '}' : ']'
  let quote = ''
  let depth = 0
  for (let i = start; i < str.length; i += 1) {
    const ch = str[i]
    if (quote !== '') {
      if (ch === '\\') { i += 1; continue }
      if (ch === quote) quote = ''
      continue
    }
    if (ch === '"' || ch === "'") { quote = ch; continue }
    if (ch === '[' || ch === '(' || ch === '{') {
      depth += 1
      continue
    }
    if (ch === ']' || ch === ')' || ch === '}') {
      if (depth > 0) depth -= 1
      if (depth === 0 && ch === expectedTopClose) {
        // Consume any extra closing chars belonging to double/triple openers e.g. )) or )))
        return i + 1
      }
      if (depth === 0 && open === '>') return i + 1
    }
  }
  return -1
}

function decodeNodeShape(raw) {
  for (const def of SHAPE_DEFS) {
    if (raw.startsWith(def.open) && raw.endsWith(def.close) && raw.length >= def.open.length + def.close.length) {
      return {
        shape: def.shape,
        label: cleanLabel(raw.slice(def.open.length, raw.length - def.close.length)),
      }
    }
  }
  return { shape: 'rect', label: cleanLabel(raw) }
}

function cleanLabel(value) {
  const text = String(value ?? '').trim()
  if (text.length >= 2 && ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'")))) {
    return text.slice(1, -1) || ' '
  }
  return text || ' '
}

/**
 * Match a Mermaid edge operator (with optional inline or pipe label) at str[pos].
 */
function matchEdgeOperator(str, pos) {
  const slice = str.slice(pos)
  const patterns = [
    // Bidirectional arrows
    { re: /^<--+>\s*\|([^|]*)\|/u, style: 'normal', start: true, end: true, labelGroup: 1 },
    { re: /^<--+>/u, style: 'normal', start: true, end: true, labelGroup: 0 },
    { re: /^<-\.+->\s*\|([^|]*)\|/u, style: 'dashed', start: true, end: true, labelGroup: 1 },
    { re: /^<-\.+->/u, style: 'dashed', start: true, end: true, labelGroup: 0 },
    { re: /^<==+>\s*\|([^|]*)\|/u, style: 'thick', start: true, end: true, labelGroup: 1 },
    { re: /^<==+>/u, style: 'thick', start: true, end: true, labelGroup: 0 },

    // Inline labeled edges (-- label -->, -. label .->, == label ==>, -- label ---)
    { re: /^--\s*\|([^|]*)\|\s*-+>/u, style: 'normal', start: false, end: true, labelGroup: 1 },
    { re: /^--\s+((?:(?!--+>|---).)+?)\s+-+>/u, style: 'normal', start: false, end: true, labelGroup: 1 },
    { re: /^-\.\s+((?:(?!\.->|\.-).)+?)\s+\.->/u, style: 'dashed', start: false, end: true, labelGroup: 1 },
    { re: /^-\.\s*\|([^|]*)\|\s*\.->/u, style: 'dashed', start: false, end: true, labelGroup: 1 },
    { re: /^==\s*\|([^|]*)\|\s*=+>/u, style: 'thick', start: false, end: true, labelGroup: 1 },
    { re: /^==\s+((?:(?!==+>|===).)+?)\s+=+>/u, style: 'thick', start: false, end: true, labelGroup: 1 },
    { re: /^--\s*\|([^|]*)\|\s*---+/u, style: 'normal', start: false, end: false, labelGroup: 1 },
    { re: /^--\s+((?:(?!--+>|---).)+?)\s+---+/u, style: 'normal', start: false, end: false, labelGroup: 1 },
    { re: /^-\.\s+((?:(?!\.->|\.-).)+?)\s+\.-/u, style: 'dashed', start: false, end: false, labelGroup: 1 },

    // Standard operators with optional |label|
    { re: /^-\.+->\s*\|([^|]*)\|/u, style: 'dashed', start: false, end: true, labelGroup: 1 },
    { re: /^-\.+->/u, style: 'dashed', start: false, end: true, labelGroup: 0 },
    { re: /^-\.-+\s*\|([^|]*)\|/u, style: 'dashed', start: false, end: false, labelGroup: 1 },
    { re: /^-\.-+/u, style: 'dashed', start: false, end: false, labelGroup: 0 },
    { re: /^==+>\s*\|([^|]*)\|/u, style: 'thick', start: false, end: true, labelGroup: 1 },
    { re: /^==+>/u, style: 'thick', start: false, end: true, labelGroup: 0 },
    { re: /^===+\s*\|([^|]*)\|/u, style: 'thick', start: false, end: false, labelGroup: 1 },
    { re: /^===+/u, style: 'thick', start: false, end: false, labelGroup: 0 },
    { re: /^--+>\s*\|([^|]*)\|/u, style: 'normal', start: false, end: true, labelGroup: 1 },
    { re: /^--+>/u, style: 'normal', start: false, end: true, labelGroup: 0 },
    { re: /^---+\s*\|([^|]*)\|/u, style: 'normal', start: false, end: false, labelGroup: 1 },
    { re: /^---+/u, style: 'normal', start: false, end: false, labelGroup: 0 },
  ]

  for (const pat of patterns) {
    const m = pat.re.exec(slice)
    if (m !== null) {
      const rawLabel = pat.labelGroup > 0 ? m[pat.labelGroup] : ''
      return {
        style: pat.style,
        hasStartArrow: pat.start,
        hasEndArrow: pat.end,
        label: rawLabel ? cleanLabel(rawLabel) : '',
        nextPos: pos + m[0].length,
      }
    }
  }
  return null
}

/**
 * Compute node dimensions, ranks, crossing-minimized coordinates, subgraphs, and routed edge paths.
 */
function layoutFlowchart(graph: ParsedGraph | null) {
  if (graph === null || graph.nodes.length === 0) return null

  const horizontal = graph.direction === 'LR' || graph.direction === 'RL'
  const flipMain = graph.direction === 'RL' || graph.direction === 'BT'
  const margin = 28
  const crossGap = (graph.subgraphs?.length ?? 0) > 0 ? 42 : 32
  const baseRankGap = horizontal ? 60 : 52

  // 1. Measure every real node
  const nodeMeta = new Map()
  for (const node of graph.nodes) {
    const dim = computeNodeDimensions(node)
    nodeMeta.set(node.id, {
      ...node,
      subgraphId: node.subgraphId ?? null,
      ...dim,
      isDummy: false,
    })
  }

  // 2. Break cycles via DFS & assign longest-path ranks
  const { isBackEdge, ranks } = assignRanks(graph.nodes, graph.edges)

  // 3. Build rank layers + insert dummy waypoints for skip-level DAG edges
  const layers = new Map<number, any[]>()
  const ensureLayer = (r) => {
    if (!layers.has(r)) layers.set(r, [])
    return layers.get(r)
  }
  for (const node of graph.nodes) {
    const r = ranks.get(node.id) ?? 0
    const meta = nodeMeta.get(node.id)
    meta.rank = r
    ensureLayer(r).push(meta)
  }

  const dagAdjOut = new Map<string, string[]>()
  const dagAdjIn = new Map<string, string[]>()
  const addDagLink = (uId, vId) => {
    if (!dagAdjOut.has(uId)) dagAdjOut.set(uId, [])
    if (!dagAdjIn.has(vId)) dagAdjIn.set(vId, [])
    dagAdjOut.get(uId).push(vId)
    dagAdjIn.get(vId).push(uId)
  }

  const edgeRoutingChain = new Map()
  let dummyCounter = 0

  graph.edges.forEach((edge, edgeIndex) => {
    if (isBackEdge[edgeIndex]) return
    const rFrom = ranks.get(edge.from) ?? 0
    const rTo = ranks.get(edge.to) ?? 0
    const chain = [edge.from]
    for (let r = rFrom + 1; r < rTo; r += 1) {
      dummyCounter += 1
      const dummyId = '__dummy_' + dummyCounter
      const dummyNode = {
        id: dummyId,
        isDummy: true,
        rank: r,
        width: horizontal ? 12 : 20,
        height: horizontal ? 20 : 12,
        lines: [],
        subgraphId: null,
      }
      nodeMeta.set(dummyId, dummyNode)
      ensureLayer(r).push(dummyNode)
      addDagLink(chain[chain.length - 1], dummyId)
      chain.push(dummyId)
    }
    addDagLink(chain[chain.length - 1], edge.to)
    chain.push(edge.to)
    edgeRoutingChain.set(edgeIndex, chain)
  })

  const maxRank = Math.max(...layers.keys())

  // 4. Crossing minimization (barycenter sweeps)
  for (let sweep = 0; sweep < 4; sweep += 1) {
    for (let r = 1; r <= maxRank; r += 1) {
      sortLayerByBarycenter(layers.get(r) ?? [], layers.get(r - 1) ?? [], dagAdjIn)
    }
    for (let r = maxRank - 1; r >= 0; r -= 1) {
      sortLayerByBarycenter(layers.get(r) ?? [], layers.get(r + 1) ?? [], dagAdjOut)
    }
  }

  // 5. Compute rank-gap padding (extra gap if labeled edges cross between ranks r and r+1)
  const rankGapAfter = new Map<number, number>()
  for (let r = 0; r < maxRank; r += 1) {
    let extra = 0
    for (let i = 0; i < graph.edges.length; i += 1) {
      if (isBackEdge[i]) continue
      const edge = graph.edges[i]
      if (!edge.label || edge.label.trim() === '') continue
      const rFrom = ranks.get(edge.from) ?? 0
      const rTo = ranks.get(edge.to) ?? 0
      if (rFrom <= r && r < rTo && rTo - rFrom === 1) {
        const lblDim = measureEdgeLabel(edge.label)
        extra = Math.max(extra, horizontal ? lblDim.width + 20 : lblDim.height + 16)
      }
    }
    // Check if subgraphs start/end between r and r+1
    rankGapAfter.set(r, Math.max(baseRankGap, extra))
  }

  // Add extra gap if a subgraph starts at rank r+1 with a title header
  const subgraphs = graph.subgraphs ?? []
  if (subgraphs.length > 0 && !horizontal) {
    const sgMinRank = new Map<string, number>()
    for (const node of graph.nodes) {
      if (!node.subgraphId) continue
      const r = ranks.get(node.id) ?? 0
      if (!sgMinRank.has(node.subgraphId) || r < sgMinRank.get(node.subgraphId)) {
        sgMinRank.set(node.subgraphId, r)
      }
    }
    for (const minR of sgMinRank.values()) {
      if (minR > 0) {
        rankGapAfter.set(minR - 1, Math.max(rankGapAfter.get(minR - 1) ?? baseRankGap, baseRankGap + 24))
      }
    }
  }

  // 6. Position nodes along main axis and cross axis
  const rankMainSize = new Map()
  const rankCrossSpan = new Map()
  for (let r = 0; r <= maxRank; r += 1) {
    const group = layers.get(r) ?? []
    let maxM = 0
    let span = 0
    group.forEach((node, idx) => {
      const mSize = horizontal ? node.width : node.height
      const cSize = horizontal ? node.height : node.width
      if (mSize > maxM) maxM = mSize
      span += cSize
      if (idx > 0) span += crossGap
    })
    rankMainSize.set(r, Math.max(24, maxM))
    rankCrossSpan.set(r, span)
  }

  const maxCrossSpan = Math.max(...rankCrossSpan.values())

  let mainCursor = margin
  for (let r = 0; r <= maxRank; r += 1) {
    const group = layers.get(r) ?? []
    const mSize = rankMainSize.get(r) ?? 44
    const centerMain = mainCursor + mSize / 2
    const span = rankCrossSpan.get(r) ?? 0
    let crossCursor = margin + (maxCrossSpan - span) / 2
    for (const node of group) {
      const cSize = horizontal ? node.height : node.width
      node.main = centerMain
      node.cross = crossCursor + cSize / 2
      node.mainSize = horizontal ? node.width : node.height
      node.crossSize = cSize
      crossCursor += cSize + crossGap
    }
    mainCursor += mSize + (r < maxRank ? (rankGapAfter.get(r) ?? baseRankGap) : 0)
  }

  // Mild cross-axis alignment pull toward connected parents/children (without overlapping neighbors)
  alignCrossPositions(layers, maxRank, dagAdjIn, dagAdjOut, crossGap)

  const contentMainEnd = mainCursor + margin
  let minCross = Infinity
  let maxCross = -Infinity
  for (const node of nodeMeta.values()) {
    minCross = Math.min(minCross, node.cross - node.crossSize / 2)
    maxCross = Math.max(maxCross, node.cross + node.crossSize / 2)
  }

  // 7. Compute edge port offsets & route all edges in canonical (main, cross) coordinates
  const edgeGeometries = routeAllEdges(
    graph.edges,
    nodeMeta,
    isBackEdge,
    edgeRoutingChain,
    minCross,
    maxCross,
    horizontal,
    flipMain,
  )

  // 8. Compute bounding box including back-edges, self-loops, edge labels, and subgraphs
  let boundMainMin = margin
  let boundMainMax = contentMainEnd - margin
  let boundCrossMin = minCross
  let boundCrossMax = maxCross

  for (const eg of edgeGeometries) {
    for (const pt of eg.extents) {
      boundMainMin = Math.min(boundMainMin, pt.main)
      boundMainMax = Math.max(boundMainMax, pt.main)
      boundCrossMin = Math.min(boundCrossMin, pt.cross)
      boundCrossMax = Math.max(boundCrossMax, pt.cross)
    }
  }

  // Compute subgraph boxes in canonical space
  const sgPadTop = 32
  const sgPadSide = 18
  const sgPadBottom = 18
  const subgraphBoxes = computeSubgraphBoxes(subgraphs, graph.nodes, nodeMeta, horizontal, sgPadTop, sgPadSide, sgPadBottom)

  for (const sg of subgraphBoxes) {
    boundMainMin = Math.min(boundMainMin, sg.mainMin)
    boundMainMax = Math.max(boundMainMax, sg.mainMax)
    boundCrossMin = Math.min(boundCrossMin, sg.crossMin)
    boundCrossMax = Math.max(boundCrossMax, sg.crossMax)
  }

  const shiftMain = margin - boundMainMin
  const shiftCross = margin - boundCrossMin
  const totalMain = Math.max(1, Math.ceil(boundMainMax - boundMainMin + margin * 2))
  const totalCross = Math.max(1, Math.ceil(boundCrossMax - boundCrossMin + margin * 2))

  const width = horizontal ? totalMain : totalCross
  const height = horizontal ? totalCross : totalMain

  const toXY = (m, c) => {
    const sm = m + shiftMain
    const sc = c + shiftCross
    const finalM = flipMain ? totalMain - sm : sm
    return horizontal ? { x: finalM, y: sc } : { x: sc, y: finalM }
  }

  // 9. Finalize positioned nodes, edges, and subgraphs
  const positionedNodes = graph.nodes.map(node => {
    const meta = nodeMeta.get(node.id)
    const pt = toXY(meta.main, meta.cross)
    const item: { id: string; label: string; shape: string; subgraphId: string | null; x: number; y: number; width: number; height: number; lines: string[]; sections?: { stereotype?: string } } = {
      id: meta.id,
      label: meta.label,
      shape: meta.shape,
      subgraphId: meta.subgraphId,
      x: pt.x,
      y: pt.y,
      width: meta.width,
      height: meta.height,
      lines: meta.lines,
    }
    if (meta.sections !== undefined) item.sections = meta.sections
    return item
  })

  const positionedEdges = graph.edges.map((edge, index) => {
    const eg = edgeGeometries[index]
    const path = buildSvgPath(eg.segments, toXY)
    const lblPt = toXY(eg.labelMain, eg.labelCross)
    const lblDim = edge.label && edge.label.trim() !== '' ? measureEdgeLabel(edge.label) : { width: 0, height: 0, lines: [] }
    const hasStart = edge.hasStartArrow ?? false
    const hasEnd = edge.hasEndArrow ?? true
    return {
      from: edge.from,
      to: edge.to,
      label: edge.label ?? '',
      style: edge.style ?? 'normal',
      hasStartArrow: hasStart,
      hasEndArrow: hasEnd,
      startMarker: edge.startMarker ?? (hasStart ? 'arrow' : 'none'),
      endMarker: edge.endMarker ?? (hasEnd ? 'arrow' : 'none'),
      isBackEdge: isBackEdge[index],
      path,
      labelX: lblPt.x,
      labelY: lblPt.y,
      labelWidth: lblDim.width,
      labelHeight: lblDim.height,
      labelLines: lblDim.lines,
    }
  })

  const positionedSubgraphs = subgraphBoxes.map(sg => {
    const p1 = toXY(sg.mainMin, sg.crossMin)
    const p2 = toXY(sg.mainMax, sg.crossMax)
    const x = Math.min(p1.x, p2.x)
    const y = Math.min(p1.y, p2.y)
    return {
      id: sg.id,
      title: sg.title,
      x,
      y,
      width: Math.abs(p2.x - p1.x),
      height: Math.abs(p2.y - p1.y),
    }
  })

  const maxNodeWidth = Math.max(...positionedNodes.map(n => n.width))
  const maxNodeHeight = Math.max(...positionedNodes.map(n => n.height))

  return {
    kind: 'flowchart' as const,
    direction: graph.direction,
    width,
    height,
    nodeWidth: maxNodeWidth,
    nodeHeight: maxNodeHeight,
    nodes: positionedNodes,
    edges: positionedEdges,
    subgraphs: positionedSubgraphs,
  }
}

function computeNodeDimensions(node) {
  if (node.shape === 'state_start' || node.shape === 'state_end') {
    return { width: 28, height: 28, lines: [] }
  }
  if (node.shape === 'state_bar') {
    return { width: 96, height: 10, lines: [] }
  }
  if (node.shape === 'uml_class' && node.sections) {
    const s = node.sections
    const allLines = [
      s.stereotype ? '«' + s.stereotype + '»' : '',
      s.title,
      ...(s.attrs ?? []),
      ...(s.methods ?? []),
    ].filter(Boolean)
    const maxW = Math.max(80, ...allLines.map(l => measureTextWidth(l, 12)))
    const width = clamp(maxW + 28, 116, 300)
    const headerH = s.stereotype ? 44 : 30
    const attrsH = (s.attrs?.length ?? 0) > 0 ? s.attrs.length * 18 + 12 : 0
    const methodsH = (s.methods?.length ?? 0) > 0 ? s.methods.length * 18 + 12 : 0
    const height = Math.max(40, headerH + attrsH + methodsH)
    return { width, height, lines: [s.title] }
  }
  if (node.shape === 'actor') {
    const lines = wrapLabel(node.label, 140, 13)
    const textWidth = Math.max(...lines.map(line => measureTextWidth(line, 13)))
    return {
      width: clamp(textWidth + 28, 76, 180),
      height: Math.max(66, 44 + lines.length * 17),
      lines,
    }
  }

  const maxLineWidth = node.shape === 'diamond' ? 132 : 164
  const lines = wrapLabel(node.label, maxLineWidth, 13)
  const textWidth = Math.max(...lines.map(line => measureTextWidth(line, 13)))
  const textHeight = lines.length * 18

  let width
  let height
  switch (node.shape) {
    case 'diamond':
      width = clamp(Math.ceil(textWidth * 1.5 + 48), 108, 280)
      height = Math.max(68, Math.ceil(textHeight * 1.55 + 32))
      break
    case 'circle':
    case 'doublecircle': {
      const pad = node.shape === 'doublecircle' ? 40 : 32
      if (lines.length === 1 && textWidth <= 72) {
        const d = clamp(Math.max(textWidth, textHeight) + pad, 58, 128)
        width = d
        height = d
      } else {
        width = clamp(textWidth + pad + 18, 76, 220)
        height = Math.max(58, textHeight + pad + 8)
      }
      break
    }
    case 'stadium':
      width = clamp(textWidth + 44, 92, 248)
      height = Math.max(42, textHeight + 22)
      break
    case 'subroutine':
      width = clamp(textWidth + 52, 100, 256)
      height = Math.max(44, textHeight + 24)
      break
    case 'cylinder':
      width = clamp(textWidth + 40, 92, 240)
      height = Math.max(56, textHeight + 34)
      break
    case 'hexagon':
    case 'parallelogram':
    case 'parallelogram_alt':
    case 'trapezoid':
    case 'trapezoid_alt':
      width = clamp(textWidth + 56, 104, 264)
      height = Math.max(46, textHeight + 24)
      break
    case 'asymmetric':
      width = clamp(textWidth + 48, 96, 250)
      height = Math.max(44, textHeight + 24)
      break
    default:
      width = clamp(textWidth + 36, 84, 240)
      height = Math.max(44, textHeight + 24)
      break
  }

  return { width, height, lines }
}

function measureEdgeLabel(label) {
  const lines = wrapLabel(label, 140, 12)
  const textWidth = Math.max(...lines.map(l => measureTextWidth(l, 12)))
  return {
    width: Math.max(28, textWidth + 16),
    height: Math.max(20, lines.length * 15 + 6),
    lines,
  }
}

/**
 * Detect cycle back-edges via DFS and assign longest-path ranks on the resulting DAG.
 */
function assignRanks(nodes, edges) {
  const outgoing = new Map<string, Array<{ to: string; index: number }>>(nodes.map(n => [n.id, []]))
  const inCount = new Map<string, number>(nodes.map(n => [n.id, 0]))
  edges.forEach((edge, index) => {
    outgoing.get(edge.from)?.push({ to: edge.to, index })
    inCount.set(edge.to, (inCount.get(edge.to) ?? 0) + 1)
  })

  const state = new Map<string, number>() // 0 = unvisited, 1 = visiting, 2 = visited
  const isBackEdge = edges.map(() => false)

  const dfs = (u) => {
    state.set(u, 1)
    for (const item of outgoing.get(u) ?? []) {
      if (item.to === u) {
        isBackEdge[item.index] = true
        continue
      }
      const st = state.get(item.to) ?? 0
      if (st === 1) {
        isBackEdge[item.index] = true
      } else if (st === 0) {
        dfs(item.to)
      }
    }
    state.set(u, 2)
  }

  const roots = nodes.filter(n => (inCount.get(n.id) ?? 0) === 0).map(n => n.id)
  for (const r of roots) {
    if ((state.get(r) ?? 0) === 0) dfs(r)
  }
  for (const n of nodes) {
    if ((state.get(n.id) ?? 0) === 0) dfs(n.id)
  }

  // Kahn's topological longest-path ranking on DAG edges
  const dagOut = new Map<string, string[]>(nodes.map(n => [n.id, []]))
  const dagIn = new Map<string, number>(nodes.map(n => [n.id, 0]))
  edges.forEach((edge, index) => {
    if (isBackEdge[index]) return
    dagOut.get(edge.from)?.push(edge.to)
    dagIn.set(edge.to, (dagIn.get(edge.to) ?? 0) + 1)
  })

  const ranks = new Map<string, number>(nodes.map(n => [n.id, 0]))
  const queue = nodes.filter(n => (dagIn.get(n.id) ?? 0) === 0).map(n => n.id)
  const topoOrder = []

  while (queue.length > 0) {
    const u = queue.shift()
    topoOrder.push(u)
    const rU = ranks.get(u) ?? 0
    for (const v of dagOut.get(u) ?? []) {
      if ((ranks.get(v) ?? 0) < rU + 1) {
        ranks.set(v, rU + 1)
      }
      const rem = (dagIn.get(v) ?? 1) - 1
      dagIn.set(v, rem)
      if (rem === 0) queue.push(v)
    }
  }

  // Pull root nodes closer to their shallowest child so side-inputs don't float at rank 0
  const dagInCountOrig = new Map<string, number>(nodes.map(n => [n.id, 0]))
  edges.forEach((edge, index) => {
    if (!isBackEdge[index]) dagInCountOrig.set(edge.to, (dagInCountOrig.get(edge.to) ?? 0) + 1)
  })
  for (let i = topoOrder.length - 1; i >= 0; i -= 1) {
    const u = topoOrder[i]
    const children = dagOut.get(u) ?? []
    if ((dagInCountOrig.get(u) ?? 0) === 0 && children.length > 0) {
      const minChildRank = Math.min(...children.map(v => ranks.get(v) ?? 0))
      if (minChildRank - 1 > (ranks.get(u) ?? 0)) {
        ranks.set(u, minChildRank - 1)
      }
    }
  }

  return { isBackEdge, ranks }
}

function sortLayerByBarycenter(layer, neighborLayer, adj) {
  if (layer.length <= 1 || neighborLayer.length === 0) return
  const neighborPos = new Map<string, number>()
  neighborLayer.forEach((node, idx) => neighborPos.set(node.id, idx))

  const scores = new Map<string, number>()
  layer.forEach((node, idx) => {
    const neighbors = (adj.get(node.id) ?? []).filter(id => neighborPos.has(id))
    if (neighbors.length === 0) {
      scores.set(node.id, idx)
    } else {
      const avg = neighbors.reduce((sum, id) => sum + neighborPos.get(id), 0) / neighbors.length
      scores.set(node.id, avg)
    }
  })

  const origIdx = new Map<string, number>(layer.map((n, i) => [n.id, i]))
  layer.sort((a, b) => {
    const diff = (scores.get(a.id) ?? 0) - (scores.get(b.id) ?? 0)
    return Math.abs(diff) > 1e-6 ? diff : (origIdx.get(a.id) ?? 0) - (origIdx.get(b.id) ?? 0)
  })
}

function alignCrossPositions(layers, maxRank, dagAdjIn, dagAdjOut, crossGap) {
  const byId = new Map()
  for (let r = 0; r <= maxRank; r += 1) {
    for (const node of layers.get(r) ?? []) byId.set(node.id, node)
  }

  for (let pass = 0; pass < 2; pass += 1) {
    for (let r = 1; r <= maxRank; r += 1) {
      nudgeLayerToward(layers.get(r) ?? [], dagAdjIn, byId, crossGap)
    }
    for (let r = maxRank - 1; r >= 0; r -= 1) {
      nudgeLayerToward(layers.get(r) ?? [], dagAdjOut, byId, crossGap)
    }
  }
}

function nudgeLayerToward(layer, adj, byId, crossGap) {
  if (layer.length === 0) return
  for (let i = 0; i < layer.length; i += 1) {
    const node = layer[i]
    const neighbors = (adj.get(node.id) ?? []).map(id => byId.get(id)).filter(Boolean)
    if (neighbors.length === 0) continue
    const target = neighbors.reduce((sum, n) => sum + n.cross, 0) / neighbors.length
    const prev = i > 0 ? layer[i - 1] : null
    const next = i + 1 < layer.length ? layer[i + 1] : null
    const minC = prev !== null ? prev.cross + prev.crossSize / 2 + crossGap + node.crossSize / 2 : -Infinity
    const maxC = next !== null ? next.cross - next.crossSize / 2 - crossGap - node.crossSize / 2 : Infinity
    node.cross = clamp(target, minC, maxC)
  }
}

/**
 * Compute shape boundary offset along main axis given a cross-axis port offset.
 */
function shapeMainReach(node, crossOffset, horizontal, isEntry) {
  const hm = node.mainSize / 2
  const hc = node.crossSize / 2
  const ratio = Math.min(0.95, Math.abs(crossOffset) / Math.max(1, hc))
  if (node.shape === 'diamond') {
    return hm * (1 - ratio)
  }
  if (node.shape === 'circle' || node.shape === 'doublecircle' || node.shape === 'state_start' || node.shape === 'state_end') {
    return hm * Math.sqrt(Math.max(0, 1 - ratio * ratio))
  }
  if (horizontal && node.shape === 'hexagon') {
    return hm - 14 * ratio
  }
  if (horizontal && isEntry && node.shape === 'asymmetric') {
    return hm - 12 * (1 - ratio)
  }
  return hm
}

function routeAllEdges(edges, nodeMeta, isBackEdge, edgeRoutingChain, minCross, maxCross, horizontal, flipMain) {
  // Group forward edges by exit and entry node to distribute ports evenly
  const outEdgesByNode = new Map()
  const inEdgesByNode = new Map()
  const pairGroups = new Map()

  edges.forEach((edge, index) => {
    if (isBackEdge[index]) return
    if (!outEdgesByNode.has(edge.from)) outEdgesByNode.set(edge.from, [])
    if (!inEdgesByNode.has(edge.to)) inEdgesByNode.set(edge.to, [])
    outEdgesByNode.get(edge.from).push(index)
    inEdgesByNode.get(edge.to).push(index)
    const pk = edge.from + '->' + edge.to
    if (!pairGroups.has(pk)) pairGroups.set(pk, [])
    pairGroups.get(pk).push(index)
  })

  // Sort outgoing/incoming edges by target/source cross position so ports don't cross immediately
  for (const list of outEdgesByNode.values()) {
    list.sort((a, b) => (nodeMeta.get(edges[a].to)?.cross ?? 0) - (nodeMeta.get(edges[b].to)?.cross ?? 0))
  }
  for (const list of inEdgesByNode.values()) {
    list.sort((a, b) => (nodeMeta.get(edges[a].from)?.cross ?? 0) - (nodeMeta.get(edges[b].from)?.cross ?? 0))
  }

  const graphCenterCross = (minCross + maxCross) / 2
  let rightChannelIdx = 0
  let leftChannelIdx = 0
  const geometries = new Array(edges.length)

  edges.forEach((edge, index) => {
    const from = nodeMeta.get(edge.from)
    const to = nodeMeta.get(edge.to)

    if (edge.from === edge.to) {
      // Self-loop on +cross side
      const loopReach = 34
      const cEdge = from.cross + from.crossSize / 2
      const m1 = from.main - from.mainSize * 0.2
      const m2 = from.main + from.mainSize * 0.2
      const cCtrl = cEdge + loopReach
      const lblDim = edge.label ? measureEdgeLabel(edge.label) : { width: 0, height: 0 }
      const labelCross = cEdge + loopReach * 0.78 + lblDim.width * 0.25
      const labelMain = from.main
      geometries[index] = {
        segments: [
          { type: 'M', pts: [{ main: m1, cross: cEdge }] },
          { type: 'C', pts: [{ main: m1 - 12, cross: cCtrl }, { main: m2 + 12, cross: cCtrl }, { main: m2, cross: cEdge }] },
        ],
        labelMain,
        labelCross,
        extents: [
          { main: m1 - 12, cross: cCtrl },
          { main: m2 + 12, cross: cCtrl },
          { main: labelMain, cross: labelCross + lblDim.width / 2 },
        ],
      }
      return
    }

    if (isBackEdge[index]) {
      // Route back-edge cleanly around the outer side channel
      const avgCross = (from.cross + to.cross) / 2
      const useLeft = avgCross < graphCenterCross - 10
      const channelIdx = useLeft ? leftChannelIdx++ : rightChannelIdx++
      const channelGap = 28 + channelIdx * 24

      let extremalCross = useLeft ? Infinity : -Infinity
      const rLow = Math.min(from.rank, to.rank)
      const rHigh = Math.max(from.rank, to.rank)
      for (const node of nodeMeta.values()) {
        if (node.rank >= rLow && node.rank <= rHigh) {
          if (useLeft) extremalCross = Math.min(extremalCross, node.cross - node.crossSize / 2)
          else extremalCross = Math.max(extremalCross, node.cross + node.crossSize / 2)
        }
      }
      const laneCross = useLeft ? extremalCross - channelGap : extremalCross + channelGap
      const exitCross = useLeft ? from.cross - from.crossSize / 2 : from.cross + from.crossSize / 2
      const enterCross = useLeft ? to.cross - to.crossSize / 2 : to.cross + to.crossSize / 2
      const exitMain = from.main
      const enterMain = to.main
      const midMain = (exitMain + enterMain) / 2

      const segments = [
        { type: 'M', pts: [{ main: exitMain, cross: exitCross }] },
        {
          type: 'C',
          pts: [
            { main: exitMain, cross: laneCross },
            { main: exitMain, cross: laneCross },
            { main: midMain, cross: laneCross },
          ],
        },
        {
          type: 'C',
          pts: [
            { main: enterMain, cross: laneCross },
            { main: enterMain, cross: laneCross },
            { main: enterMain, cross: enterCross },
          ],
        },
      ]
      const lblDim = edge.label ? measureEdgeLabel(edge.label) : { width: 0, height: 0 }
      geometries[index] = {
        segments,
        labelMain: midMain,
        labelCross: laneCross,
        extents: [
          { main: exitMain, cross: laneCross + (useLeft ? -lblDim.width / 2 : lblDim.width / 2) },
          { main: enterMain, cross: laneCross + (useLeft ? -lblDim.width / 2 : lblDim.width / 2) },
        ],
      }
      return
    }

    // Forward DAG edge (possibly multi-rank via dummy waypoints)
    const chain = edgeRoutingChain.get(index) ?? [edge.from, edge.to]
    const outList = outEdgesByNode.get(edge.from) ?? [index]
    const inList = inEdgesByNode.get(edge.to) ?? [index]
    const outIdx = outList.indexOf(index)
    const inIdx = inList.indexOf(index)

    const maxOutSpread = Math.min(from.crossSize * 0.42, (outList.length - 1) * 14)
    const maxInSpread = Math.min(to.crossSize * 0.42, (inList.length - 1) * 14)
    const outOffset = outList.length > 1 ? ((outIdx / (outList.length - 1)) - 0.5) * maxOutSpread : 0
    const inOffset = inList.length > 1 ? ((inIdx / (inList.length - 1)) - 0.5) * maxInSpread : 0

    // Parallel edge offset between identical (from, to)
    const pair = pairGroups.get(edge.from + '->' + edge.to) ?? [index]
    const pairOffset = pair.length > 1 ? ((pair.indexOf(index) / (pair.length - 1)) - 0.5) * 26 : 0

    const pStart = {
      main: from.main + shapeMainReach(from, outOffset, horizontal, flipMain),
      cross: from.cross + outOffset,
    }
    const pEnd = {
      main: to.main - shapeMainReach(to, inOffset, horizontal, !flipMain),
      cross: to.cross + inOffset,
    }

    if (chain.length === 2) {
      const dm = Math.max(12, pEnd.main - pStart.main)
      const c1 = { main: pStart.main + dm * 0.5, cross: pStart.cross + pairOffset }
      const c2 = { main: pEnd.main - dm * 0.5, cross: pEnd.cross + pairOffset }
      const labelMain = 0.125 * pStart.main + 0.375 * c1.main + 0.375 * c2.main + 0.125 * pEnd.main
      const labelCross = 0.125 * pStart.cross + 0.375 * c1.cross + 0.375 * c2.cross + 0.125 * pEnd.cross
      geometries[index] = {
        segments: [
          { type: 'M', pts: [pStart] },
          { type: 'C', pts: [c1, c2, pEnd] },
        ],
        labelMain,
        labelCross,
        extents: [pStart, c1, c2, pEnd],
      }
      return
    }

    // Multi-segment smooth spline through dummy waypoints
    const pts = [pStart]
    for (let k = 1; k < chain.length - 1; k += 1) {
      const d = nodeMeta.get(chain[k])
      pts.push({ main: d.main, cross: d.cross + pairOffset })
    }
    pts.push(pEnd)

    const segments = [{ type: 'M', pts: [pts[0]] }]
    for (let k = 0; k < pts.length - 1; k += 1) {
      const a = pts[k]
      const b = pts[k + 1]
      const dm = Math.max(8, (b.main - a.main) * 0.5)
      segments.push({
        type: 'C',
        pts: [
          { main: a.main + dm, cross: a.cross },
          { main: b.main - dm, cross: b.cross },
          b,
        ],
      })
    }
    const midIdx = Math.floor(pts.length / 2)
    const ma = pts[midIdx - 1]
    const mb = pts[midIdx]
    geometries[index] = {
      segments,
      labelMain: (ma.main + mb.main) / 2,
      labelCross: (ma.cross + mb.cross) / 2,
      extents: pts,
    }
  })

  // Stagger colliding edge labels gently if two labeled edges cross very close to each other
  const labeled = geometries
    .map((eg, i) => ({ eg, label: edges[i].label?.trim() ?? '' }))
    .filter(item => item.label !== '')

  for (let i = 0; i < labeled.length; i += 1) {
    for (let j = i + 1; j < labeled.length; j += 1) {
      const a = labeled[i].eg
      const b = labeled[j].eg
      if (Math.abs(a.labelMain - b.labelMain) < 20 && Math.abs(a.labelCross - b.labelCross) < 42) {
        a.labelMain -= 11
        b.labelMain += 11
      }
    }
  }

  return geometries
}

function buildSvgPath(segments, toXY) {
  return segments.map(seg => {
    const coords = seg.pts.map(pt => {
      const xy = toXY(pt.main, pt.cross)
      return roundCoord(xy.x) + ' ' + roundCoord(xy.y)
    })
    return seg.type + ' ' + coords.join(', ')
  }).join(' ')
}

function roundCoord(n) {
  return Math.round(n * 10) / 10
}

function computeSubgraphBoxes(subgraphs, nodes, nodeMeta, horizontal, padTop, padSide, padBottom) {
  if (!subgraphs || subgraphs.length === 0) return []
  const boxMap = new Map()

  for (const node of nodes) {
    if (!node.subgraphId) continue
    const meta = nodeMeta.get(node.id)
    if (!meta) continue
    const mMin = meta.main - meta.mainSize / 2
    const mMax = meta.main + meta.mainSize / 2
    const cMin = meta.cross - meta.crossSize / 2
    const cMax = meta.cross + meta.crossSize / 2
    const cur = boxMap.get(node.subgraphId)
    if (cur === undefined) {
      boxMap.set(node.subgraphId, { mMin, mMax, cMin, cMax })
    } else {
      cur.mMin = Math.min(cur.mMin, mMin)
      cur.mMax = Math.max(cur.mMax, mMax)
      cur.cMin = Math.min(cur.cMin, cMin)
      cur.cMax = Math.max(cur.cMax, cMax)
    }
  }

  // Expand parent subgraphs to enclose nested child subgraphs
  for (let i = subgraphs.length - 1; i >= 0; i -= 1) {
    const sg = subgraphs[i]
    const box = boxMap.get(sg.id)
    if (!box) continue
    if (sg.parentId) {
      const padMStart = horizontal ? padSide : padTop
      const padMEnd = horizontal ? padSide : padBottom
      const padCStart = horizontal ? padTop : padSide
      const padCEnd = horizontal ? padBottom : padSide
      const pBox = boxMap.get(sg.parentId)
      const childMMin = box.mMin - padMStart - 8
      const childMMax = box.mMax + padMEnd + 8
      const childCMin = box.cMin - padCStart - 8
      const childCMax = box.cMax + padCEnd + 8
      if (pBox === undefined) {
        boxMap.set(sg.parentId, { mMin: childMMin, mMax: childMMax, cMin: childCMin, cMax: childCMax })
      } else {
        pBox.mMin = Math.min(pBox.mMin, childMMin)
        pBox.mMax = Math.max(pBox.mMax, childMMax)
        pBox.cMin = Math.min(pBox.cMin, childCMin)
        pBox.cMax = Math.max(pBox.cMax, childCMax)
      }
    }
  }

  const result = []
  for (const sg of subgraphs) {
    const box = boxMap.get(sg.id)
    if (!box) continue
    result.push({
      id: sg.id,
      title: sg.title,
      mainMin: box.mMin - (horizontal ? padSide : padTop),
      mainMax: box.mMax + (horizontal ? padSide : padBottom),
      crossMin: box.cMin - (horizontal ? padTop : padSide),
      crossMax: box.cMax + (horizontal ? padBottom : padSide),
    })
  }
  return result
}

export { layoutFlowchart, measureTextWidth, parseFlowchart, wrapLabel }
