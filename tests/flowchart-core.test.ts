import assert from 'node:assert/strict'
import test from 'node:test'
import { layoutFlowchart, measureTextWidth, parseFlowchart, wrapLabel } from '../src/flowchart-core.ts'

test('parses directions, shapes, chained edges, and edge labels', () => {
  const graph = parseFlowchart([
    'flowchart LR',
    'Start([开始]) --> Check{是否成功?}',
    'Check -->|是| Done((完成))',
    'Check -- 否 --> Retry[重试]',
  ].join('\n'))
  assert.ok(graph)
  assert.equal(graph.direction, 'LR')
  assert.deepEqual(graph.nodes.map(node => [node.id, node.label, node.shape]), [
    ['Start', '开始', 'stadium'],
    ['Check', '是否成功?', 'diamond'],
    ['Done', '完成', 'circle'],
    ['Retry', '重试', 'rect'],
  ])
  assert.deepEqual(graph.edges.map(edge => edge.label), ['', '是', '否'])
})

test('parses advanced node shapes, class suffixes, quotes, & fan-out, and edge styles', () => {
  const graph = parseFlowchart([
    'flowchart TD',
    'A[(数据库)]:::db -. "异步; 同步" .-> B[[子程序]] & C{{六边形}}',
    'C == 关键路径 ==> D[/平行四边形/]',
    'D <--> E(((双圆)))',
  ].join('\n'))
  assert.ok(graph)
  assert.deepEqual(graph.nodes.map(n => [n.id, n.label, n.shape]), [
    ['A', '数据库', 'cylinder'],
    ['B', '子程序', 'subroutine'],
    ['C', '六边形', 'hexagon'],
    ['D', '平行四边形', 'parallelogram'],
    ['E', '双圆', 'doublecircle'],
  ])
  assert.equal(graph.edges.length, 4)
  assert.equal(graph.edges[0].style, 'dashed')
  assert.equal(graph.edges[0].label, '异步; 同步')
  assert.equal(graph.edges[2].style, 'thick')
  assert.equal(graph.edges[3].hasStartArrow, true)
  assert.equal(graph.edges[3].hasEndArrow, true)
})

test('parses subgraphs and rejects non-flowchart mermaid diagrams', () => {
  assert.equal(parseFlowchart('sequenceDiagram\nAlice->>Bob: Hello'), null)
  assert.equal(parseFlowchart('gantt\ntitle Plan'), null)
  assert.equal(parseFlowchart('plain text without edges'), null)

  const graph = parseFlowchart([
    'flowchart TD',
    'subgraph sg1 [处理阶段]',
    '  A[输入] --> B[校验]',
    'end',
    'B --> C[输出]',
  ].join('\n'))
  assert.ok(graph)
  const subgraphs = graph.subgraphs
  assert.ok(subgraphs)
  assert.equal(subgraphs.length, 1)
  assert.equal(subgraphs[0].title, '处理阶段')
  assert.equal(graph.nodes[0].subgraphId, 'sg1')
  assert.equal(graph.nodes[1].subgraphId, 'sg1')
  assert.equal(graph.nodes[2].subgraphId, null)
})

test('lays out a top-to-bottom graph inside a finite viewBox', () => {
  const graph = parseFlowchart('graph TD\nA[开始] --> B[结束]')
  assert.ok(graph)
  const layout = layoutFlowchart(graph)
  assert.ok(layout)
  assert.equal(layout.direction, 'TD')
  assert.ok(layout.width > 0)
  assert.ok(layout.height > 0)
  assert.equal(layout.nodes.length, 2)
  assert.ok(layout.nodes[0].y < layout.nodes[1].y)
  const bottom = Math.max(...layout.nodes.map(node => node.y + layout.nodeHeight / 2))
  assert.equal(layout.height, bottom + 28)
})

test('uses longest-path ranking for skip-level triangles and routes back-edges around nodes', () => {
  const tri = layoutFlowchart(parseFlowchart('flowchart TD\nA --> B\nB --> C\nA --> C'))
  assert.ok(tri)
  const [a, b, c] = tri.nodes
  assert.ok(a.y < b.y && b.y < c.y, 'A, B, C should sit on strictly increasing ranks')
  assert.ok(tri.edges[2].path.includes('C '), 'skip edge A->C should route as curved path')

  const loop = layoutFlowchart(parseFlowchart('flowchart TD\nStart([开始]) --> Check{判断}\nCheck -->|否| Retry[重试]\nRetry --> Check\nRetry --> Retry'))
  assert.ok(loop)
  assert.equal(loop.edges[2].isBackEdge, true)
  assert.equal(loop.edges[3].isBackEdge, true)
  assert.ok(loop.edges[2].labelX >= 0 && loop.edges[2].labelY >= 0)
  assert.ok(loop.width > Math.max(...loop.nodes.map(n => n.x + n.width / 2)))
})

test('wraps CJK labels by visual width and supports explicit line breaks', () => {
  assert.ok(measureTextWidth('中文测试', 13) > measureTextWidth('abcd', 13))
  const lines = wrapLabel('第一行<br/>这是一段比较长的中文说明文字需要自动换行')
  assert.equal(lines[0], '第一行')
  assert.ok(lines.length >= 3)
  assert.ok(lines.every(line => measureTextWidth(line, 13) <= 170))
})

test('returns null for empty or oversized sources', () => {
  assert.equal(parseFlowchart(''), null)
  assert.equal(parseFlowchart('x'.repeat(20_001)), null)
})
