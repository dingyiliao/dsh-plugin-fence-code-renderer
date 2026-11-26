# DSH Markdown and Diagrams

这是一个可安装到 DeepSeek Harness 的 Web UI 插件项目。DSH 原生负责会话 Markdown 的安全渲染；本插件通过 `conversation.chat.markdown.fence` HOC 扩展 Markdown 围栏，把 `flowchart`、`graph`、`mermaid`、`plantuml`、`puml`、`uml` 代码渲染成主题感知的 SVG 图表。

## 快速开始

在本目录执行：

```sh
npm run build
npm test
npm run check
```

然后在 DSH Web 的 **Plugins → Add plugin** 中选择本项目目录，例如：

```
markdown-flowchart-renderer/
```

安装后新建或重新打开会话，发送包含以下代码围栏的 Markdown：

````markdown
```flowchart TD
  Start[开始] --> Check{是否成功?}
  Check -->|是| Done[完成]
  Check -->|否| Retry((重试))
```
````

流式生成期间保留 DSH 原生代码块，围栏完成且语法可解析后才替换为 SVG。解析失败或超出安全上限时同样回退到原生代码块。

## 支持的图种与语法

- **流程图（`flowchart` / `graph` / `mermaid`）**：
  - 方向：`TD`、`TB`、`BT`、`LR`、`RL`。
  - 节点：`[矩形]`、`(圆角)`、`([胶囊])`、`[[子程序]]`、`[(数据库)]`、`{判断}`、`{{六边形}}`、`((圆形))`、`(((双圆)))`、`[/平行四边形/]`、`>旗帜]`，支持 `<br/>` / `\n` 换行及 `:::class` 缀名剥离。
  - 连线：`-->`、`---`、`-.->`、`-.-`、`==>`、`===`、`<-->`，支持 `&` 扇出扇入、边标签及循环回边绕行。
  - 子图：`subgraph id [标题] ... end` 容器分组与嵌套。
- **时序图（Mermaid `sequenceDiagram` & PlantUML `@startuml`）**：
  - 支持 `participant`、`actor`、`database`、`autonumber`、`title`、激活条（`+`/`-`/`activate`/`deactivate`）、`alt`/`else`/`opt`/`loop`/`par` 组合片段框、自调用、注释块（`note`）与分隔线（`== ... ==`）。
- **UML 类图（Mermaid `classDiagram` & PlantUML 类图）**：
  - 支持 `class`、`interface`、`abstract`、`enum`、构造型 `<<...>>`、属性与方法三段式卡片、包/命名空间分组，以及继承（`<|--`）、实现（`..|>`）、组合（`*--`）、聚合（`o--`）、关联（`-->`）、依赖（`..>`）与基数标注。
- **状态图与 ER 图（Mermaid `stateDiagram` / `stateDiagram-v2` / `erDiagram`）**：
  - 支持 `[*]` 起止节点、组合状态、`<<choice>>` / `<<fork>>` / `<<join>>`；ER 实体字段卡片与基数连线。
- **PlantUML 组件图 / 用例图（`plantuml` / `puml` / `uml`）**：
  - 支持 `[组件]`、`(用例)`、`actor`、`database`、`package { ... }`、`-->` / `..>` 等常用子集。
- **安全与自动回退**：通过 React SVG 元素渲染，不拼接 HTML。对于甘特图、饼图、脑图、`!include` 宏、活动图泳道等复杂或不支持的语法，自动回退为 DSH 原生代码块，保证内容可读与可复制。

## 项目结构

- `cordis.patch.yml`：把插件包插入 DSH Loader。
- `index.js`：Host 侧空插件入口。
- `src/text-metrics.mjs`：CJK/ASCII 视觉宽度测量与自动换行。
- `src/flowchart-core.mjs`：流程图解析与分层布局引擎。
- `src/sequence-core.mjs`：Mermaid / PlantUML 时序图解析与布局引擎。
- `src/uml-graph-core.mjs`：类图、状态图、ER 图与 PlantUML 组件/用例图解析器。
- `src/diagram-dispatcher.mjs`：多图种分发路由与回退保护。
- `src/client-template.js`：浏览器侧 SVG 渲染模板。
- `build.mjs`：将 `src/*.mjs` 组装注入模板生成 DSH 所需的 `client.js`。
- `locale/`、`docs/`、`icon.svg`：插件管理器显示资源。

## 限制

当前插件只负责 DSH Chat View 中的代码围栏。DSH 已有的普通 Markdown、数学公式、diff 和文件链接行为不被替换。图形不提供拖拽、缩放或交互式点击；请保留原始围栏以便复制和编辑。
