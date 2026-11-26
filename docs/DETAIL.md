![A theme-aware diagram rendered inside a DSH conversation](preview.svg)

## What it does

The plugin keeps DSH's built-in Markdown renderer and adds a zero-dependency SVG renderer for `flowchart`, `graph`, `mermaid`, `plantuml`, `puml`, and `uml` fences, supporting flowcharts, sequence diagrams, UML class diagrams, state diagrams, ER diagrams, and component/use-case diagrams.

Streaming fences remain code blocks until the source settles. Complex or unsupported syntax falls back cleanly to the original DSH code block, so the source stays readable and copyable.
