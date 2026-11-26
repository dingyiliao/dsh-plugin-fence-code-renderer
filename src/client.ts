import { SUPPORTED_FENCE_LANGUAGES, parseAndLayoutDiagram } from './diagram-dispatcher.ts'

type DiagramLayout = NonNullable<ReturnType<typeof parseAndLayoutDiagram>>
type SequenceLayout = Extract<DiagramLayout, { kind: 'sequence' }>
type GraphLayout = Extract<DiagramLayout, { kind: 'flowchart' }>
type SequenceParticipant = SequenceLayout['participants'][number]
type SequenceFragment = SequenceLayout['fragments'][number]
type SequenceEvent = SequenceLayout['events'][number]
type GraphNode = GraphLayout['nodes'][number]
type GraphEdge = GraphLayout['edges'][number]
type GraphSubgraph = GraphLayout['subgraphs'][number]
type MarkerIds = Record<'arrowEnd' | 'arrowStart' | 'hollowTriEnd' | 'hollowTriStart' | 'filledDiaEnd' | 'filledDiaStart' | 'hollowDiaEnd' | 'hollowDiaStart', string>
type ReactRuntime = {
  createElement: (type: string, props: Record<string, unknown> | null, ...children: unknown[]) => unknown
  useId: () => string
  useMemo: <T>(factory: () => T, deps: unknown[]) => T
}
type FenceProps = { lang: string; code: string; streaming: boolean; children: unknown; t: (key: string) => string }
type DshContext = {
  effect: (register: () => unknown, name: string) => unknown
  locale: { register: (namespace: string, dictionaries: Record<string, Record<string, string>>) => unknown }
  slots: {
    inject: (name: string, register: () => unknown) => unknown
    register: (options: Record<string, unknown>, component: (props: FenceProps) => unknown) => unknown
  }
}

(window as unknown as Window & { __ModuleLoader__: { load(module: unknown): void } }).__ModuleLoader__.load({
  id: '@local/dsh-markdown-flowchart',
  factory(requireModule: (name: string) => ReactRuntime) {
    const React = requireModule('react')
    const h = React.createElement

    const FLOWCHART_ID = '@local/dsh-markdown-flowchart/fence'
    const FLOWCHART_NS = 'markdownFlowchart'
    const FLOWCHART_LANGUAGES = SUPPORTED_FENCE_LANGUAGES
    const flowchartZh = {
      'diagram.flowchart': '流程图',
      'diagram.mermaid': 'Mermaid 图表',
      'diagram.plantuml': 'PlantUML 图表',
      'diagram.sequence': '时序图',
    }
    const flowchartEn = {
      'diagram.flowchart': 'Flowchart',
      'diagram.mermaid': 'Mermaid diagram',
      'diagram.plantuml': 'PlantUML diagram',
      'diagram.sequence': 'Sequence diagram',
    }

    /** Render a settled diagram fence, preserving the stock code block while streaming or on parse/layout fallback. */
    function FlowchartFence({ lang, code, streaming, children, t }: FenceProps) {
      const markerBase = 'dsh-fc-' + React.useId().replace(/[^A-Za-z0-9_-]/g, '')
      const diagram = React.useMemo(() => {
        if (streaming) return null
        try {
          return parseAndLayoutDiagram(lang, code)
        } catch (_error) {
          return null
        }
      }, [lang, code, streaming])
      if (diagram === null) return children

      const labelKey = diagram.kind === 'sequence'
        ? 'diagram.sequence'
        : (lang === 'plantuml' || lang === 'puml' || lang === 'uml')
          ? 'diagram.plantuml'
          : lang === 'mermaid'
            ? 'diagram.mermaid'
            : 'diagram.flowchart'

      return h('div', {
        'data-dsh-flowchart': lang,
        'data-dsh-diagram-kind': diagram.kind,
        role: 'img',
        'aria-label': t(labelKey),
        style: {
          overflowX: 'auto',
          color: 'var(--dsw-alias-label-primary)',
          fontFamily: 'var(--dsw-font-family)',
          margin: '8px 0',
          padding: '14px 16px',
          borderRadius: '12px',
          border: '1px solid var(--dsw-alias-border-l3)',
          backgroundColor: 'color-mix(in srgb, var(--dsw-alias-label-primary) 2.5%, var(--dsw-alias-bg-layer-1))',
        },
      }, diagram.kind === 'sequence'
        ? renderSequenceSvg(diagram, markerBase)
        : renderGraphSvg(diagram, markerBase))
    }

    function svgStyleForWidth(width: number) {
      return {
        display: 'block',
        margin: '0 auto',
        maxWidth: '100%',
        minWidth: Math.min(width, Math.round(width * 0.72)) + 'px',
        height: 'auto',
      }
    }

    // ==================== Sequence Diagram SVG Renderer ====================

    function renderSequenceSvg(seq: SequenceLayout, markerBase: string) {
      const filledArrowId = markerBase + '-seq-filled'
      const openArrowId = markerBase + '-seq-open'
      const crossEndId = markerBase + '-seq-cross'

      return h('svg', {
        viewBox: '0 0 ' + seq.width + ' ' + seq.height,
        width: seq.width,
        height: seq.height,
        role: 'presentation',
        style: svgStyleForWidth(seq.width),
      },
        h('defs', null,
          h('marker', {
            id: filledArrowId,
            markerWidth: 9,
            markerHeight: 8,
            refX: 8,
            refY: 4,
            orient: 'auto-start-reverse',
            markerUnits: 'userSpaceOnUse',
          }, h('path', { d: 'M0,1 L9,4 L0,7 L2.2,4 z', fill: 'var(--dsw-alias-link)' })),
          h('marker', {
            id: openArrowId,
            markerWidth: 9,
            markerHeight: 8,
            refX: 8,
            refY: 4,
            orient: 'auto-start-reverse',
            markerUnits: 'userSpaceOnUse',
          }, h('path', {
            d: 'M1,1 L8,4 L1,7',
            fill: 'none',
            stroke: 'var(--dsw-alias-link)',
            strokeWidth: 1.5,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
          })),
          h('marker', {
            id: crossEndId,
            markerWidth: 10,
            markerHeight: 10,
            refX: 5,
            refY: 5,
            orient: 'auto',
            markerUnits: 'userSpaceOnUse',
          }, h('path', {
            d: 'M2,2 L8,8 M8,2 L2,8',
            fill: 'none',
            stroke: 'var(--dsw-alias-link)',
            strokeWidth: 1.75,
            strokeLinecap: 'round',
          })),
        ),
        seq.title ? h('text', {
          x: seq.width / 2,
          y: 24,
          textAnchor: 'middle',
          fontSize: 14,
          fontWeight: 600,
          fill: 'var(--dsw-alias-label-primary)',
        }, seq.title) : null,
        seq.fragments.map((frag, idx) => renderSeqFragment(frag, idx)),
        seq.participants.map(p => h('line', {
          key: 'lifeline:' + p.id,
          x1: p.x,
          y1: seq.headerBottomY,
          x2: p.x,
          y2: seq.lifelineBottomY,
          stroke: 'var(--dsw-alias-border-l3)',
          strokeWidth: 1.25,
          strokeDasharray: '5 4',
        })),
        seq.activations.map((act, idx) => h('rect', {
          key: 'act:' + idx,
          x: act.x - 5,
          y: act.startY,
          width: 10,
          height: act.endY - act.startY,
          rx: 3,
          fill: 'color-mix(in srgb, var(--dsw-alias-link) 18%, var(--dsw-alias-bg-layer-1))',
          stroke: 'var(--dsw-alias-link)',
          strokeWidth: 1.25,
        })),
        seq.participants.map(p => renderSeqParticipant(p, p.y, 'top')),
        seq.showFootbox
          ? seq.participants.map(p => renderSeqParticipant(p, seq.lifelineBottomY + (seq.maxHeaderH - p.height) / 2, 'bot'))
          : null,
        seq.events.map((ev, idx) => renderSeqEvent(ev, seq.width, filledArrowId, openArrowId, crossEndId, idx)),
      )
    }

    function renderSeqParticipant(p: SequenceParticipant, topY: number, pos: string) {
      const cx = p.x
      const w = p.width
      const ht = p.height
      const x = cx - w / 2

      if (p.kind === 'actor') {
        const lineH = 17
        const textStartY = topY + 42
        return h('g', { key: 'p-' + pos + ':' + p.id },
          renderActorIcon(cx, topY + 20, 'var(--dsw-alias-link)'),
          h('text', {
            x: cx,
            y: textStartY,
            textAnchor: 'middle',
            dominantBaseline: 'central',
            fontSize: 13,
            fontWeight: 500,
            fill: 'var(--dsw-alias-label-primary)',
          }, p.lines.map((l, i) => h('tspan', { key: i, x: cx, dy: i === 0 ? 0 : lineH }, l))),
        )
      }

      if (p.kind === 'database') {
        const ry = 6
        const rx = w / 2
        const bodyPath = 'M ' + x + ' ' + (topY + ry) +
          ' L ' + x + ' ' + (topY + ht - ry) +
          ' A ' + rx + ' ' + ry + ' 0 0 0 ' + (x + w) + ' ' + (topY + ht - ry) +
          ' L ' + (x + w) + ' ' + (topY + ry) + ' Z'
        const lineH = 17
        const textStartY = topY + ht / 2 + 3 - ((p.lines.length - 1) * lineH) / 2
        return h('g', { key: 'p-' + pos + ':' + p.id },
          h('path', { d: bodyPath, fill: 'var(--dsw-alias-bg-layer-1)', stroke: 'var(--dsw-alias-border-l3)', strokeWidth: 1.5 }),
          h('ellipse', { cx, cy: topY + ry, rx, ry, fill: 'var(--dsw-alias-bg-layer-1)', stroke: 'var(--dsw-alias-border-l3)', strokeWidth: 1.5 }),
          h('text', {
            x: cx,
            y: textStartY,
            textAnchor: 'middle',
            dominantBaseline: 'central',
            fontSize: 13,
            fontWeight: 500,
            fill: 'var(--dsw-alias-label-primary)',
          }, p.lines.map((l, i) => h('tspan', { key: i, x: cx, dy: i === 0 ? 0 : lineH }, l))),
        )
      }

      const lineH = 18
      const textStartY = topY + ht / 2 - ((p.lines.length - 1) * lineH) / 2
      return h('g', { key: 'p-' + pos + ':' + p.id },
        h('rect', {
          x,
          y: topY,
          width: w,
          height: ht,
          rx: 8,
          fill: 'var(--dsw-alias-bg-layer-1)',
          stroke: 'var(--dsw-alias-border-l3)',
          strokeWidth: 1.5,
        }),
        h('text', {
          x: cx,
          y: textStartY,
          textAnchor: 'middle',
          dominantBaseline: 'central',
          fontSize: 13,
          fontWeight: 500,
          fill: 'var(--dsw-alias-label-primary)',
        }, p.lines.map((l, i) => h('tspan', { key: i, x: cx, dy: i === 0 ? 0 : lineH }, l))),
      )
    }

    function renderSeqFragment(frag: SequenceFragment, key: number) {
      const badgeW = Math.max(42, frag.kind.length * 8 + 18)
      const badgePath = 'M ' + frag.x + ' ' + frag.y +
        ' L ' + (frag.x + badgeW) + ' ' + frag.y +
        ' L ' + (frag.x + badgeW) + ' ' + (frag.y + 15) +
        ' L ' + (frag.x + badgeW - 7) + ' ' + (frag.y + 22) +
        ' L ' + frag.x + ' ' + (frag.y + 22) + ' Z'
      return h('g', { key: 'frag:' + key },
        h('rect', {
          x: frag.x,
          y: frag.y,
          width: frag.width,
          height: frag.height,
          rx: 6,
          fill: 'color-mix(in srgb, var(--dsw-alias-label-primary) 2.5%, transparent)',
          stroke: 'var(--dsw-alias-border-l3)',
          strokeWidth: 1.25,
        }),
        h('path', {
          d: badgePath,
          fill: 'color-mix(in srgb, var(--dsw-alias-state-business-primary) 12%, var(--dsw-alias-bg-layer-1))',
          stroke: 'var(--dsw-alias-border-l3)',
          strokeWidth: 1,
        }),
        h('text', {
          x: frag.x + (badgeW - 3) / 2,
          y: frag.y + 11,
          textAnchor: 'middle',
          dominantBaseline: 'central',
          fontSize: 11,
          fontWeight: 600,
          fill: 'var(--dsw-alias-label-primary)',
        }, frag.kind),
        frag.label ? h('text', {
          x: frag.x + badgeW + 8,
          y: frag.y + 11,
          dominantBaseline: 'central',
          fontSize: 11.5,
          fontWeight: 500,
          fill: 'var(--dsw-alias-label-secondary)',
        }, '[' + frag.label + ']') : null,
        frag.sections.map((sec, sIdx) => h('g', { key: 'sec:' + sIdx },
          h('line', {
            x1: frag.x,
            y1: sec.y,
            x2: frag.x + frag.width,
            y2: sec.y,
            stroke: 'var(--dsw-alias-border-l3)',
            strokeWidth: 1,
            strokeDasharray: '4 4',
          }),
          sec.label ? h('text', {
            x: frag.x + 12,
            y: sec.y + 13,
            fontSize: 11.5,
            fontWeight: 500,
            fill: 'var(--dsw-alias-label-secondary)',
          }, '[' + sec.label + ']') : null,
        )),
      )
    }

    function renderSeqEvent(ev: SequenceEvent, totalWidth: number, filledArrowId: string, openArrowId: string, crossEndId: string, key: number) {
      if (ev.type === 'divider') {
        const pillW = Math.max(60, ev.text.length * 10 + 28)
        return h('g', { key: 'div:' + key },
          h('line', {
            x1: 24,
            y1: ev.y,
            x2: totalWidth - 24,
            y2: ev.y,
            stroke: 'var(--dsw-alias-border-l3)',
            strokeWidth: 1,
          }),
          h('rect', {
            x: totalWidth / 2 - pillW / 2,
            y: ev.y - 11,
            width: pillW,
            height: 22,
            rx: 11,
            fill: 'var(--dsw-alias-bg-layer-1)',
            stroke: 'var(--dsw-alias-border-l3)',
            strokeWidth: 1,
          }),
          h('text', {
            x: totalWidth / 2,
            y: ev.y,
            textAnchor: 'middle',
            dominantBaseline: 'central',
            fontSize: 11.5,
            fontWeight: 600,
            fill: 'var(--dsw-alias-label-secondary)',
          }, ev.text),
        )
      }

      if (ev.type === 'note') {
        const fold = 9
        const x = ev.x
        const y = ev.y
        const w = ev.width
        const ht = ev.height
        const notePath = 'M ' + x + ' ' + y +
          ' L ' + (x + w - fold) + ' ' + y +
          ' L ' + (x + w) + ' ' + (y + fold) +
          ' L ' + (x + w) + ' ' + (y + ht) +
          ' L ' + x + ' ' + (y + ht) + ' Z'
        const foldPath = 'M ' + (x + w - fold) + ' ' + y +
          ' L ' + (x + w - fold) + ' ' + (y + fold) +
          ' L ' + (x + w) + ' ' + (y + fold)
        const lineH = 16
        const textStartY = y + ht / 2 - ((ev.lines.length - 1) * lineH) / 2
        return h('g', { key: 'note:' + key },
          h('path', {
            d: notePath,
            fill: 'color-mix(in srgb, var(--dsw-alias-state-business-primary) 9%, var(--dsw-alias-bg-layer-1))',
            stroke: 'var(--dsw-alias-border-l3)',
            strokeWidth: 1.25,
            strokeLinejoin: 'round',
          }),
          h('path', { d: foldPath, fill: 'none', stroke: 'var(--dsw-alias-border-l3)', strokeWidth: 1 }),
          h('text', {
            x: x + w / 2,
            y: textStartY,
            textAnchor: 'middle',
            dominantBaseline: 'central',
            fontSize: 12,
            fill: 'var(--dsw-alias-label-primary)',
          }, ev.lines.map((l, i) => h('tspan', { key: i, x: x + w / 2, dy: i === 0 ? 0 : lineH }, l))),
        )
      }

      const endMarker = ev.arrowKind === 'cross'
        ? crossEndId
        : ev.arrowKind === 'open'
          ? openArrowId
          : filledArrowId

      if (ev.isSelf) {
        const loopX = ev.x1 + 32
        const d = 'M ' + ev.x1 + ' ' + ev.y +
          ' L ' + loopX + ' ' + ev.y +
          ' L ' + loopX + ' ' + ev.yEnd +
          ' L ' + (ev.x1 + 2) + ' ' + ev.yEnd
        const lineH = 15
        const textY = (ev.y + ev.yEnd) / 2 - ((ev.lines.length - 1) * lineH) / 2
        return h('g', { key: 'msg:' + key },
          h('path', {
            d,
            fill: 'none',
            stroke: 'var(--dsw-alias-link)',
            strokeWidth: 1.5,
            strokeDasharray: ev.dashed ? '5 4' : undefined,
            strokeLinejoin: 'round',
            markerEnd: 'url(#' + endMarker + ')',
          }),
          ev.lines.length > 0 ? h('text', {
            x: loopX + 8,
            y: textY,
            textAnchor: 'start',
            dominantBaseline: 'central',
            fontSize: 12,
            fontWeight: 500,
            fill: 'var(--dsw-alias-label-primary)',
          }, ev.lines.map((l, i) => h('tspan', { key: i, x: loopX + 8, dy: i === 0 ? 0 : lineH }, l))) : null,
        )
      }

      const dir = ev.x2 >= ev.x1 ? 1 : -1
      const startX = ev.x1 + dir * 2
      const endX = ev.x2 - dir * 2
      const midX = (ev.x1 + ev.x2) / 2
      const lineH = 15
      const textBaseY = ev.y - 9 - (ev.lines.length - 1) * lineH
      return h('g', { key: 'msg:' + key },
        h('line', {
          x1: startX,
          y1: ev.y,
          x2: endX,
          y2: ev.y,
          stroke: 'var(--dsw-alias-link)',
          strokeWidth: 1.5,
          strokeDasharray: ev.dashed ? '5 4' : undefined,
          markerEnd: 'url(#' + endMarker + ')',
          markerStart: ev.bidirectional ? 'url(#' + endMarker + ')' : undefined,
        }),
        ev.lines.length > 0 ? h('text', {
          x: midX,
          y: textBaseY,
          textAnchor: 'middle',
          dominantBaseline: 'central',
          fontSize: 12,
          fontWeight: 500,
          fill: 'var(--dsw-alias-label-primary)',
        }, ev.lines.map((l, i) => h('tspan', { key: i, x: midX, dy: i === 0 ? 0 : lineH }, l))) : null,
      )
    }

    function renderActorIcon(cx: number, cy: number, strokeColor: string) {
      return h('g', { stroke: strokeColor, strokeWidth: 1.6, fill: 'none', strokeLinecap: 'round', strokeLinejoin: 'round' },
        h('circle', { cx, cy: cy - 11, r: 5.5, fill: 'color-mix(in srgb, var(--dsw-alias-link) 8%, var(--dsw-alias-bg-layer-1))' }),
        h('line', { x1: cx, y1: cy - 5.5, x2: cx, y2: cy + 5 }),
        h('line', { x1: cx - 8, y1: cy - 1, x2: cx + 8, y2: cy - 1 }),
        h('line', { x1: cx, y1: cy + 5, x2: cx - 6, y2: cy + 13 }),
        h('line', { x1: cx, y1: cy + 5, x2: cx + 6, y2: cy + 13 }),
      )
    }

    // ==================== Layered Graph SVG Renderer (Flowchart / Class / State / ER / Component) ====================

    function renderGraphSvg(diagram: GraphLayout, markerBase: string) {
      const mIds = {
        arrowEnd: markerBase + '-end',
        arrowStart: markerBase + '-start',
        hollowTriEnd: markerBase + '-htri-end',
        hollowTriStart: markerBase + '-htri-start',
        filledDiaEnd: markerBase + '-fdia-end',
        filledDiaStart: markerBase + '-fdia-start',
        hollowDiaEnd: markerBase + '-hdia-end',
        hollowDiaStart: markerBase + '-hdia-start',
      }

      return h('svg', {
        viewBox: '0 0 ' + diagram.width + ' ' + diagram.height,
        width: diagram.width,
        height: diagram.height,
        role: 'presentation',
        style: svgStyleForWidth(diagram.width),
      },
        h('defs', null,
          h('marker', {
            id: mIds.arrowEnd,
            markerWidth: 9,
            markerHeight: 8,
            refX: 8,
            refY: 4,
            orient: 'auto',
            markerUnits: 'userSpaceOnUse',
          }, h('path', { d: 'M0,1 L9,4 L0,7 L2.2,4 z', fill: 'var(--dsw-alias-link)' })),
          h('marker', {
            id: mIds.arrowStart,
            markerWidth: 9,
            markerHeight: 8,
            refX: 1,
            refY: 4,
            orient: 'auto',
            markerUnits: 'userSpaceOnUse',
          }, h('path', { d: 'M9,1 L0,4 L9,7 L6.8,4 z', fill: 'var(--dsw-alias-link)' })),
          h('marker', {
            id: mIds.hollowTriEnd,
            markerWidth: 11,
            markerHeight: 10,
            refX: 10,
            refY: 5,
            orient: 'auto',
            markerUnits: 'userSpaceOnUse',
          }, h('path', { d: 'M1,1 L10,5 L1,9 Z', fill: 'var(--dsw-alias-bg-layer-1)', stroke: 'var(--dsw-alias-link)', strokeWidth: 1.5, strokeLinejoin: 'round' })),
          h('marker', {
            id: mIds.hollowTriStart,
            markerWidth: 11,
            markerHeight: 10,
            refX: 1,
            refY: 5,
            orient: 'auto',
            markerUnits: 'userSpaceOnUse',
          }, h('path', { d: 'M10,1 L1,5 L10,9 Z', fill: 'var(--dsw-alias-bg-layer-1)', stroke: 'var(--dsw-alias-link)', strokeWidth: 1.5, strokeLinejoin: 'round' })),
          h('marker', {
            id: mIds.filledDiaEnd,
            markerWidth: 13,
            markerHeight: 10,
            refX: 12,
            refY: 5,
            orient: 'auto',
            markerUnits: 'userSpaceOnUse',
          }, h('path', { d: 'M1,5 L6.5,1.5 L12,5 L6.5,8.5 Z', fill: 'var(--dsw-alias-link)' })),
          h('marker', {
            id: mIds.filledDiaStart,
            markerWidth: 13,
            markerHeight: 10,
            refX: 1,
            refY: 5,
            orient: 'auto',
            markerUnits: 'userSpaceOnUse',
          }, h('path', { d: 'M1,5 L6.5,1.5 L12,5 L6.5,8.5 Z', fill: 'var(--dsw-alias-link)' })),
          h('marker', {
            id: mIds.hollowDiaEnd,
            markerWidth: 13,
            markerHeight: 10,
            refX: 12,
            refY: 5,
            orient: 'auto',
            markerUnits: 'userSpaceOnUse',
          }, h('path', { d: 'M1,5 L6.5,1.5 L12,5 L6.5,8.5 Z', fill: 'var(--dsw-alias-bg-layer-1)', stroke: 'var(--dsw-alias-link)', strokeWidth: 1.5 })),
          h('marker', {
            id: mIds.hollowDiaStart,
            markerWidth: 13,
            markerHeight: 10,
            refX: 1,
            refY: 5,
            orient: 'auto',
            markerUnits: 'userSpaceOnUse',
          }, h('path', { d: 'M1,5 L6.5,1.5 L12,5 L6.5,8.5 Z', fill: 'var(--dsw-alias-bg-layer-1)', stroke: 'var(--dsw-alias-link)', strokeWidth: 1.5 })),
        ),
        (diagram.subgraphs ?? []).map(sg => renderSubgraph(sg)),
        diagram.edges.map((edge, index) => renderEdge(edge, mIds, index)),
        diagram.nodes.map(node => renderNode(node)),
      )
    }

    function renderSubgraph(sg: GraphSubgraph) {
      return h('g', { key: 'sg:' + sg.id },
        h('rect', {
          x: sg.x,
          y: sg.y,
          width: sg.width,
          height: sg.height,
          rx: 12,
          fill: 'color-mix(in srgb, var(--dsw-alias-label-primary) 3%, transparent)',
          stroke: 'var(--dsw-alias-border-l3)',
          strokeWidth: 1,
          strokeDasharray: '5 4',
        }),
        h('text', {
          x: sg.x + 14,
          y: sg.y + 19,
          fontSize: 12,
          fontWeight: 600,
          fill: 'var(--dsw-alias-label-secondary)',
        }, sg.title),
      )
    }

    function resolveMarkerUrl(kind: string, isStart: boolean, mIds: MarkerIds) {
      if (kind === 'hollow_triangle') return 'url(#' + (isStart ? mIds.hollowTriStart : mIds.hollowTriEnd) + ')'
      if (kind === 'filled_diamond') return 'url(#' + (isStart ? mIds.filledDiaStart : mIds.filledDiaEnd) + ')'
      if (kind === 'hollow_diamond') return 'url(#' + (isStart ? mIds.hollowDiaStart : mIds.hollowDiaEnd) + ')'
      if (kind === 'arrow') return 'url(#' + (isStart ? mIds.arrowStart : mIds.arrowEnd) + ')'
      return undefined
    }

    function renderEdge(edge: GraphEdge, mIds: MarkerIds, key: number) {
      const strokeWidth = edge.style === 'thick' ? 2.5 : 1.5
      const pathProps: Record<string, unknown> = {
        key: 'line',
        d: edge.path,
        fill: 'none',
        stroke: 'var(--dsw-alias-link)',
        strokeWidth,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        opacity: edge.isBackEdge ? 0.85 : 1,
      }
      if (edge.style === 'dashed') pathProps.strokeDasharray = '5 4'
      const endKind = edge.endMarker ?? (edge.hasEndArrow ? 'arrow' : 'none')
      const startKind = edge.startMarker ?? (edge.hasStartArrow ? 'arrow' : 'none')
      const endUrl = resolveMarkerUrl(endKind, false, mIds)
      const startUrl = resolveMarkerUrl(startKind, true, mIds)
      if (endUrl) pathProps.markerEnd = endUrl
      if (startUrl) pathProps.markerStart = startUrl

      const children = [h('path', pathProps)]
      const label = (edge.label ?? '').trim()
      if (label !== '' && edge.labelLines && edge.labelLines.length > 0) {
        const w = edge.labelWidth
        const ht = edge.labelHeight
        children.push(h('rect', {
          key: 'label-bg',
          x: edge.labelX - w / 2,
          y: edge.labelY - ht / 2,
          width: w,
          height: ht,
          rx: 6,
          fill: 'var(--dsw-alias-bg-layer-1)',
          stroke: 'var(--dsw-alias-border-l3)',
          strokeWidth: 0.75,
        }))
        const lineHeight = 15
        const startY = edge.labelY - ((edge.labelLines.length - 1) * lineHeight) / 2
        children.push(h('text', {
          key: 'label',
          x: edge.labelX,
          y: startY,
          textAnchor: 'middle',
          dominantBaseline: 'central',
          fontSize: 12,
          fontWeight: 500,
          fill: 'var(--dsw-alias-label-secondary)',
        }, edge.labelLines.map((line, idx) => h('tspan', {
          key: idx,
          x: edge.labelX,
          dy: idx === 0 ? 0 : lineHeight,
        }, line))))
      }
      return h('g', { key: 'edge:' + key }, children)
    }

    function renderNode(node: GraphNode) {
      const w = node.width
      const ht = node.height
      const x = node.x - w / 2
      const y = node.y - ht / 2

      if (node.shape === 'state_start') {
        return h('g', { key: 'node:' + node.id },
          h('circle', { cx: node.x, cy: node.y, r: 10, fill: 'var(--dsw-alias-label-primary)' }),
        )
      }
      if (node.shape === 'state_end') {
        return h('g', { key: 'node:' + node.id },
          h('circle', { cx: node.x, cy: node.y, r: 12, fill: 'var(--dsw-alias-bg-layer-1)', stroke: 'var(--dsw-alias-label-primary)', strokeWidth: 2 }),
          h('circle', { cx: node.x, cy: node.y, r: 6.5, fill: 'var(--dsw-alias-label-primary)' }),
        )
      }
      if (node.shape === 'state_bar') {
        return h('g', { key: 'node:' + node.id },
          h('rect', { x, y, width: w, height: ht, rx: 4, fill: 'var(--dsw-alias-label-primary)' }),
        )
      }
      if (node.shape === 'actor') {
        const lineH = 17
        return h('g', { key: 'node:' + node.id },
          renderActorIcon(node.x, y + 20, 'var(--dsw-alias-link)'),
          h('text', {
            x: node.x,
            y: y + 44,
            textAnchor: 'middle',
            dominantBaseline: 'central',
            fontSize: 13,
            fontWeight: 500,
            fill: 'var(--dsw-alias-label-primary)',
          }, node.lines.map((line, index) => h('tspan', { key: index, x: node.x, dy: index === 0 ? 0 : lineH }, line))),
        )
      }
      if (node.shape === 'uml_class' && node.sections) {
        return renderUmlClassNode(node, x, y, w, ht)
      }

      const isDecision = node.shape === 'diamond' || node.shape === 'hexagon'
      const isTerminal = node.shape === 'stadium' || node.shape === 'circle' || node.shape === 'doublecircle'
      const fill = isDecision
        ? 'color-mix(in srgb, var(--dsw-alias-state-business-primary) 7%, var(--dsw-alias-bg-layer-1))'
        : isTerminal
          ? 'color-mix(in srgb, var(--dsw-alias-link) 6%, var(--dsw-alias-bg-layer-1))'
          : 'var(--dsw-alias-bg-layer-1)'
      const stroke = isDecision
        ? 'var(--dsw-alias-state-business-primary)'
        : isTerminal
          ? 'var(--dsw-alias-link)'
          : 'var(--dsw-alias-border-l3)'
      const shapeProps = { fill, stroke, strokeWidth: 1.5, strokeLinejoin: 'round' }

      let shapeEl
      let textOffsetY = 0
      let textOffsetX = 0

      if (node.shape === 'diamond') {
        const points = [
          [node.x, y],
          [x + w, node.y],
          [node.x, y + ht],
          [x, node.y],
        ].map(pt => pt.join(',')).join(' ')
        shapeEl = h('polygon', { points, ...shapeProps })
      } else if (node.shape === 'hexagon') {
        const ins = 14
        const points = [
          [x + ins, y],
          [x + w - ins, y],
          [x + w, node.y],
          [x + w - ins, y + ht],
          [x + ins, y + ht],
          [x, node.y],
        ].map(pt => pt.join(',')).join(' ')
        shapeEl = h('polygon', { points, ...shapeProps })
      } else if (node.shape === 'parallelogram') {
        const sl = 14
        const points = [[x + sl, y], [x + w, y], [x + w - sl, y + ht], [x, y + ht]].map(p => p.join(',')).join(' ')
        shapeEl = h('polygon', { points, ...shapeProps })
      } else if (node.shape === 'parallelogram_alt') {
        const sl = 14
        const points = [[x, y], [x + w - sl, y], [x + w, y + ht], [x + sl, y + ht]].map(p => p.join(',')).join(' ')
        shapeEl = h('polygon', { points, ...shapeProps })
      } else if (node.shape === 'trapezoid') {
        const sl = 14
        const points = [[x + sl, y], [x + w - sl, y], [x + w, y + ht], [x, y + ht]].map(p => p.join(',')).join(' ')
        shapeEl = h('polygon', { points, ...shapeProps })
      } else if (node.shape === 'trapezoid_alt') {
        const sl = 14
        const points = [[x, y], [x + w, y], [x + w - sl, y + ht], [x + sl, y + ht]].map(p => p.join(',')).join(' ')
        shapeEl = h('polygon', { points, ...shapeProps })
      } else if (node.shape === 'asymmetric') {
        const points = [
          [x, y],
          [x + w, y],
          [x + w, y + ht],
          [x, y + ht],
          [x + 12, node.y],
        ].map(p => p.join(',')).join(' ')
        shapeEl = h('polygon', { points, ...shapeProps })
        textOffsetX = 4
      } else if (node.shape === 'circle') {
        shapeEl = h('ellipse', { cx: node.x, cy: node.y, rx: w / 2, ry: ht / 2, ...shapeProps })
      } else if (node.shape === 'doublecircle') {
        shapeEl = h('g', null,
          h('ellipse', { cx: node.x, cy: node.y, rx: w / 2, ry: ht / 2, ...shapeProps }),
          h('ellipse', { cx: node.x, cy: node.y, rx: Math.max(4, w / 2 - 4), ry: Math.max(4, ht / 2 - 4), fill: 'none', stroke, strokeWidth: 1.25 }),
        )
      } else if (node.shape === 'cylinder') {
        const ry = 7
        const rx = w / 2
        const bodyPath = 'M ' + x + ' ' + (y + ry) +
          ' L ' + x + ' ' + (y + ht - ry) +
          ' A ' + rx + ' ' + ry + ' 0 0 0 ' + (x + w) + ' ' + (y + ht - ry) +
          ' L ' + (x + w) + ' ' + (y + ry) + ' Z'
        shapeEl = h('g', null,
          h('path', { d: bodyPath, ...shapeProps }),
          h('ellipse', { cx: node.x, cy: y + ry, rx, ry, ...shapeProps }),
        )
        textOffsetY = 3
      } else if (node.shape === 'subroutine') {
        shapeEl = h('g', null,
          h('rect', { x, y, width: w, height: ht, rx: 6, ...shapeProps }),
          h('line', { x1: x + 9, y1: y, x2: x + 9, y2: y + ht, stroke, strokeWidth: 1.25 }),
          h('line', { x1: x + w - 9, y1: y, x2: x + w - 9, y2: y + ht, stroke, strokeWidth: 1.25 }),
        )
      } else {
        const rx = node.shape === 'stadium' ? ht / 2 : node.shape === 'rounded' ? 14 : 8
        shapeEl = h('rect', { x, y, width: w, height: ht, rx, ...shapeProps })
      }

      const lineHeight = 18
      const startY = node.y + textOffsetY - ((node.lines.length - 1) * lineHeight) / 2
      const textX = node.x + textOffsetX
      const tspans = node.lines.map((line, index) => h('tspan', {
        key: index,
        x: textX,
        dy: index === 0 ? 0 : lineHeight,
      }, line))

      return h('g', { key: 'node:' + node.id },
        shapeEl,
        h('text', {
          x: textX,
          y: startY,
          textAnchor: 'middle',
          dominantBaseline: 'central',
          fontSize: 13,
          fontWeight: 500,
          fill: 'var(--dsw-alias-label-primary)',
        }, tspans),
      )
    }

    function renderUmlClassNode(node: GraphNode, x: number, y: number, w: number, ht: number) {
      const s = node.sections!
      const headerH = s.stereotype ? 44 : 30
      const attrs = s.attrs ?? []
      const methods = s.methods ?? []
      const attrsH = attrs.length > 0 ? attrs.length * 18 + 12 : 0
      const headerFill = 'color-mix(in srgb, var(--dsw-alias-link) 7%, var(--dsw-alias-bg-layer-1))'

      const elements = [
        h('rect', {
          key: 'bg',
          x,
          y,
          width: w,
          height: ht,
          rx: 8,
          fill: 'var(--dsw-alias-bg-layer-1)',
          stroke: 'var(--dsw-alias-border-l3)',
          strokeWidth: 1.5,
        }),
        h('path', {
          key: 'hdr-bg',
          d: 'M ' + (x + 8) + ' ' + y +
            ' L ' + (x + w - 8) + ' ' + y +
            ' Q ' + (x + w) + ' ' + y + ' ' + (x + w) + ' ' + (y + 8) +
            ' L ' + (x + w) + ' ' + (y + headerH) +
            ' L ' + x + ' ' + (y + headerH) +
            ' L ' + x + ' ' + (y + 8) +
            ' Q ' + x + ' ' + y + ' ' + (x + 8) + ' ' + y + ' Z',
          fill: headerFill,
        }),
      ]

      if (s.stereotype) {
        elements.push(h('text', {
          key: 'stereo',
          x: node.x,
          y: y + 13,
          textAnchor: 'middle',
          dominantBaseline: 'central',
          fontSize: 11,
          fill: 'var(--dsw-alias-label-secondary)',
        }, '«' + s.stereotype + '»'))
      }

      elements.push(h('text', {
        key: 'title',
        x: node.x,
        y: y + (s.stereotype ? 30 : 15),
        textAnchor: 'middle',
        dominantBaseline: 'central',
        fontSize: 13,
        fontWeight: 600,
        fill: 'var(--dsw-alias-label-primary)',
      }, s.title))

      if (attrs.length > 0 || methods.length > 0) {
        elements.push(h('line', {
          key: 'div1',
          x1: x,
          y1: y + headerH,
          x2: x + w,
          y2: y + headerH,
          stroke: 'var(--dsw-alias-border-l3)',
          strokeWidth: 1,
        }))
      }

      if (attrs.length > 0) {
        attrs.forEach((attr, idx) => {
          elements.push(h('text', {
            key: 'attr:' + idx,
            x: x + 12,
            y: y + headerH + 15 + idx * 18,
            dominantBaseline: 'central',
            fontSize: 12,
            fill: 'var(--dsw-alias-label-primary)',
          }, attr))
        })
      }

      if (methods.length > 0) {
        const mTop = y + headerH + attrsH
        if (attrs.length > 0) {
          elements.push(h('line', {
            key: 'div2',
            x1: x,
            y1: mTop,
            x2: x + w,
            y2: mTop,
            stroke: 'var(--dsw-alias-border-l3)',
            strokeWidth: 1,
          }))
        }
        methods.forEach((m, idx) => {
          elements.push(h('text', {
            key: 'method:' + idx,
            x: x + 12,
            y: mTop + 15 + idx * 18,
            dominantBaseline: 'central',
            fontSize: 12,
            fill: 'var(--dsw-alias-label-primary)',
          }, m))
        })
      }

      return h('g', { key: 'node:' + node.id }, elements)
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx: DshContext) {
        ctx.effect(() => ctx.locale.register(FLOWCHART_NS, { zh: flowchartZh, en: flowchartEn }), 'markdown-flowchart: dictionaries')
        for (const key of FLOWCHART_LANGUAGES) {
          ctx.slots.inject('conversation.chat.markdown.fence', () => ctx.slots.register({
            name: 'conversation.chat.markdown.fence',
            id: FLOWCHART_ID,
            key,
            order: 20,
            locale: FLOWCHART_NS,
          }, FlowchartFence))
        }
      },
    }
  },
})
