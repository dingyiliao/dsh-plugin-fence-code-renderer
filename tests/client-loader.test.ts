import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

type RenderProps = { lang: string; code: string; streaming: boolean; children: unknown; t: (key: string) => string }
type Renderer = (props: RenderProps) => unknown
type LoaderModule = { factory: (requireModule: (name: string) => unknown) => { inject: string[]; apply: (ctx: unknown) => void } }
type TestElement = { type: string; props: Record<string, unknown>; children: unknown[] }

function isElement(value: unknown): value is TestElement {
  return typeof value === 'object' && value !== null && 'type' in value && 'props' in value && 'children' in value
}

const clientPath = new URL('../dist/client.js', import.meta.url)

test('registers flowchart, mermaid, and plantuml fence languages through the DSH slot', async () => {
  const source = await readFile(clientPath, 'utf8')
  let loaded: LoaderModule | undefined
  const window = { __ModuleLoader__: { load(module: LoaderModule) { loaded = module } } }
  vm.runInNewContext(source, { window })
  const loadedModule = loaded as LoaderModule | undefined
  assert.ok(loadedModule)
  const registrations: Array<{ options: { key: string }; component: Renderer }> = []
  const React = {
    createElement(type: string, props: Record<string, unknown> | null, ...children: unknown[]) { return { type, props: props ?? {}, children } },
    useId() { return 'test-id' },
    useMemo<T>(factory: () => T) { return factory() },
  }
  const plugin = loadedModule.factory(name => {
    assert.equal(name, 'react')
    return React
  })
  assert.deepEqual(Array.from(plugin.inject), ['slots', 'locale'])
  plugin.apply({
    effect(run: () => unknown) { run() },
    locale: { register(namespace: string, dictionaries: Record<string, unknown>) {
      assert.equal(namespace, 'markdownFlowchart')
      assert.deepEqual(Object.keys(dictionaries), ['zh', 'en'])
    } },
    slots: {
      inject(name: string, register: () => unknown) {
        assert.equal(name, 'conversation.chat.markdown.fence')
        register()
      },
      register(options: { key: string }, component: Renderer) {
        registrations.push({ options, component })
        return () => {}
      },
    },
  })
  assert.deepEqual(registrations.map(entry => entry.options.key), ['flowchart', 'graph', 'mermaid', 'plantuml', 'puml', 'uml'])
  assert.ok(registrations.every(entry => typeof entry.component === 'function'))

  const render = registrations[0].component
  const child = { type: 'pre' }
  assert.equal(render({ lang: 'flowchart', code: 'A --> B', streaming: true, children: child, t: key => key }), child)
  assert.equal(render({ lang: 'flowchart', code: '{invalid', streaming: false, children: child, t: key => key }), child)
  assert.equal(render({ lang: 'mermaid', code: 'gantt\ntitle Plan', streaming: false, children: child, t: key => key }), child)
  assert.equal(render({ lang: 'plantuml', code: '@startuml\n!include common.puml\nA -> B\n@enduml', streaming: false, children: child, t: key => key }), child)

  const renderedFlow = render({
    lang: 'flowchart',
    code: 'flowchart TD\nsubgraph sg [步骤]\nA([开始]) -->|通过| B{判断}\nend\nB -. 失败 .-> A',
    streaming: false,
    children: child,
    t: key => key,
  })
  assert.ok(isElement(renderedFlow))
  assert.equal(renderedFlow.type, 'div')
  assert.equal(renderedFlow.props['data-dsh-flowchart'], 'flowchart')
  assert.equal(renderedFlow.props['data-dsh-diagram-kind'], 'flowchart')
  assert.equal(renderedFlow.props['aria-label'], 'diagram.flowchart')
  const svg = renderedFlow.children[0]
  assert.ok(isElement(svg))
  assert.equal(svg.type, 'svg')

  const renderedSeq = render({
    lang: 'mermaid',
    code: 'sequenceDiagram\nAlice->>Bob: 你好\nBob-->>Alice: 收到',
    streaming: false,
    children: child,
    t: key => key,
  })
  assert.ok(isElement(renderedSeq))
  assert.equal(renderedSeq.type, 'div')
  assert.equal(renderedSeq.props['data-dsh-diagram-kind'], 'sequence')
  assert.equal(renderedSeq.props['aria-label'], 'diagram.sequence')

  const renderedPlantClass = render({
    lang: 'plantuml',
    code: '@startuml\nclass User {\n  +String name\n  +login()\n}\nUser --> Session : creates\n@enduml',
    streaming: false,
    children: child,
    t: key => key,
  })
  assert.ok(isElement(renderedPlantClass))
  assert.equal(renderedPlantClass.type, 'div')
  assert.equal(renderedPlantClass.props['data-dsh-diagram-kind'], 'flowchart')
  assert.equal(renderedPlantClass.props['aria-label'], 'diagram.plantuml')
})
