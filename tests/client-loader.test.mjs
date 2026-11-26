import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const clientPath = new URL('../client.js', import.meta.url)

test('registers flowchart, mermaid, and plantuml fence languages through the DSH slot', async () => {
  const source = await readFile(clientPath, 'utf8')
  let loaded
  const window = { __ModuleLoader__: { load(module) { loaded = module } } }
  vm.runInNewContext(source, { window })
  assert.ok(loaded)
  const registrations = []
  const React = {
    createElement(type, props, ...children) { return { type, props: props ?? {}, children } },
    useId() { return 'test-id' },
    useMemo(factory) { return factory() },
  }
  const module = loaded
  const plugin = module.factory(name => {
    assert.equal(name, 'react')
    return React
  })
  assert.deepEqual(Array.from(plugin.inject), ['slots', 'locale'])
  plugin.apply({
    effect(run) { run() },
    locale: { register(namespace, dictionaries) {
      assert.equal(namespace, 'markdownFlowchart')
      assert.deepEqual(Object.keys(dictionaries), ['zh', 'en'])
    } },
    slots: {
      inject(name, register) {
        assert.equal(name, 'conversation.chat.markdown.fence')
        register()
      },
      register(options, component) {
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
  assert.equal(renderedFlow.type, 'div')
  assert.equal(renderedFlow.props['data-dsh-flowchart'], 'flowchart')
  assert.equal(renderedFlow.props['data-dsh-diagram-kind'], 'flowchart')
  assert.equal(renderedFlow.props['aria-label'], 'diagram.flowchart')
  assert.equal(renderedFlow.children[0].type, 'svg')

  const renderedSeq = render({
    lang: 'mermaid',
    code: 'sequenceDiagram\nAlice->>Bob: 你好\nBob-->>Alice: 收到',
    streaming: false,
    children: child,
    t: key => key,
  })
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
  assert.equal(renderedPlantClass.type, 'div')
  assert.equal(renderedPlantClass.props['data-dsh-diagram-kind'], 'flowchart')
  assert.equal(renderedPlantClass.props['aria-label'], 'diagram.plantuml')
})
