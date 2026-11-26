import assert from 'node:assert/strict'
import test from 'node:test'
import { parseAndLayoutDiagram } from '../src/diagram-dispatcher.ts'

type DiagramLayout = NonNullable<ReturnType<typeof parseAndLayoutDiagram>>

function expectLayoutKind<K extends DiagramLayout['kind']>(
  layout: DiagramLayout | null,
  kind: K,
): asserts layout is Extract<DiagramLayout, { kind: K }> {
  assert.ok(layout)
  assert.equal(layout.kind, kind)
}

test('renders Mermaid sequenceDiagram with activations, fragments, notes, and self-calls', () => {
  const layout = parseAndLayoutDiagram('mermaid', [
    'sequenceDiagram',
    'title 登录认证时序',
    'autonumber',
    'actor U as 用户',
    'participant A as 网关',
    'database DB as 用户库',
    'U->>+A: 提交登录请求',
    'A->>A: 校验参数',
    'alt 参数有效',
    '  A->>+DB: 查询用户',
    '  DB-->>-A: 返回记录',
    'else 参数无效',
    '  A-->>U: 返回 400',
    'end',
    'Note right of A: 记录审计日志',
    'deactivate A',
  ].join('\n'))

  expectLayoutKind(layout, 'sequence')
  assert.equal(layout.title, '登录认证时序')
  assert.equal(layout.participants.length, 3)
  assert.equal(layout.participants[0].kind, 'actor')
  assert.equal(layout.participants[2].kind, 'database')
  assert.equal(layout.fragments.length, 1)
  assert.equal(layout.fragments[0].sections.length, 1)
  assert.ok(layout.activations.length >= 2)
  assert.ok(layout.width > 0 && layout.height > 0)
})

test('renders PlantUML sequence diagram with quoted aliases and dividers', () => {
  const layout = parseAndLayoutDiagram('plantuml', [
    '@startuml',
    'participant "前端应用" as App',
    'participant "后端 API" as Api',
    '== 初始化 ==',
    'App -> Api : GET /profile',
    'note over App, Api : 携带 Bearer Token',
    'Api --> App : 200 OK',
    '@enduml',
  ].join('\n'))

  expectLayoutKind(layout, 'sequence')
  assert.equal(layout.participants.map(p => p.label).join(','), '前端应用,后端 API')
  assert.ok(layout.events.some(e => e.type === 'divider' && e.text === '初始化'))
  assert.ok(layout.events.some(e => e.type === 'note'))
})

test('renders Mermaid and PlantUML class diagrams with UML markers and compartments', () => {
  const mLayout = parseAndLayoutDiagram('mermaid', [
    'classDiagram',
    'class Animal {',
    '  <<abstract>>',
    '  +String name',
    '  +speak() void',
    '}',
    'class Dog {',
    '  +bark() void',
    '}',
    'Animal <|-- Dog : inherits',
  ].join('\n'))

  expectLayoutKind(mLayout, 'flowchart')
  assert.equal(mLayout.nodes[0].shape, 'uml_class')
  assert.equal(mLayout.nodes[0].sections?.stereotype, 'abstract')
  assert.equal(mLayout.edges[0].startMarker, 'hollow_triangle')

  const pLayout = parseAndLayoutDiagram('puml', [
    '@startuml',
    'interface Repository {',
    '  +findById(id)',
    '}',
    'class UserRepo {',
    '  -db',
    '  +findById(id)',
    '}',
    'Repository <|.. UserRepo',
    'UserService *-- UserRepo : owns',
    '@enduml',
  ].join('\n'))

  expectLayoutKind(pLayout, 'flowchart')
  assert.equal(pLayout.nodes.length, 3)
  assert.equal(pLayout.edges[0].style, 'dashed')
  assert.equal(pLayout.edges[0].startMarker, 'hollow_triangle')
  assert.equal(pLayout.edges[1].startMarker, 'filled_diamond')
})

test('renders Mermaid stateDiagram-v2 and erDiagram', () => {
  const stateLayout = parseAndLayoutDiagram('mermaid', [
    'stateDiagram-v2',
    '[*] --> Idle',
    'state Active {',
    '  Running --> Paused : pause',
    '}',
    'Idle --> Active : start',
    'Active --> [*]',
  ].join('\n'))

  expectLayoutKind(stateLayout, 'flowchart')
  assert.ok(stateLayout.nodes.some(n => n.shape === 'state_start'))
  assert.ok(stateLayout.nodes.some(n => n.shape === 'state_end'))
  assert.equal(stateLayout.subgraphs.length, 1)

  const erLayout = parseAndLayoutDiagram('mermaid', [
    'erDiagram',
    'CUSTOMER ||--o{ ORDER : places',
    'ORDER {',
    '  int id PK',
    '  string status',
    '}',
  ].join('\n'))

  expectLayoutKind(erLayout, 'flowchart')
  assert.equal(erLayout.nodes.length, 2)
  assert.equal(erLayout.edges[0].label, '1 places 0..*')
})

test('renders PlantUML component/usecase diagrams and falls back cleanly on complex/unsupported DSLs', () => {
  const compLayout = parseAndLayoutDiagram('plantuml', [
    '@startuml',
    'actor "管理员" as Admin',
    'package "后台服务" {',
    '  [API 网关] as GW',
    '  database "MySQL" as DB',
    '  GW --> DB : SQL',
    '}',
    'Admin --> (登录系统)',
    '(登录系统) ..> GW',
    '@enduml',
  ].join('\n'))

  expectLayoutKind(compLayout, 'flowchart')
  assert.equal(compLayout.subgraphs.length, 1)
  assert.ok(compLayout.nodes.some(n => n.shape === 'actor'))
  assert.ok(compLayout.nodes.some(n => n.shape === 'cylinder'))

  // Unsupported/complex diagrams must return null for code-block fallback
  assert.equal(parseAndLayoutDiagram('plantuml', '@startmindmap\n* Root\n** Child\n@endmindmap'), null)
  assert.equal(parseAndLayoutDiagram('plantuml', '@startuml\n!include theme.puml\nA -> B\n@enduml'), null)
  assert.equal(parseAndLayoutDiagram('plantuml', '@startuml\n|Swimlane1|\nstart\n:Step 1;\nstop\n@enduml'), null)
  assert.equal(parseAndLayoutDiagram('mermaid', 'pie title Pets\n"Dogs": 50\n"Cats": 50'), null)
})
