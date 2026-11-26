# DSH 代码围栏图表渲染器

[English](README.md) | 中文

在 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 会话中，将图表代码围栏渲染为适配主题的 SVG。插件扩展 DSH 的 Markdown 围栏插槽，保留其内置 Markdown 渲染器。

## 功能

- **多种图表**：支持流程图、时序图、UML 类图、状态图、ER 图，以及 PlantUML 组件图和用例图。
- **Mermaid 与 PlantUML 围栏**：识别 `flowchart`、`graph`、`mermaid`、`plantuml`、`puml` 和 `uml` 代码围栏。
- **安全渲染**：通过 React 元素生成 SVG，不注入图表 HTML。
- **可读的回退行为**：流式生成期间保留代码块；遇到不支持、无效或过于复杂的语法时，回退到 DSH 原始代码块。

## 预览

[![在 DSH 会话中渲染的图表](docs/preview.svg)](docs/preview.svg)

## 安装

需要 DSH `>=0.2.2-rc.3 <0.3.0`。本仓库是本地插件项目，`package.json` 标记为私有，未发布到 npm。

```sh
git clone https://github.com/dingyiliao/dsh-plugin-fence-code-renderer.git
cd dsh-plugin-fence-code-renderer
npm run build
```

在 DSH Web 中打开 **Plugins → Add plugin**，选择克隆后的项目目录。然后新建或重新打开会话，即可使用渲染器。

例如，发送以下 Markdown 围栏：

````markdown
```flowchart TD
  Start[开始] --> Check{成功?}
  Check -->|是| Done[完成]
  Check -->|否| Retry((重试))
```
````

## 支持的语法

- **流程图**：`TD`、`TB`、`BT`、`LR` 和 `RL` 方向；常见 Mermaid 节点形状与连线样式、边标签、扇出与扇入、嵌套子图，以及 CJK 文本自动换行。
- **时序图**：Mermaid `sequenceDiagram` 和 PlantUML `@startuml`；参与者、角色、数据库、激活条、组合片段、自调用、注释与分隔线。
- **类图**：Mermaid `classDiagram` 和 PlantUML 类、接口、枚举、成员、包、继承、实现、组合、聚合、关联与依赖。
- **状态图与 ER 图**：Mermaid `stateDiagram`、`stateDiagram-v2` 和 `erDiagram`；起止状态、组合状态、choice/fork/join 标记、实体字段与基数。
- **PlantUML 组件图与用例图**：常见组件、角色、数据库、包及其关系。

渲染器只实现 Mermaid 和 PlantUML 的常用语法子集。甘特图、饼图、脑图、`!include` 宏和活动图泳道等语法会回退为 DSH 原始代码块。

## 架构

`src/diagram-dispatcher.mjs` 选择解析器并返回布局模型。`src/` 中的流程图、时序图和 UML 模块负责解析与布局，`src/client-template.js` 将结果渲染为 SVG。`build.mjs` 把这些模块组装成供 DSH 加载的 `client.js`。插件入口与 Loader 补丁分别为 `index.js` 和 `cordis.patch.yml`。

## 开发

```sh
npm run build
npm test
npm run check
```

插件只处理 DSH Chat View 中的代码围栏。普通 Markdown、数学公式、diff 和文件链接仍由 DSH 处理。当前图表不支持拖拽、缩放或点击交互；需要复制或编辑源码时，请保留原始围栏。
