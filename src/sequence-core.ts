import { clamp, measureTextWidth, wrapLabel } from './text-metrics.ts'

type Participant = { id: string; label: string; kind: string }
type SequenceEvent =
  | { type: 'message'; from: string; to: string; dashed: boolean; arrowKind: string; bidirectional: boolean; activateTarget: boolean; deactivateSource: boolean; label: string }
  | { type: 'note'; placement: string; targets: string[]; text: string }
  | { type: 'activate' | 'deactivate'; target: string }
  | { type: 'divider'; text: string }
  | { type: 'block_start' | 'block_else'; kind: string; label: string }
  | { type: 'block_end' }

type PositionedParticipant = Participant & { index: number; lines: string[]; width: number; height: number; x: number; y: number }
type PositionedEvent =
  | { type: 'divider'; y: number; text: string }
  | { type: 'note'; x: number; y: number; width: number; height: number; lines: string[] }
  | { type: 'message'; isSelf: boolean; x1: number; x2: number; y: number; yEnd: number; dashed: boolean; arrowKind: string; bidirectional: boolean; lines: string[]; labelW: number }
type FragmentSection = { y: number; label: string }
type OpenFragment = { kind: string; label: string; startY: number; depth: number; minIdx: number; maxIdx: number; sections: FragmentSection[] }
type Fragment = { kind: string; label: string; x: number; y: number; width: number; height: number; sections: FragmentSection[] }

const MAX_SEQ_PARTICIPANTS = 24
const MAX_SEQ_EVENTS = 160

const SEQ_UNSUPPORTED = /^(?:!include|!define|!pragma|@startmindmap|@startwbs|@startgantt|@startsalt|@startjson|@startyaml|newpage\b|\|\|\|)/iu

/**
 * Parse a Mermaid sequenceDiagram or PlantUML sequence diagram.
 */
function parseSequenceDiagram(source: string) {
  if (typeof source !== 'string' || source.length > 20_000) return null
  const rawLines = source.replace(/\r/g, '').replace(/%%\{[\s\S]*?\}%%/gu, '').split('\n')

  const participants: Participant[] = []
  const byId = new Map<string, Participant>()
  const events: SequenceEvent[] = []
  const blockStack: string[] = []
  let title = ''
  let autonumber = false
  let msgCounter = 0
  let hideFootbox = false
  let inSkinparamBlock = false
  let inMultiNote: { placement: string; targets: string[]; lines: string[] } | null = null
  let hasExplicitParticipant = false
  let messageCount = 0

  const ensureParticipant = (rawId: string, explicitKind = '', explicitLabel = '') => {
    const id = String(rawId ?? '').trim().replace(/^["']|["']$/g, '')
    if (!id || !/^[A-Za-z0-9_][\w.-]*$/u.test(id)) return null
    let p = byId.get(id)
    if (p === undefined) {
      if (participants.length >= MAX_SEQ_PARTICIPANTS) return null
      p = {
        id,
        label: explicitLabel || id,
        kind: explicitKind || 'participant',
      }
      participants.push(p)
      byId.set(id, p)
    } else {
      if (explicitKind && p.kind === 'participant') p.kind = explicitKind
      if (explicitLabel && p.label === p.id) p.label = explicitLabel
    }
    return p
  }

  for (const rawLine of rawLines) {
    let line = stripSeqComment(rawLine).trim()
    if (line === '') continue

    if (SEQ_UNSUPPORTED.test(line)) return null

    if (inSkinparamBlock) {
      if (line.includes('}')) inSkinparamBlock = false
      continue
    }

    if (inMultiNote !== null) {
      if (/^end\s+note$/iu.test(line)) {
        if (events.length >= MAX_SEQ_EVENTS) return null
        events.push({
          type: 'note',
          placement: inMultiNote.placement,
          targets: inMultiNote.targets,
          text: inMultiNote.lines.join('\n'),
        })
        inMultiNote = null
      } else {
        inMultiNote.lines.push(line)
      }
      continue
    }

    if (/^(?:sequenceDiagram|@startuml(?:\s+.*)?|@enduml)$/iu.test(line)) continue
    if (/^hide\s+footbox$/iu.test(line)) { hideFootbox = true; continue }
    if (/^skinparam\b/iu.test(line)) {
      if (line.includes('{') && !line.includes('}')) inSkinparamBlock = true
      continue
    }
    if (/^autonumber\b/iu.test(line)) { autonumber = true; continue }

    const titleMatch = /^title\s*:?\s*(.+)$/iu.exec(line)
    if (titleMatch !== null) {
      title = cleanSeqText(titleMatch[1])
      continue
    }

    // Participant declarations (Mermaid & PlantUML styles)
    const partMatch = /^(participant|actor|database|boundary|control|entity|collections|queue)\s+(.+)$/iu.exec(line)
    if (partMatch !== null) {
      hasExplicitParticipant = true
      const kind = partMatch[1].toLowerCase()
      const decl = parseParticipantDecl(partMatch[2])
      if (decl === null || ensureParticipant(decl.id, kind, decl.label) === null) return null
      continue
    }

    // Activate / Deactivate / Destroy
    const actMatch = /^(activate|deactivate|destroy)\s+(.+)$/iu.exec(line)
    if (actMatch !== null) {
      const id = actMatch[2].trim().replace(/^["']|["']$/g, '')
      const p = ensureParticipant(id)
      if (p !== null && events.length < MAX_SEQ_EVENTS) {
        events.push({
          type: actMatch[1].toLowerCase() === 'activate' ? 'activate' : 'deactivate',
          target: p.id,
        })
      }
      continue
    }

    // Divider: == Section ==
    const divMatch = /^==\s*(.+?)\s*==$/u.exec(line)
    if (divMatch !== null) {
      if (events.length >= MAX_SEQ_EVENTS) return null
      events.push({ type: 'divider', text: cleanSeqText(divMatch[1]) })
      continue
    }

    // Note: Note left/right of X: text | Note over X,Y: text | multi-line
    const noteMatch = /^note\s+(left\s+of|right\s+of|over)\s+([^:]+?)(?:\s*:\s*(.*))?$/iu.exec(line)
    if (noteMatch !== null) {
      const placement = noteMatch[1].toLowerCase().replace(/\s+/g, ' ')
      const targetIds = noteMatch[2].split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean)
      const targets = targetIds.map(id => ensureParticipant(id)).filter((p): p is Participant => p !== null).map(p => p.id)
      if (targets.length === 0) continue
      if (noteMatch[3] !== undefined) {
        if (events.length >= MAX_SEQ_EVENTS) return null
        events.push({
          type: 'note',
          placement,
          targets,
          text: cleanSeqText(noteMatch[3]),
        })
      } else {
        inMultiNote = { placement, targets, lines: [] }
      }
      continue
    }

    // Combined fragments: alt / opt / loop / par / critical / break / group
    const blockStart = /^(alt|opt|loop|par|critical|break|group)(?:\s+(.*))?$/iu.exec(line)
    if (blockStart !== null) {
      if (events.length >= MAX_SEQ_EVENTS) return null
      const kind = blockStart[1].toLowerCase()
      const label = cleanSeqText(blockStart[2] ?? '')
      blockStack.push(kind)
      events.push({ type: 'block_start', kind, label })
      continue
    }

    const blockElse = /^(else|and|option)(?:\s+(.*))?$/iu.exec(line)
    if (blockElse !== null && blockStack.length > 0) {
      if (events.length >= MAX_SEQ_EVENTS) return null
      events.push({ type: 'block_else', kind: blockElse[1].toLowerCase(), label: cleanSeqText(blockElse[2] ?? '') })
      continue
    }

    if (/^end$/iu.test(line) && blockStack.length > 0) {
      blockStack.pop()
      if (events.length >= MAX_SEQ_EVENTS) return null
      events.push({ type: 'block_end' })
      continue
    }

    // Ignore harmless box/create directives
    if (/^(?:box\b|end\s+box|create\b|link\b|links\b|properties\b)/iu.test(line)) continue

    // Messages: A ->> B: text  or  "Alice" -> "Bob" : text
    const msg = parseSequenceMessage(line)
    if (msg !== null) {
      const fromP = ensureParticipant(msg.from)
      const toP = ensureParticipant(msg.to)
      if (fromP === null || toP === null) return null
      if (events.length >= MAX_SEQ_EVENTS) return null
      msgCounter += 1
      messageCount += 1
      const label = autonumber ? (msg.text ? msgCounter + '. ' + msg.text : String(msgCounter)) : msg.text
      events.push({
        type: 'message',
        from: fromP.id,
        to: toP.id,
        dashed: msg.dashed,
        arrowKind: msg.arrowKind,
        bidirectional: msg.bidirectional,
        activateTarget: msg.activateTarget,
        deactivateSource: msg.deactivateSource,
        label,
      })
      continue
    }

    // Unrecognized PlantUML activity / state / unknown construct -> bail if not clearly sequence
    if (rawLine.trim().startsWith(':') || /^(?:start|stop|if\s*\(|while\s*\(|repeat|fork|class\s+|interface\s+|state\s+)/iu.test(line)) {
      return null
    }
  }

  if (participants.length === 0 || (messageCount === 0 && !hasExplicitParticipant)) return null
  return { kind: 'sequence', title, hideFootbox, participants, events }
}

function stripSeqComment(line: string) {
  if (line.trim().startsWith('%%') || line.trim().startsWith("'")) return ''
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

function parseParticipantDecl(raw: string) {
  const s = raw.trim()
  // "Label" as Id
  const qAs = /^"([^"]+)"\s+as\s+([A-Za-z0-9_][\w.-]*)$/iu.exec(s)
  if (qAs !== null) return { id: qAs[2], label: cleanSeqText(qAs[1]) }
  // Id as Label
  const idAs = /^([A-Za-z0-9_][\w.-]*)\s+as\s+(.+)$/iu.exec(s)
  if (idAs !== null) return { id: idAs[1], label: cleanSeqText(idAs[2]) }
  // "Name"
  const qOnly = /^"([^"]+)"$/u.exec(s)
  if (qOnly !== null) {
    const id = qOnly[1].replace(/\s+/g, '_')
    return { id, label: qOnly[1] }
  }
  // Id
  const idOnly = /^([A-Za-z0-9_][\w.-]*)$/u.exec(s)
  if (idOnly !== null) return { id: idOnly[1], label: idOnly[1] }
  return null
}

function parseSequenceMessage(line: string) {
  // Normalize optional color tags inside PlantUML arrows e.g. -[#red]> -> ->
  const normalized = line.replace(/(<)?(-+)\[[^\]]+\](-+>?)/gu, '$1$2$3')
  const idPat = '"[^"]+"|[A-Za-z0-9_][\\w.]*(?:-[A-Za-z0-9_][\\w.]*)*'
  const re = new RegExp('^(' + idPat + ')\\s*(<-->>|<->>|<-->|<->|-->>|->>|-->|->|--x|-x|--\\)|-\\)|<-|<--)\\s*(\\+|-)?\\s*(' + idPat + ')(?:\\s*:\\s*(.*))?$', 'u')
  const m = re.exec(normalized)
  if (m === null) return null

  let from = m[1].replace(/^"|"$/g, '')
  let arrow = m[2]
  const mod = m[3] ?? ''
  let to = m[4].replace(/^"|"$/g, '')
  const text = cleanSeqText(m[5] ?? '')

  // Reverse left-pointing PlantUML arrows like A <- B
  let bidirectional = false
  if (arrow === '<-' || arrow === '<--') {
    const tmp = from
    from = to
    to = tmp
    arrow = arrow === '<--' ? '-->' : '->'
  } else if (arrow.startsWith('<')) {
    bidirectional = true
  }

  const dashed = arrow.includes('--')
  const arrowKind = arrow.endsWith('x') ? 'cross' : arrow.endsWith(')') ? 'open' : 'filled'

  return {
    from,
    to,
    dashed,
    arrowKind,
    bidirectional,
    activateTarget: mod === '+',
    deactivateSource: mod === '-',
    text,
  }
}

function cleanSeqText(value: string) {
  const s = String(value ?? '').trim()
  if (s.length >= 2 && ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'")))) {
    return s.slice(1, -1)
  }
  return s
}

/**
 * Compute coordinates for a parsed sequence diagram.
 */
function layoutSequenceDiagram(seq: ReturnType<typeof parseSequenceDiagram>) {
  if (seq === null || seq.participants.length === 0) return null

  const margin = 28
  const participants = seq.participants
  const indexById = new Map<string, number>(participants.map((p, i) => [p.id, i]))

  // 1. Measure participant header boxes
  const pMeta: PositionedParticipant[] = participants.map((p, idx) => {
    const lines = wrapLabel(p.label, 140, 13)
    const textW = Math.max(...lines.map(l => measureTextWidth(l, 13)))
    const isActor = p.kind === 'actor'
    const isDb = p.kind === 'database'
    const width = clamp(textW + 32, isActor ? 76 : 92, 184)
    const height = isActor ? 44 + lines.length * 17 : Math.max(40, lines.length * 18 + (isDb ? 26 : 20))
    return { ...p, index: idx, lines, width, height, x: 0, y: 0 }
  })

  // 2. Measure minimum adjacent column gaps based on boxes, direct messages, self-loops, and notes
  const pairGap = new Array(Math.max(0, pMeta.length - 1)).fill(0)
  for (let i = 0; i < pMeta.length - 1; i += 1) {
    pairGap[i] = pMeta[i].width / 2 + pMeta[i + 1].width / 2 + 34
  }

  let extraRightTail = 0
  let extraLeftHead = 0

  for (const ev of seq.events) {
    if (ev.type === 'message') {
      const iFrom = indexById.get(ev.from)
      const iTo = indexById.get(ev.to)
      if (iFrom === undefined || iTo === undefined) continue
      const msgLines = ev.label ? wrapLabel(ev.label, 220, 12) : []
      const msgW = msgLines.length > 0 ? Math.max(...msgLines.map(l => measureTextWidth(l, 12))) : 0
      if (iFrom === iTo) {
        const needed = 46 + msgW + 24
        if (iFrom < pMeta.length - 1) {
          pairGap[iFrom] = Math.max(pairGap[iFrom], needed + pMeta[iFrom + 1].width / 2 + 12)
        } else {
          extraRightTail = Math.max(extraRightTail, needed)
        }
      } else if (Math.abs(iFrom - iTo) === 1) {
        const leftIdx = Math.min(iFrom, iTo)
        pairGap[leftIdx] = Math.max(pairGap[leftIdx], Math.min(280, msgW + 56))
      }
    } else if (ev.type === 'note') {
      const noteLines = wrapLabel(ev.text, 160, 12)
      const noteW = Math.max(64, ...noteLines.map(l => measureTextWidth(l, 12))) + 24
      const tIdx = indexById.get(ev.targets[0])
      if (tIdx === undefined) continue
      if (ev.placement === 'right of') {
        if (tIdx < pMeta.length - 1) {
          pairGap[tIdx] = Math.max(pairGap[tIdx], noteW + pMeta[tIdx + 1].width / 2 + 28)
        } else {
          extraRightTail = Math.max(extraRightTail, noteW + 24)
        }
      } else if (ev.placement === 'left of') {
        if (tIdx > 0) {
          pairGap[tIdx - 1] = Math.max(pairGap[tIdx - 1], noteW + pMeta[tIdx - 1].width / 2 + 28)
        } else {
          extraLeftHead = Math.max(extraLeftHead, noteW + 24)
        }
      }
    }
  }

  // Assign X coordinates
  let xCursor = margin + Math.max(pMeta[0].width / 2, extraLeftHead)
  pMeta[0].x = xCursor
  for (let i = 1; i < pMeta.length; i += 1) {
    xCursor += pairGap[i - 1]
    pMeta[i].x = xCursor
  }

  const maxHeaderH = Math.max(...pMeta.map(p => p.height))
  const titleOffset = seq.title ? 34 : 0
  const headerTopY = margin + titleOffset
  const headerBottomY = headerTopY + maxHeaderH
  let yCursor = headerBottomY + 26

  // 3. Layout vertical events, activations, and combined fragments
  const positionedEvents: PositionedEvent[] = []
  const activeStacks = new Map<string, Array<{ startY: number; depth: number }>>(pMeta.map(p => [p.id, []]))
  const activations: Array<{ participantId: string; x: number; startY: number; endY: number }> = []
  const fragmentStack: OpenFragment[] = []
  const fragments: Fragment[] = []

  const openActivation = (id: string, y: number) => {
    const stack = activeStacks.get(id)
    if (!stack) return
    stack.push({ startY: y, depth: stack.length })
  }

  const closeActivation = (id: string, y: number) => {
    const stack = activeStacks.get(id)
    if (!stack || stack.length === 0) return
    const item = stack.pop()
    const index = indexById.get(id)
    if (!item || index === undefined) return
    activations.push({
      participantId: id,
      x: pMeta[index].x + item.depth * 5,
      startY: item.startY,
      endY: Math.max(item.startY + 14, y),
    })
  }

  const touchFragmentParticipant = (id: string) => {
    const idx = indexById.get(id)
    if (idx === undefined) return
    for (const frag of fragmentStack) {
      frag.minIdx = Math.min(frag.minIdx, idx)
      frag.maxIdx = Math.max(frag.maxIdx, idx)
    }
  }

  for (const ev of seq.events) {
    if (ev.type === 'activate') {
      openActivation(ev.target, yCursor - 10)
      continue
    }
    if (ev.type === 'deactivate') {
      closeActivation(ev.target, yCursor - 10)
      continue
    }
    if (ev.type === 'block_start') {
      fragmentStack.push({
        kind: ev.kind,
        label: ev.label,
        startY: yCursor,
        depth: fragmentStack.length,
        minIdx: pMeta.length - 1,
        maxIdx: 0,
        sections: [],
      })
      yCursor += 30
      continue
    }
    if (ev.type === 'block_else') {
      const top = fragmentStack[fragmentStack.length - 1]
      if (top) {
        top.sections.push({ y: yCursor, label: ev.label })
        yCursor += 26
      }
      continue
    }
    if (ev.type === 'block_end') {
      const frag = fragmentStack.pop()
      if (frag) {
        if (frag.minIdx > frag.maxIdx) {
          frag.minIdx = 0
          frag.maxIdx = pMeta.length - 1
        }
        const pad = 28 + frag.depth * 8
        const leftX = pMeta[frag.minIdx].x - Math.max(46, pMeta[frag.minIdx].width / 2) - 16 + frag.depth * 6
        const rightX = pMeta[frag.maxIdx].x + Math.max(46, pMeta[frag.maxIdx].width / 2) + 16 - frag.depth * 6
        fragments.push({
          kind: frag.kind,
          label: frag.label,
          x: leftX,
          y: frag.startY,
          width: Math.max(120, rightX - leftX + pad * 0),
          height: Math.max(44, yCursor - frag.startY + 8),
          sections: frag.sections,
        })
        yCursor += 16
      }
      continue
    }
    if (ev.type === 'divider') {
      positionedEvents.push({ type: 'divider', y: yCursor + 10, text: ev.text })
      yCursor += 36
      continue
    }
    if (ev.type === 'note') {
      for (const t of ev.targets) touchFragmentParticipant(t)
      const lines = wrapLabel(ev.text, 160, 12)
      const textW = Math.max(52, ...lines.map(l => measureTextWidth(l, 12)))
      const noteW = textW + 22
      const noteH = lines.length * 16 + 16
      const firstIndex = indexById.get(ev.targets[0])
      const lastIndex = indexById.get(ev.targets[ev.targets.length - 1])
      if (firstIndex === undefined || lastIndex === undefined) continue
      const firstX = pMeta[firstIndex].x
      const lastX = pMeta[lastIndex].x
      let nx
      if (ev.placement === 'left of') nx = firstX - noteW - 14
      else if (ev.placement === 'right of') nx = firstX + 14
      else nx = (firstX + lastX) / 2 - noteW / 2
      positionedEvents.push({
        type: 'note',
        x: nx,
        y: yCursor,
        width: noteW,
        height: noteH,
        lines,
      })
      yCursor += noteH + 14
      continue
    }
    if (ev.type === 'message') {
      touchFragmentParticipant(ev.from)
      touchFragmentParticipant(ev.to)
      const fromIndex = indexById.get(ev.from)
      const toIndex = indexById.get(ev.to)
      if (fromIndex === undefined || toIndex === undefined) continue
      const x1 = pMeta[fromIndex].x
      const x2 = pMeta[toIndex].x
      const isSelf = ev.from === ev.to
      const lines = ev.label ? wrapLabel(ev.label, isSelf ? 180 : Math.max(120, Math.abs(x2 - x1) - 24), 12) : []
      const labelW = lines.length > 0 ? Math.max(...lines.map(l => measureTextWidth(l, 12))) + 10 : 0
      const textH = lines.length * 15

      if (isSelf) {
        const yTop = yCursor + 8
        const yBot = yTop + Math.max(24, textH + 8)
        positionedEvents.push({
          type: 'message',
          isSelf: true,
          x1,
          x2: x1,
          y: yTop,
          yEnd: yBot,
          dashed: ev.dashed,
          arrowKind: ev.arrowKind,
          bidirectional: ev.bidirectional,
          lines,
          labelW,
        })
        if (ev.activateTarget) openActivation(ev.to, yTop)
        if (ev.deactivateSource) closeActivation(ev.from, yBot)
        yCursor = yBot + 16
      } else {
        const msgY = yCursor + textH + 10
        positionedEvents.push({
          type: 'message',
          isSelf: false,
          x1,
          x2,
          y: msgY,
          yEnd: msgY,
          dashed: ev.dashed,
          arrowKind: ev.arrowKind,
          bidirectional: ev.bidirectional,
          lines,
          labelW,
        })
        if (ev.activateTarget) openActivation(ev.to, msgY)
        if (ev.deactivateSource) closeActivation(ev.from, msgY)
        yCursor = msgY + 18
      }
    }
  }

  // Close any unclosed fragments or activations cleanly
  while (fragmentStack.length > 0) {
    const frag = fragmentStack.pop()
    if (!frag) break
    if (frag.minIdx > frag.maxIdx) {
      frag.minIdx = 0
      frag.maxIdx = pMeta.length - 1
    }
    const leftX = pMeta[frag.minIdx].x - Math.max(46, pMeta[frag.minIdx].width / 2) - 16
    const rightX = pMeta[frag.maxIdx].x + Math.max(46, pMeta[frag.maxIdx].width / 2) + 16
    fragments.push({
      kind: frag.kind,
      label: frag.label,
      x: leftX,
      y: frag.startY,
      width: Math.max(120, rightX - leftX),
      height: Math.max(44, yCursor - frag.startY + 8),
      sections: frag.sections,
    })
  }

  const lifelineBottomY = yCursor + 8
  for (const [id, stack] of activeStacks.entries()) {
    while (stack.length > 0) closeActivation(id, lifelineBottomY - 6)
  }

  const showFootbox = !seq.hideFootbox && positionedEvents.filter(e => e.type === 'message').length >= 5
  const bottomY = showFootbox ? lifelineBottomY + maxHeaderH + margin : lifelineBottomY + margin

  let minX = pMeta[0].x - pMeta[0].width / 2
  let maxX = pMeta[pMeta.length - 1].x + Math.max(pMeta[pMeta.length - 1].width / 2, extraRightTail)
  for (const frag of fragments) {
    minX = Math.min(minX, frag.x)
    maxX = Math.max(maxX, frag.x + frag.width)
  }
  for (const ev of positionedEvents) {
    if (ev.type === 'note') {
      minX = Math.min(minX, ev.x)
      maxX = Math.max(maxX, ev.x + ev.width)
    } else if (ev.type === 'message' && ev.isSelf) {
      maxX = Math.max(maxX, ev.x1 + 42 + ev.labelW)
    }
  }

  const shiftX = margin - minX
  const width = Math.max(160, Math.ceil(maxX - minX + margin * 2))
  const height = Math.ceil(bottomY)

  for (const p of pMeta) {
    p.x += shiftX
    p.y = headerTopY + (maxHeaderH - p.height) / 2
  }
  for (const a of activations) a.x += shiftX
  for (const f of fragments) f.x += shiftX
  for (const ev of positionedEvents) {
    if (ev.type === 'note') ev.x += shiftX
    else if (ev.type === 'message') {
      ev.x1 += shiftX
      ev.x2 += shiftX
    }
  }

  return {
    kind: 'sequence' as const,
    title: seq.title,
    width,
    height,
    headerBottomY,
    lifelineBottomY,
    showFootbox,
    maxHeaderH,
    participants: pMeta,
    events: positionedEvents,
    activations,
    fragments,
  }
}

export { layoutSequenceDiagram, parseSequenceDiagram }
