window.__ModuleLoader__.load({
    id: '@local/dsh-markdown-flowchart',
    factory(require) {
        const React = require('react');
        const h = React.createElement;
    /**
 * Shared CJK-aware text measurement and line wrapping utilities.
 */
/**
 * Measure approximate visual width of text in pixels at a given font size.
 * Accounts for wide CJK/fullwidth glyphs versus narrower Latin characters.
 */
function measureTextWidth(text, fontSize = 13) {
    let units = 0;
    for (const ch of String(text ?? '')) {
        const code = ch.codePointAt(0) ?? 0;
        if ((code >= 0x2e80 && code <= 0x9fff) ||
            (code >= 0xac00 && code <= 0xd7af) ||
            (code >= 0xf900 && code <= 0xfaff) ||
            (code >= 0xff01 && code <= 0xff60) ||
            (code >= 0xffe0 && code <= 0xffe6) ||
            code >= 0x1f000) {
            units += 1.0;
        }
        else if (ch === ' ' || ch === 'i' || ch === 'l' || ch === 'I' || ch === '1' || ch === '.' || ch === ',' || ch === ':' || ch === ';') {
            units += 0.36;
        }
        else if ((code >= 65 && code <= 90) || ch === 'm' || ch === 'w' || ch === '@' || ch === '%' || ch === '&') {
            units += 0.72;
        }
        else {
            units += 0.56;
        }
    }
    return Math.ceil(units * fontSize);
}
/**
 * Split label on explicit line breaks (<br/>, \n) and wrap lines by visual width.
 */
function wrapLabel(value, maxLineWidth = 156, fontSize = 13) {
    const raw = String(value ?? '')
        .replace(/<br\s*\/?>/giu, '\n')
        .replace(/\\n/gu, '\n');
    const paragraphs = raw.split('\n');
    const lines = [];
    for (const para of paragraphs) {
        const text = para.replace(/\s+/gu, ' ').trim();
        if (text === '') {
            if (paragraphs.length === 1)
                lines.push(' ');
            continue;
        }
        const tokens = text.split(' ');
        let current = '';
        for (const token of tokens) {
            const candidate = current === '' ? token : current + ' ' + token;
            if (measureTextWidth(candidate, fontSize) <= maxLineWidth) {
                current = candidate;
                continue;
            }
            if (current !== '') {
                lines.push(current);
                current = '';
            }
            if (measureTextWidth(token, fontSize) <= maxLineWidth) {
                current = token;
            }
            else {
                let chunk = '';
                for (const ch of token) {
                    if (chunk !== '' && measureTextWidth(chunk + ch, fontSize) > maxLineWidth) {
                        lines.push(chunk);
                        chunk = ch;
                    }
                    else {
                        chunk += ch;
                    }
                }
                current = chunk;
            }
        }
        if (current !== '')
            lines.push(current);
    }
    return lines.length > 0 ? lines : [' '];
}
function clamp(val, min, max) {
    return Math.max(min, Math.min(max, val));
}

/**
 * Dependency-free Mermaid-style flowchart parser and layered layout engine.
 * Supports flowchart/graph directions, common Mermaid node shapes, subgraphs,
 * chained & fan-out edges, edge styles, CJK-aware text wrapping, cycle-safe
 * longest-path layering, crossing minimization, and smooth edge routing.
 */

const MAX_SOURCE_LENGTH = 20_000;
const MAX_NODES = 80;
const MAX_EDGES = 160;
const NON_FLOWCHART_HEADER = /^(?:sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram|journey|gantt|pie|gitGraph|mindmap|timeline|quadrantChart|requirementDiagram|C4(?:Context|Container|Component|Dynamic|Deployment)|sankey-beta|xychart-beta|block-beta|packet-beta|kanban|architecture-beta)\b/iu;
const IGNORED_DIRECTIVE = /^(?:direction|classDef|class|style|linkStyle|click|accTitle|accDescr)\b/iu;
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
];
/**
 * Parse a Mermaid-style flowchart document.
 */
function parseFlowchart(source) {
    if (typeof source !== 'string' || source.length > MAX_SOURCE_LENGTH)
        return null;
    const cleaned = source.replace(/\r/g, '').replace(/%%\{[\s\S]*?\}%%/gu, '');
    const rawLines = cleaned.split('\n');
    for (const rawLine of rawLines) {
        const trimmed = rawLine.trim();
        if (trimmed === '' || trimmed.startsWith('%%'))
            continue;
        if (NON_FLOWCHART_HEADER.test(trimmed))
            return null;
        break;
    }
    const nodes = [];
    const byId = new Map();
    const edges = [];
    const subgraphs = [];
    const subgraphStack = [];
    let hasHeader = false;
    let hasExplicitShape = false;
    let direction = 'TD';
    let subgraphCounter = 0;
    const currentSubgraphId = () => (subgraphStack.length > 0 ? subgraphStack[subgraphStack.length - 1] : null);
    const ensureNode = (parsed) => {
        if (parsed === null)
            return null;
        if (parsed.explicitShape)
            hasExplicitShape = true;
        let node = byId.get(parsed.id);
        const sgId = currentSubgraphId();
        if (node === undefined) {
            if (nodes.length >= MAX_NODES)
                return null;
            node = {
                id: parsed.id,
                label: parsed.label,
                shape: parsed.shape,
                subgraphId: sgId,
            };
            nodes.push(node);
            byId.set(node.id, node);
        }
        else {
            if (parsed.explicitShape && (node.label === node.id || node.shape === 'rect')) {
                node.label = parsed.label;
                node.shape = parsed.shape;
            }
            if (node.subgraphId === null && sgId !== null) {
                node.subgraphId = sgId;
            }
        }
        return node;
    };
    for (const rawLine of rawLines) {
        let line = stripLineComment(rawLine).trim();
        if (line === '')
            continue;
        const directive = /^(?:flowchart|graph)(?:\s+(TD|TB|BT|LR|RL))?(?:\s*;?\s*$|\s+([\s\S]*))$/iu.exec(line);
        if (directive !== null) {
            hasHeader = true;
            direction = normalizeDirection(directive[1]);
            line = (directive[2] ?? '').trim();
            if (line === '')
                continue;
        }
        const sgMatch = /^subgraph\s+(.+)$/iu.exec(line);
        if (sgMatch !== null) {
            hasHeader = true;
            subgraphCounter += 1;
            const sg = parseSubgraphHeader(sgMatch[1], subgraphCounter, currentSubgraphId());
            subgraphs.push(sg);
            subgraphStack.push(sg.id);
            continue;
        }
        if (/^end$/iu.test(line)) {
            if (subgraphStack.length > 0)
                subgraphStack.pop();
            continue;
        }
        if (IGNORED_DIRECTIVE.test(line))
            continue;
        for (const statement of splitStatements(line)) {
            const stmtEdges = parseStatement(statement, ensureNode);
            if (stmtEdges === null)
                continue;
            if (edges.length + stmtEdges.length > MAX_EDGES)
                return null;
            edges.push(...stmtEdges);
        }
    }
    if (nodes.length === 0)
        return null;
    if (!hasHeader && edges.length === 0 && !hasExplicitShape)
        return null;
    const resolved = resolveSubgraphNodeAliases(nodes, edges, subgraphs);
    if (resolved.nodes.length === 0)
        return null;
    return { direction, nodes: resolved.nodes, edges: resolved.edges, subgraphs };
}
function resolveSubgraphNodeAliases(nodes, edges, subgraphs) {
    if (subgraphs.length === 0)
        return { nodes, edges };
    let curNodes = nodes.slice();
    let curEdges = edges.slice();
    for (const sg of subgraphs) {
        const ghostIdx = curNodes.findIndex(n => n.id === sg.id && n.label === n.id && n.shape === 'rect');
        if (ghostIdx === -1)
            continue;
        const members = curNodes.filter(n => n.subgraphId === sg.id && n.id !== sg.id);
        if (members.length === 0)
            continue;
        const memberIds = new Set(members.map(m => m.id));
        const hasInnerIn = new Set();
        const hasInnerOut = new Set();
        for (const edge of curEdges) {
            if (memberIds.has(edge.from) && memberIds.has(edge.to) && edge.from !== edge.to) {
                hasInnerOut.add(edge.from);
                hasInnerIn.add(edge.to);
            }
        }
        const entries = members.filter(m => !hasInnerIn.has(m.id));
        const exits = members.filter(m => !hasInnerOut.has(m.id));
        const entryTargets = entries.length > 0 ? entries : [members[0]];
        const exitSources = exits.length > 0 ? exits : [members[members.length - 1]];
        const nextEdges = [];
        for (const edge of curEdges) {
            const fromList = edge.from === sg.id ? exitSources.map(n => n.id) : [edge.from];
            const toList = edge.to === sg.id ? entryTargets.map(n => n.id) : [edge.to];
            for (const f of fromList) {
                for (const t of toList) {
                    if (nextEdges.length < MAX_EDGES) {
                        nextEdges.push({ ...edge, from: f, to: t });
                    }
                }
            }
        }
        curEdges = nextEdges;
        curNodes.splice(ghostIdx, 1);
    }
    return { nodes: curNodes, edges: curEdges };
}
function normalizeDirection(value) {
    const upper = String(value ?? '').toUpperCase();
    return upper === 'LR' || upper === 'RL' || upper === 'BT' ? upper : 'TD';
}
function parseSubgraphHeader(raw, index, parentId) {
    const trimmed = raw.trim();
    const bracketed = /^([A-Za-z0-9_][\w-]*)\s*\[([\s\S]+)\]$/u.exec(trimmed);
    if (bracketed !== null) {
        return { id: bracketed[1], title: cleanLabel(bracketed[2]), parentId };
    }
    return { id: 'subgraph_' + index, title: cleanLabel(trimmed), parentId };
}
/**
 * Strip %% comments outside quotes and bracketed labels.
 */
function stripLineComment(line) {
    let quote = '';
    let depth = 0;
    for (let i = 0; i < line.length; i += 1) {
        const ch = line[i];
        if (quote !== '') {
            if (ch === '\\') {
                i += 1;
                continue;
            }
            if (ch === quote)
                quote = '';
            continue;
        }
        if (ch === '"' || ch === "'") {
            quote = ch;
            continue;
        }
        if (ch === '[' || ch === '(' || ch === '{') {
            depth += 1;
            continue;
        }
        if ((ch === ']' || ch === ')' || ch === '}') && depth > 0) {
            depth -= 1;
            continue;
        }
        if (depth === 0 && ch === '%' && line[i + 1] === '%') {
            return line.slice(0, i);
        }
    }
    return line;
}
/**
 * Split a line on ';' only when outside quotes and node brackets.
 */
function splitStatements(line) {
    const result = [];
    let quote = '';
    let depth = 0;
    let start = 0;
    for (let i = 0; i < line.length; i += 1) {
        const ch = line[i];
        if (quote !== '') {
            if (ch === '\\') {
                i += 1;
                continue;
            }
            if (ch === quote)
                quote = '';
            continue;
        }
        if (ch === '"' || ch === "'") {
            quote = ch;
            continue;
        }
        if (ch === '[' || ch === '(' || ch === '{') {
            depth += 1;
            continue;
        }
        if ((ch === ']' || ch === ')' || ch === '}') && depth > 0) {
            depth -= 1;
            continue;
        }
        if (depth === 0 && ch === ';') {
            const part = line.slice(start, i).trim();
            if (part !== '')
                result.push(part);
            start = i + 1;
        }
    }
    const tail = line.slice(start).trim();
    if (tail !== '')
        result.push(tail);
    return result;
}
/**
 * Parse a single statement possibly containing '&' groups and chained edges.
 */
function parseStatement(statement, ensureNode) {
    let pos = skipSpaces(statement, 0);
    if (pos >= statement.length)
        return [];
    const firstGroup = readNodeGroup(statement, pos, ensureNode);
    if (firstGroup === null || firstGroup.nodes.length === 0)
        return null;
    pos = skipSpaces(statement, firstGroup.nextPos);
    if (pos >= statement.length)
        return [];
    const result = [];
    let fromNodes = firstGroup.nodes;
    while (pos < statement.length) {
        const edgeMatch = matchEdgeOperator(statement, pos);
        if (edgeMatch === null)
            break;
        pos = skipSpaces(statement, edgeMatch.nextPos);
        const toGroup = readNodeGroup(statement, pos, ensureNode);
        if (toGroup === null || toGroup.nodes.length === 0)
            break;
        for (const fromNode of fromNodes) {
            for (const toNode of toGroup.nodes) {
                result.push({
                    from: fromNode.id,
                    to: toNode.id,
                    label: edgeMatch.label,
                    style: edgeMatch.style,
                    hasStartArrow: edgeMatch.hasStartArrow,
                    hasEndArrow: edgeMatch.hasEndArrow,
                });
            }
        }
        fromNodes = toGroup.nodes;
        pos = skipSpaces(statement, toGroup.nextPos);
    }
    return result;
}
function skipSpaces(str, pos) {
    while (pos < str.length && (str[pos] === ' ' || str[pos] === '\t'))
        pos += 1;
    return pos;
}
function readNodeGroup(str, startPos, ensureNode) {
    const nodes = [];
    let pos = startPos;
    while (pos < str.length) {
        pos = skipSpaces(str, pos);
        const token = readNodeTokenAt(str, pos);
        if (token === null)
            break;
        const node = ensureNode(token.node);
        if (node !== null)
            nodes.push(node);
        pos = skipSpaces(str, token.nextPos);
        if (str[pos] === '&') {
            pos += 1;
            continue;
        }
        break;
    }
    if (nodes.length === 0)
        return null;
    return { nodes, nextPos: pos };
}
/**
 * Read a node identifier and optional shape brackets at str[pos].
 */
function readNodeTokenAt(str, pos) {
    const slice = str.slice(pos);
    const idMatch = /^([A-Za-z0-9_][\w-]*)/u.exec(slice);
    if (idMatch === null)
        return null;
    const id = idMatch[1];
    let cur = pos + id.length;
    const afterId = skipSpaces(str, cur);
    const openCh = str[afterId];
    if (openCh !== '[' && openCh !== '(' && openCh !== '{' && openCh !== '>') {
        cur = skipClassSuffix(str, cur);
        return { node: { id, label: id, shape: 'rect', explicitShape: false }, nextPos: cur };
    }
    // Only treat whitespace before shape opener if it's directly attached or standard bracket
    if (afterId > cur && openCh === '>') {
        // '>' after space is likely not asymmetric node syntax
        cur = skipClassSuffix(str, cur);
        return { node: { id, label: id, shape: 'rect', explicitShape: false }, nextPos: cur };
    }
    // Scan balanced shape payload starting at afterId
    const endPos = scanShapeEnd(str, afterId);
    if (endPos === -1) {
        cur = skipClassSuffix(str, cur);
        return { node: { id, label: id, shape: 'rect', explicitShape: false }, nextPos: cur };
    }
    const rawShape = str.slice(afterId, endPos);
    const parsedShape = decodeNodeShape(rawShape);
    const nextPos = skipClassSuffix(str, endPos);
    return {
        node: {
            id,
            label: parsedShape.label,
            shape: parsedShape.shape,
            explicitShape: true,
        },
        nextPos,
    };
}
function skipClassSuffix(str, pos) {
    const match = /^:::[A-Za-z0-9_-]+/u.exec(str.slice(pos));
    return match !== null ? pos + match[0].length : pos;
}
function scanShapeEnd(str, start) {
    const open = str[start];
    const expectedTopClose = open === '(' ? ')' : open === '{' ? '}' : ']';
    let quote = '';
    let depth = 0;
    for (let i = start; i < str.length; i += 1) {
        const ch = str[i];
        if (quote !== '') {
            if (ch === '\\') {
                i += 1;
                continue;
            }
            if (ch === quote)
                quote = '';
            continue;
        }
        if (ch === '"' || ch === "'") {
            quote = ch;
            continue;
        }
        if (ch === '[' || ch === '(' || ch === '{') {
            depth += 1;
            continue;
        }
        if (ch === ']' || ch === ')' || ch === '}') {
            if (depth > 0)
                depth -= 1;
            if (depth === 0 && ch === expectedTopClose) {
                // Consume any extra closing chars belonging to double/triple openers e.g. )) or )))
                return i + 1;
            }
            if (depth === 0 && open === '>')
                return i + 1;
        }
    }
    return -1;
}
function decodeNodeShape(raw) {
    for (const def of SHAPE_DEFS) {
        if (raw.startsWith(def.open) && raw.endsWith(def.close) && raw.length >= def.open.length + def.close.length) {
            return {
                shape: def.shape,
                label: cleanLabel(raw.slice(def.open.length, raw.length - def.close.length)),
            };
        }
    }
    return { shape: 'rect', label: cleanLabel(raw) };
}
function cleanLabel(value) {
    const text = String(value ?? '').trim();
    if (text.length >= 2 && ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'")))) {
        return text.slice(1, -1) || ' ';
    }
    return text || ' ';
}
/**
 * Match a Mermaid edge operator (with optional inline or pipe label) at str[pos].
 */
function matchEdgeOperator(str, pos) {
    const slice = str.slice(pos);
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
    ];
    for (const pat of patterns) {
        const m = pat.re.exec(slice);
        if (m !== null) {
            const rawLabel = pat.labelGroup > 0 ? m[pat.labelGroup] : '';
            return {
                style: pat.style,
                hasStartArrow: pat.start,
                hasEndArrow: pat.end,
                label: rawLabel ? cleanLabel(rawLabel) : '',
                nextPos: pos + m[0].length,
            };
        }
    }
    return null;
}
/**
 * Compute node dimensions, ranks, crossing-minimized coordinates, subgraphs, and routed edge paths.
 */
function layoutFlowchart(graph) {
    if (graph === null || graph.nodes.length === 0)
        return null;
    const horizontal = graph.direction === 'LR' || graph.direction === 'RL';
    const flipMain = graph.direction === 'RL' || graph.direction === 'BT';
    const margin = 28;
    const crossGap = (graph.subgraphs?.length ?? 0) > 0 ? 42 : 32;
    const baseRankGap = horizontal ? 60 : 52;
    // 1. Measure every real node
    const nodeMeta = new Map();
    for (const node of graph.nodes) {
        const dim = computeNodeDimensions(node);
        nodeMeta.set(node.id, {
            ...node,
            subgraphId: node.subgraphId ?? null,
            ...dim,
            isDummy: false,
        });
    }
    // 2. Break cycles via DFS & assign longest-path ranks
    const { isBackEdge, ranks } = assignRanks(graph.nodes, graph.edges);
    // 3. Build rank layers + insert dummy waypoints for skip-level DAG edges
    const layers = new Map();
    const ensureLayer = (r) => {
        if (!layers.has(r))
            layers.set(r, []);
        return layers.get(r);
    };
    for (const node of graph.nodes) {
        const r = ranks.get(node.id) ?? 0;
        const meta = nodeMeta.get(node.id);
        meta.rank = r;
        ensureLayer(r).push(meta);
    }
    const dagAdjOut = new Map();
    const dagAdjIn = new Map();
    const addDagLink = (uId, vId) => {
        if (!dagAdjOut.has(uId))
            dagAdjOut.set(uId, []);
        if (!dagAdjIn.has(vId))
            dagAdjIn.set(vId, []);
        dagAdjOut.get(uId).push(vId);
        dagAdjIn.get(vId).push(uId);
    };
    const edgeRoutingChain = new Map();
    let dummyCounter = 0;
    graph.edges.forEach((edge, edgeIndex) => {
        if (isBackEdge[edgeIndex])
            return;
        const rFrom = ranks.get(edge.from) ?? 0;
        const rTo = ranks.get(edge.to) ?? 0;
        const chain = [edge.from];
        for (let r = rFrom + 1; r < rTo; r += 1) {
            dummyCounter += 1;
            const dummyId = '__dummy_' + dummyCounter;
            const dummyNode = {
                id: dummyId,
                isDummy: true,
                rank: r,
                width: horizontal ? 12 : 20,
                height: horizontal ? 20 : 12,
                lines: [],
                subgraphId: null,
            };
            nodeMeta.set(dummyId, dummyNode);
            ensureLayer(r).push(dummyNode);
            addDagLink(chain[chain.length - 1], dummyId);
            chain.push(dummyId);
        }
        addDagLink(chain[chain.length - 1], edge.to);
        chain.push(edge.to);
        edgeRoutingChain.set(edgeIndex, chain);
    });
    const maxRank = Math.max(...layers.keys());
    // 4. Crossing minimization (barycenter sweeps)
    for (let sweep = 0; sweep < 4; sweep += 1) {
        for (let r = 1; r <= maxRank; r += 1) {
            sortLayerByBarycenter(layers.get(r) ?? [], layers.get(r - 1) ?? [], dagAdjIn);
        }
        for (let r = maxRank - 1; r >= 0; r -= 1) {
            sortLayerByBarycenter(layers.get(r) ?? [], layers.get(r + 1) ?? [], dagAdjOut);
        }
    }
    // 5. Compute rank-gap padding (extra gap if labeled edges cross between ranks r and r+1)
    const rankGapAfter = new Map();
    for (let r = 0; r < maxRank; r += 1) {
        let extra = 0;
        for (let i = 0; i < graph.edges.length; i += 1) {
            if (isBackEdge[i])
                continue;
            const edge = graph.edges[i];
            if (!edge.label || edge.label.trim() === '')
                continue;
            const rFrom = ranks.get(edge.from) ?? 0;
            const rTo = ranks.get(edge.to) ?? 0;
            if (rFrom <= r && r < rTo && rTo - rFrom === 1) {
                const lblDim = measureEdgeLabel(edge.label);
                extra = Math.max(extra, horizontal ? lblDim.width + 20 : lblDim.height + 16);
            }
        }
        // Check if subgraphs start/end between r and r+1
        rankGapAfter.set(r, Math.max(baseRankGap, extra));
    }
    // Add extra gap if a subgraph starts at rank r+1 with a title header
    const subgraphs = graph.subgraphs ?? [];
    if (subgraphs.length > 0 && !horizontal) {
        const sgMinRank = new Map();
        for (const node of graph.nodes) {
            if (!node.subgraphId)
                continue;
            const r = ranks.get(node.id) ?? 0;
            if (!sgMinRank.has(node.subgraphId) || r < sgMinRank.get(node.subgraphId)) {
                sgMinRank.set(node.subgraphId, r);
            }
        }
        for (const minR of sgMinRank.values()) {
            if (minR > 0) {
                rankGapAfter.set(minR - 1, Math.max(rankGapAfter.get(minR - 1) ?? baseRankGap, baseRankGap + 24));
            }
        }
    }
    // 6. Position nodes along main axis and cross axis
    const rankMainSize = new Map();
    const rankCrossSpan = new Map();
    for (let r = 0; r <= maxRank; r += 1) {
        const group = layers.get(r) ?? [];
        let maxM = 0;
        let span = 0;
        group.forEach((node, idx) => {
            const mSize = horizontal ? node.width : node.height;
            const cSize = horizontal ? node.height : node.width;
            if (mSize > maxM)
                maxM = mSize;
            span += cSize;
            if (idx > 0)
                span += crossGap;
        });
        rankMainSize.set(r, Math.max(24, maxM));
        rankCrossSpan.set(r, span);
    }
    const maxCrossSpan = Math.max(...rankCrossSpan.values());
    let mainCursor = margin;
    for (let r = 0; r <= maxRank; r += 1) {
        const group = layers.get(r) ?? [];
        const mSize = rankMainSize.get(r) ?? 44;
        const centerMain = mainCursor + mSize / 2;
        const span = rankCrossSpan.get(r) ?? 0;
        let crossCursor = margin + (maxCrossSpan - span) / 2;
        for (const node of group) {
            const cSize = horizontal ? node.height : node.width;
            node.main = centerMain;
            node.cross = crossCursor + cSize / 2;
            node.mainSize = horizontal ? node.width : node.height;
            node.crossSize = cSize;
            crossCursor += cSize + crossGap;
        }
        mainCursor += mSize + (r < maxRank ? (rankGapAfter.get(r) ?? baseRankGap) : 0);
    }
    // Mild cross-axis alignment pull toward connected parents/children (without overlapping neighbors)
    alignCrossPositions(layers, maxRank, dagAdjIn, dagAdjOut, crossGap);
    const contentMainEnd = mainCursor + margin;
    let minCross = Infinity;
    let maxCross = -Infinity;
    for (const node of nodeMeta.values()) {
        minCross = Math.min(minCross, node.cross - node.crossSize / 2);
        maxCross = Math.max(maxCross, node.cross + node.crossSize / 2);
    }
    // 7. Compute edge port offsets & route all edges in canonical (main, cross) coordinates
    const edgeGeometries = routeAllEdges(graph.edges, nodeMeta, isBackEdge, edgeRoutingChain, minCross, maxCross, horizontal, flipMain);
    // 8. Compute bounding box including back-edges, self-loops, edge labels, and subgraphs
    let boundMainMin = margin;
    let boundMainMax = contentMainEnd - margin;
    let boundCrossMin = minCross;
    let boundCrossMax = maxCross;
    for (const eg of edgeGeometries) {
        for (const pt of eg.extents) {
            boundMainMin = Math.min(boundMainMin, pt.main);
            boundMainMax = Math.max(boundMainMax, pt.main);
            boundCrossMin = Math.min(boundCrossMin, pt.cross);
            boundCrossMax = Math.max(boundCrossMax, pt.cross);
        }
    }
    // Compute subgraph boxes in canonical space
    const sgPadTop = 32;
    const sgPadSide = 18;
    const sgPadBottom = 18;
    const subgraphBoxes = computeSubgraphBoxes(subgraphs, graph.nodes, nodeMeta, horizontal, sgPadTop, sgPadSide, sgPadBottom);
    for (const sg of subgraphBoxes) {
        boundMainMin = Math.min(boundMainMin, sg.mainMin);
        boundMainMax = Math.max(boundMainMax, sg.mainMax);
        boundCrossMin = Math.min(boundCrossMin, sg.crossMin);
        boundCrossMax = Math.max(boundCrossMax, sg.crossMax);
    }
    const shiftMain = margin - boundMainMin;
    const shiftCross = margin - boundCrossMin;
    const totalMain = Math.max(1, Math.ceil(boundMainMax - boundMainMin + margin * 2));
    const totalCross = Math.max(1, Math.ceil(boundCrossMax - boundCrossMin + margin * 2));
    const width = horizontal ? totalMain : totalCross;
    const height = horizontal ? totalCross : totalMain;
    const toXY = (m, c) => {
        const sm = m + shiftMain;
        const sc = c + shiftCross;
        const finalM = flipMain ? totalMain - sm : sm;
        return horizontal ? { x: finalM, y: sc } : { x: sc, y: finalM };
    };
    // 9. Finalize positioned nodes, edges, and subgraphs
    const positionedNodes = graph.nodes.map(node => {
        const meta = nodeMeta.get(node.id);
        const pt = toXY(meta.main, meta.cross);
        const item = {
            id: meta.id,
            label: meta.label,
            shape: meta.shape,
            subgraphId: meta.subgraphId,
            x: pt.x,
            y: pt.y,
            width: meta.width,
            height: meta.height,
            lines: meta.lines,
        };
        if (meta.sections !== undefined)
            item.sections = meta.sections;
        return item;
    });
    const positionedEdges = graph.edges.map((edge, index) => {
        const eg = edgeGeometries[index];
        const path = buildSvgPath(eg.segments, toXY);
        const lblPt = toXY(eg.labelMain, eg.labelCross);
        const lblDim = edge.label && edge.label.trim() !== '' ? measureEdgeLabel(edge.label) : { width: 0, height: 0, lines: [] };
        const hasStart = edge.hasStartArrow ?? false;
        const hasEnd = edge.hasEndArrow ?? true;
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
        };
    });
    const positionedSubgraphs = subgraphBoxes.map(sg => {
        const p1 = toXY(sg.mainMin, sg.crossMin);
        const p2 = toXY(sg.mainMax, sg.crossMax);
        const x = Math.min(p1.x, p2.x);
        const y = Math.min(p1.y, p2.y);
        return {
            id: sg.id,
            title: sg.title,
            x,
            y,
            width: Math.abs(p2.x - p1.x),
            height: Math.abs(p2.y - p1.y),
        };
    });
    const maxNodeWidth = Math.max(...positionedNodes.map(n => n.width));
    const maxNodeHeight = Math.max(...positionedNodes.map(n => n.height));
    return {
        kind: 'flowchart',
        direction: graph.direction,
        width,
        height,
        nodeWidth: maxNodeWidth,
        nodeHeight: maxNodeHeight,
        nodes: positionedNodes,
        edges: positionedEdges,
        subgraphs: positionedSubgraphs,
    };
}
function computeNodeDimensions(node) {
    if (node.shape === 'state_start' || node.shape === 'state_end') {
        return { width: 28, height: 28, lines: [] };
    }
    if (node.shape === 'state_bar') {
        return { width: 96, height: 10, lines: [] };
    }
    if (node.shape === 'uml_class' && node.sections) {
        const s = node.sections;
        const allLines = [
            s.stereotype ? '«' + s.stereotype + '»' : '',
            s.title,
            ...(s.attrs ?? []),
            ...(s.methods ?? []),
        ].filter(Boolean);
        const maxW = Math.max(80, ...allLines.map(l => measureTextWidth(l, 12)));
        const width = clamp(maxW + 28, 116, 300);
        const headerH = s.stereotype ? 44 : 30;
        const attrsH = (s.attrs?.length ?? 0) > 0 ? s.attrs.length * 18 + 12 : 0;
        const methodsH = (s.methods?.length ?? 0) > 0 ? s.methods.length * 18 + 12 : 0;
        const height = Math.max(40, headerH + attrsH + methodsH);
        return { width, height, lines: [s.title] };
    }
    if (node.shape === 'actor') {
        const lines = wrapLabel(node.label, 140, 13);
        const textWidth = Math.max(...lines.map(line => measureTextWidth(line, 13)));
        return {
            width: clamp(textWidth + 28, 76, 180),
            height: Math.max(66, 44 + lines.length * 17),
            lines,
        };
    }
    const maxLineWidth = node.shape === 'diamond' ? 132 : 164;
    const lines = wrapLabel(node.label, maxLineWidth, 13);
    const textWidth = Math.max(...lines.map(line => measureTextWidth(line, 13)));
    const textHeight = lines.length * 18;
    let width;
    let height;
    switch (node.shape) {
        case 'diamond':
            width = clamp(Math.ceil(textWidth * 1.5 + 48), 108, 280);
            height = Math.max(68, Math.ceil(textHeight * 1.55 + 32));
            break;
        case 'circle':
        case 'doublecircle': {
            const pad = node.shape === 'doublecircle' ? 40 : 32;
            if (lines.length === 1 && textWidth <= 72) {
                const d = clamp(Math.max(textWidth, textHeight) + pad, 58, 128);
                width = d;
                height = d;
            }
            else {
                width = clamp(textWidth + pad + 18, 76, 220);
                height = Math.max(58, textHeight + pad + 8);
            }
            break;
        }
        case 'stadium':
            width = clamp(textWidth + 44, 92, 248);
            height = Math.max(42, textHeight + 22);
            break;
        case 'subroutine':
            width = clamp(textWidth + 52, 100, 256);
            height = Math.max(44, textHeight + 24);
            break;
        case 'cylinder':
            width = clamp(textWidth + 40, 92, 240);
            height = Math.max(56, textHeight + 34);
            break;
        case 'hexagon':
        case 'parallelogram':
        case 'parallelogram_alt':
        case 'trapezoid':
        case 'trapezoid_alt':
            width = clamp(textWidth + 56, 104, 264);
            height = Math.max(46, textHeight + 24);
            break;
        case 'asymmetric':
            width = clamp(textWidth + 48, 96, 250);
            height = Math.max(44, textHeight + 24);
            break;
        default:
            width = clamp(textWidth + 36, 84, 240);
            height = Math.max(44, textHeight + 24);
            break;
    }
    return { width, height, lines };
}
function measureEdgeLabel(label) {
    const lines = wrapLabel(label, 140, 12);
    const textWidth = Math.max(...lines.map(l => measureTextWidth(l, 12)));
    return {
        width: Math.max(28, textWidth + 16),
        height: Math.max(20, lines.length * 15 + 6),
        lines,
    };
}
/**
 * Detect cycle back-edges via DFS and assign longest-path ranks on the resulting DAG.
 */
function assignRanks(nodes, edges) {
    const outgoing = new Map(nodes.map(n => [n.id, []]));
    const inCount = new Map(nodes.map(n => [n.id, 0]));
    edges.forEach((edge, index) => {
        outgoing.get(edge.from)?.push({ to: edge.to, index });
        inCount.set(edge.to, (inCount.get(edge.to) ?? 0) + 1);
    });
    const state = new Map(); // 0 = unvisited, 1 = visiting, 2 = visited
    const isBackEdge = edges.map(() => false);
    const dfs = (u) => {
        state.set(u, 1);
        for (const item of outgoing.get(u) ?? []) {
            if (item.to === u) {
                isBackEdge[item.index] = true;
                continue;
            }
            const st = state.get(item.to) ?? 0;
            if (st === 1) {
                isBackEdge[item.index] = true;
            }
            else if (st === 0) {
                dfs(item.to);
            }
        }
        state.set(u, 2);
    };
    const roots = nodes.filter(n => (inCount.get(n.id) ?? 0) === 0).map(n => n.id);
    for (const r of roots) {
        if ((state.get(r) ?? 0) === 0)
            dfs(r);
    }
    for (const n of nodes) {
        if ((state.get(n.id) ?? 0) === 0)
            dfs(n.id);
    }
    // Kahn's topological longest-path ranking on DAG edges
    const dagOut = new Map(nodes.map(n => [n.id, []]));
    const dagIn = new Map(nodes.map(n => [n.id, 0]));
    edges.forEach((edge, index) => {
        if (isBackEdge[index])
            return;
        dagOut.get(edge.from)?.push(edge.to);
        dagIn.set(edge.to, (dagIn.get(edge.to) ?? 0) + 1);
    });
    const ranks = new Map(nodes.map(n => [n.id, 0]));
    const queue = nodes.filter(n => (dagIn.get(n.id) ?? 0) === 0).map(n => n.id);
    const topoOrder = [];
    while (queue.length > 0) {
        const u = queue.shift();
        topoOrder.push(u);
        const rU = ranks.get(u) ?? 0;
        for (const v of dagOut.get(u) ?? []) {
            if ((ranks.get(v) ?? 0) < rU + 1) {
                ranks.set(v, rU + 1);
            }
            const rem = (dagIn.get(v) ?? 1) - 1;
            dagIn.set(v, rem);
            if (rem === 0)
                queue.push(v);
        }
    }
    // Pull root nodes closer to their shallowest child so side-inputs don't float at rank 0
    const dagInCountOrig = new Map(nodes.map(n => [n.id, 0]));
    edges.forEach((edge, index) => {
        if (!isBackEdge[index])
            dagInCountOrig.set(edge.to, (dagInCountOrig.get(edge.to) ?? 0) + 1);
    });
    for (let i = topoOrder.length - 1; i >= 0; i -= 1) {
        const u = topoOrder[i];
        const children = dagOut.get(u) ?? [];
        if ((dagInCountOrig.get(u) ?? 0) === 0 && children.length > 0) {
            const minChildRank = Math.min(...children.map(v => ranks.get(v) ?? 0));
            if (minChildRank - 1 > (ranks.get(u) ?? 0)) {
                ranks.set(u, minChildRank - 1);
            }
        }
    }
    return { isBackEdge, ranks };
}
function sortLayerByBarycenter(layer, neighborLayer, adj) {
    if (layer.length <= 1 || neighborLayer.length === 0)
        return;
    const neighborPos = new Map();
    neighborLayer.forEach((node, idx) => neighborPos.set(node.id, idx));
    const scores = new Map();
    layer.forEach((node, idx) => {
        const neighbors = (adj.get(node.id) ?? []).filter(id => neighborPos.has(id));
        if (neighbors.length === 0) {
            scores.set(node.id, idx);
        }
        else {
            const avg = neighbors.reduce((sum, id) => sum + neighborPos.get(id), 0) / neighbors.length;
            scores.set(node.id, avg);
        }
    });
    const origIdx = new Map(layer.map((n, i) => [n.id, i]));
    layer.sort((a, b) => {
        const diff = (scores.get(a.id) ?? 0) - (scores.get(b.id) ?? 0);
        return Math.abs(diff) > 1e-6 ? diff : (origIdx.get(a.id) ?? 0) - (origIdx.get(b.id) ?? 0);
    });
}
function alignCrossPositions(layers, maxRank, dagAdjIn, dagAdjOut, crossGap) {
    const byId = new Map();
    for (let r = 0; r <= maxRank; r += 1) {
        for (const node of layers.get(r) ?? [])
            byId.set(node.id, node);
    }
    for (let pass = 0; pass < 2; pass += 1) {
        for (let r = 1; r <= maxRank; r += 1) {
            nudgeLayerToward(layers.get(r) ?? [], dagAdjIn, byId, crossGap);
        }
        for (let r = maxRank - 1; r >= 0; r -= 1) {
            nudgeLayerToward(layers.get(r) ?? [], dagAdjOut, byId, crossGap);
        }
    }
}
function nudgeLayerToward(layer, adj, byId, crossGap) {
    if (layer.length === 0)
        return;
    for (let i = 0; i < layer.length; i += 1) {
        const node = layer[i];
        const neighbors = (adj.get(node.id) ?? []).map(id => byId.get(id)).filter(Boolean);
        if (neighbors.length === 0)
            continue;
        const target = neighbors.reduce((sum, n) => sum + n.cross, 0) / neighbors.length;
        const prev = i > 0 ? layer[i - 1] : null;
        const next = i + 1 < layer.length ? layer[i + 1] : null;
        const minC = prev !== null ? prev.cross + prev.crossSize / 2 + crossGap + node.crossSize / 2 : -Infinity;
        const maxC = next !== null ? next.cross - next.crossSize / 2 - crossGap - node.crossSize / 2 : Infinity;
        node.cross = clamp(target, minC, maxC);
    }
}
/**
 * Compute shape boundary offset along main axis given a cross-axis port offset.
 */
function shapeMainReach(node, crossOffset, horizontal, isEntry) {
    const hm = node.mainSize / 2;
    const hc = node.crossSize / 2;
    const ratio = Math.min(0.95, Math.abs(crossOffset) / Math.max(1, hc));
    if (node.shape === 'diamond') {
        return hm * (1 - ratio);
    }
    if (node.shape === 'circle' || node.shape === 'doublecircle' || node.shape === 'state_start' || node.shape === 'state_end') {
        return hm * Math.sqrt(Math.max(0, 1 - ratio * ratio));
    }
    if (horizontal && node.shape === 'hexagon') {
        return hm - 14 * ratio;
    }
    if (horizontal && isEntry && node.shape === 'asymmetric') {
        return hm - 12 * (1 - ratio);
    }
    return hm;
}
function routeAllEdges(edges, nodeMeta, isBackEdge, edgeRoutingChain, minCross, maxCross, horizontal, flipMain) {
    // Group forward edges by exit and entry node to distribute ports evenly
    const outEdgesByNode = new Map();
    const inEdgesByNode = new Map();
    const pairGroups = new Map();
    edges.forEach((edge, index) => {
        if (isBackEdge[index])
            return;
        if (!outEdgesByNode.has(edge.from))
            outEdgesByNode.set(edge.from, []);
        if (!inEdgesByNode.has(edge.to))
            inEdgesByNode.set(edge.to, []);
        outEdgesByNode.get(edge.from).push(index);
        inEdgesByNode.get(edge.to).push(index);
        const pk = edge.from + '->' + edge.to;
        if (!pairGroups.has(pk))
            pairGroups.set(pk, []);
        pairGroups.get(pk).push(index);
    });
    // Sort outgoing/incoming edges by target/source cross position so ports don't cross immediately
    for (const list of outEdgesByNode.values()) {
        list.sort((a, b) => (nodeMeta.get(edges[a].to)?.cross ?? 0) - (nodeMeta.get(edges[b].to)?.cross ?? 0));
    }
    for (const list of inEdgesByNode.values()) {
        list.sort((a, b) => (nodeMeta.get(edges[a].from)?.cross ?? 0) - (nodeMeta.get(edges[b].from)?.cross ?? 0));
    }
    const graphCenterCross = (minCross + maxCross) / 2;
    let rightChannelIdx = 0;
    let leftChannelIdx = 0;
    const geometries = new Array(edges.length);
    edges.forEach((edge, index) => {
        const from = nodeMeta.get(edge.from);
        const to = nodeMeta.get(edge.to);
        if (edge.from === edge.to) {
            // Self-loop on +cross side
            const loopReach = 34;
            const cEdge = from.cross + from.crossSize / 2;
            const m1 = from.main - from.mainSize * 0.2;
            const m2 = from.main + from.mainSize * 0.2;
            const cCtrl = cEdge + loopReach;
            const lblDim = edge.label ? measureEdgeLabel(edge.label) : { width: 0, height: 0 };
            const labelCross = cEdge + loopReach * 0.78 + lblDim.width * 0.25;
            const labelMain = from.main;
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
            };
            return;
        }
        if (isBackEdge[index]) {
            // Route back-edge cleanly around the outer side channel
            const avgCross = (from.cross + to.cross) / 2;
            const useLeft = avgCross < graphCenterCross - 10;
            const channelIdx = useLeft ? leftChannelIdx++ : rightChannelIdx++;
            const channelGap = 28 + channelIdx * 24;
            let extremalCross = useLeft ? Infinity : -Infinity;
            const rLow = Math.min(from.rank, to.rank);
            const rHigh = Math.max(from.rank, to.rank);
            for (const node of nodeMeta.values()) {
                if (node.rank >= rLow && node.rank <= rHigh) {
                    if (useLeft)
                        extremalCross = Math.min(extremalCross, node.cross - node.crossSize / 2);
                    else
                        extremalCross = Math.max(extremalCross, node.cross + node.crossSize / 2);
                }
            }
            const laneCross = useLeft ? extremalCross - channelGap : extremalCross + channelGap;
            const exitCross = useLeft ? from.cross - from.crossSize / 2 : from.cross + from.crossSize / 2;
            const enterCross = useLeft ? to.cross - to.crossSize / 2 : to.cross + to.crossSize / 2;
            const exitMain = from.main;
            const enterMain = to.main;
            const midMain = (exitMain + enterMain) / 2;
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
            ];
            const lblDim = edge.label ? measureEdgeLabel(edge.label) : { width: 0, height: 0 };
            geometries[index] = {
                segments,
                labelMain: midMain,
                labelCross: laneCross,
                extents: [
                    { main: exitMain, cross: laneCross + (useLeft ? -lblDim.width / 2 : lblDim.width / 2) },
                    { main: enterMain, cross: laneCross + (useLeft ? -lblDim.width / 2 : lblDim.width / 2) },
                ],
            };
            return;
        }
        // Forward DAG edge (possibly multi-rank via dummy waypoints)
        const chain = edgeRoutingChain.get(index) ?? [edge.from, edge.to];
        const outList = outEdgesByNode.get(edge.from) ?? [index];
        const inList = inEdgesByNode.get(edge.to) ?? [index];
        const outIdx = outList.indexOf(index);
        const inIdx = inList.indexOf(index);
        const maxOutSpread = Math.min(from.crossSize * 0.42, (outList.length - 1) * 14);
        const maxInSpread = Math.min(to.crossSize * 0.42, (inList.length - 1) * 14);
        const outOffset = outList.length > 1 ? ((outIdx / (outList.length - 1)) - 0.5) * maxOutSpread : 0;
        const inOffset = inList.length > 1 ? ((inIdx / (inList.length - 1)) - 0.5) * maxInSpread : 0;
        // Parallel edge offset between identical (from, to)
        const pair = pairGroups.get(edge.from + '->' + edge.to) ?? [index];
        const pairOffset = pair.length > 1 ? ((pair.indexOf(index) / (pair.length - 1)) - 0.5) * 26 : 0;
        const pStart = {
            main: from.main + shapeMainReach(from, outOffset, horizontal, flipMain),
            cross: from.cross + outOffset,
        };
        const pEnd = {
            main: to.main - shapeMainReach(to, inOffset, horizontal, !flipMain),
            cross: to.cross + inOffset,
        };
        if (chain.length === 2) {
            const dm = Math.max(12, pEnd.main - pStart.main);
            const c1 = { main: pStart.main + dm * 0.5, cross: pStart.cross + pairOffset };
            const c2 = { main: pEnd.main - dm * 0.5, cross: pEnd.cross + pairOffset };
            const labelMain = 0.125 * pStart.main + 0.375 * c1.main + 0.375 * c2.main + 0.125 * pEnd.main;
            const labelCross = 0.125 * pStart.cross + 0.375 * c1.cross + 0.375 * c2.cross + 0.125 * pEnd.cross;
            geometries[index] = {
                segments: [
                    { type: 'M', pts: [pStart] },
                    { type: 'C', pts: [c1, c2, pEnd] },
                ],
                labelMain,
                labelCross,
                extents: [pStart, c1, c2, pEnd],
            };
            return;
        }
        // Multi-segment smooth spline through dummy waypoints
        const pts = [pStart];
        for (let k = 1; k < chain.length - 1; k += 1) {
            const d = nodeMeta.get(chain[k]);
            pts.push({ main: d.main, cross: d.cross + pairOffset });
        }
        pts.push(pEnd);
        const segments = [{ type: 'M', pts: [pts[0]] }];
        for (let k = 0; k < pts.length - 1; k += 1) {
            const a = pts[k];
            const b = pts[k + 1];
            const dm = Math.max(8, (b.main - a.main) * 0.5);
            segments.push({
                type: 'C',
                pts: [
                    { main: a.main + dm, cross: a.cross },
                    { main: b.main - dm, cross: b.cross },
                    b,
                ],
            });
        }
        const midIdx = Math.floor(pts.length / 2);
        const ma = pts[midIdx - 1];
        const mb = pts[midIdx];
        geometries[index] = {
            segments,
            labelMain: (ma.main + mb.main) / 2,
            labelCross: (ma.cross + mb.cross) / 2,
            extents: pts,
        };
    });
    // Stagger colliding edge labels gently if two labeled edges cross very close to each other
    const labeled = geometries
        .map((eg, i) => ({ eg, label: edges[i].label?.trim() ?? '' }))
        .filter(item => item.label !== '');
    for (let i = 0; i < labeled.length; i += 1) {
        for (let j = i + 1; j < labeled.length; j += 1) {
            const a = labeled[i].eg;
            const b = labeled[j].eg;
            if (Math.abs(a.labelMain - b.labelMain) < 20 && Math.abs(a.labelCross - b.labelCross) < 42) {
                a.labelMain -= 11;
                b.labelMain += 11;
            }
        }
    }
    return geometries;
}
function buildSvgPath(segments, toXY) {
    return segments.map(seg => {
        const coords = seg.pts.map(pt => {
            const xy = toXY(pt.main, pt.cross);
            return roundCoord(xy.x) + ' ' + roundCoord(xy.y);
        });
        return seg.type + ' ' + coords.join(', ');
    }).join(' ');
}
function roundCoord(n) {
    return Math.round(n * 10) / 10;
}
function computeSubgraphBoxes(subgraphs, nodes, nodeMeta, horizontal, padTop, padSide, padBottom) {
    if (!subgraphs || subgraphs.length === 0)
        return [];
    const boxMap = new Map();
    for (const node of nodes) {
        if (!node.subgraphId)
            continue;
        const meta = nodeMeta.get(node.id);
        if (!meta)
            continue;
        const mMin = meta.main - meta.mainSize / 2;
        const mMax = meta.main + meta.mainSize / 2;
        const cMin = meta.cross - meta.crossSize / 2;
        const cMax = meta.cross + meta.crossSize / 2;
        const cur = boxMap.get(node.subgraphId);
        if (cur === undefined) {
            boxMap.set(node.subgraphId, { mMin, mMax, cMin, cMax });
        }
        else {
            cur.mMin = Math.min(cur.mMin, mMin);
            cur.mMax = Math.max(cur.mMax, mMax);
            cur.cMin = Math.min(cur.cMin, cMin);
            cur.cMax = Math.max(cur.cMax, cMax);
        }
    }
    // Expand parent subgraphs to enclose nested child subgraphs
    for (let i = subgraphs.length - 1; i >= 0; i -= 1) {
        const sg = subgraphs[i];
        const box = boxMap.get(sg.id);
        if (!box)
            continue;
        if (sg.parentId) {
            const padMStart = horizontal ? padSide : padTop;
            const padMEnd = horizontal ? padSide : padBottom;
            const padCStart = horizontal ? padTop : padSide;
            const padCEnd = horizontal ? padBottom : padSide;
            const pBox = boxMap.get(sg.parentId);
            const childMMin = box.mMin - padMStart - 8;
            const childMMax = box.mMax + padMEnd + 8;
            const childCMin = box.cMin - padCStart - 8;
            const childCMax = box.cMax + padCEnd + 8;
            if (pBox === undefined) {
                boxMap.set(sg.parentId, { mMin: childMMin, mMax: childMMax, cMin: childCMin, cMax: childCMax });
            }
            else {
                pBox.mMin = Math.min(pBox.mMin, childMMin);
                pBox.mMax = Math.max(pBox.mMax, childMMax);
                pBox.cMin = Math.min(pBox.cMin, childCMin);
                pBox.cMax = Math.max(pBox.cMax, childCMax);
            }
        }
    }
    const result = [];
    for (const sg of subgraphs) {
        const box = boxMap.get(sg.id);
        if (!box)
            continue;
        result.push({
            id: sg.id,
            title: sg.title,
            mainMin: box.mMin - (horizontal ? padSide : padTop),
            mainMax: box.mMax + (horizontal ? padSide : padBottom),
            crossMin: box.cMin - (horizontal ? padTop : padSide),
            crossMax: box.cMax + (horizontal ? padBottom : padSide),
        });
    }
    return result;
}

const MAX_SEQ_PARTICIPANTS = 24;
const MAX_SEQ_EVENTS = 160;
const SEQ_UNSUPPORTED = /^(?:!include|!define|!pragma|@startmindmap|@startwbs|@startgantt|@startsalt|@startjson|@startyaml|newpage\b|\|\|\|)/iu;
/**
 * Parse a Mermaid sequenceDiagram or PlantUML sequence diagram.
 */
function parseSequenceDiagram(source) {
    if (typeof source !== 'string' || source.length > 20_000)
        return null;
    const rawLines = source.replace(/\r/g, '').replace(/%%\{[\s\S]*?\}%%/gu, '').split('\n');
    const participants = [];
    const byId = new Map();
    const events = [];
    const blockStack = [];
    let title = '';
    let autonumber = false;
    let msgCounter = 0;
    let hideFootbox = false;
    let inSkinparamBlock = false;
    let inMultiNote = null;
    let hasExplicitParticipant = false;
    let messageCount = 0;
    const ensureParticipant = (rawId, explicitKind = '', explicitLabel = '') => {
        const id = String(rawId ?? '').trim().replace(/^["']|["']$/g, '');
        if (!id || !/^[A-Za-z0-9_][\w.-]*$/u.test(id))
            return null;
        let p = byId.get(id);
        if (p === undefined) {
            if (participants.length >= MAX_SEQ_PARTICIPANTS)
                return null;
            p = {
                id,
                label: explicitLabel || id,
                kind: explicitKind || 'participant',
            };
            participants.push(p);
            byId.set(id, p);
        }
        else {
            if (explicitKind && p.kind === 'participant')
                p.kind = explicitKind;
            if (explicitLabel && p.label === p.id)
                p.label = explicitLabel;
        }
        return p;
    };
    for (const rawLine of rawLines) {
        let line = stripSeqComment(rawLine).trim();
        if (line === '')
            continue;
        if (SEQ_UNSUPPORTED.test(line))
            return null;
        if (inSkinparamBlock) {
            if (line.includes('}'))
                inSkinparamBlock = false;
            continue;
        }
        if (inMultiNote !== null) {
            if (/^end\s+note$/iu.test(line)) {
                if (events.length >= MAX_SEQ_EVENTS)
                    return null;
                events.push({
                    type: 'note',
                    placement: inMultiNote.placement,
                    targets: inMultiNote.targets,
                    text: inMultiNote.lines.join('\n'),
                });
                inMultiNote = null;
            }
            else {
                inMultiNote.lines.push(line);
            }
            continue;
        }
        if (/^(?:sequenceDiagram|@startuml(?:\s+.*)?|@enduml)$/iu.test(line))
            continue;
        if (/^hide\s+footbox$/iu.test(line)) {
            hideFootbox = true;
            continue;
        }
        if (/^skinparam\b/iu.test(line)) {
            if (line.includes('{') && !line.includes('}'))
                inSkinparamBlock = true;
            continue;
        }
        if (/^autonumber\b/iu.test(line)) {
            autonumber = true;
            continue;
        }
        const titleMatch = /^title\s*:?\s*(.+)$/iu.exec(line);
        if (titleMatch !== null) {
            title = cleanSeqText(titleMatch[1]);
            continue;
        }
        // Participant declarations (Mermaid & PlantUML styles)
        const partMatch = /^(participant|actor|database|boundary|control|entity|collections|queue)\s+(.+)$/iu.exec(line);
        if (partMatch !== null) {
            hasExplicitParticipant = true;
            const kind = partMatch[1].toLowerCase();
            const decl = parseParticipantDecl(partMatch[2]);
            if (decl === null || ensureParticipant(decl.id, kind, decl.label) === null)
                return null;
            continue;
        }
        // Activate / Deactivate / Destroy
        const actMatch = /^(activate|deactivate|destroy)\s+(.+)$/iu.exec(line);
        if (actMatch !== null) {
            const id = actMatch[2].trim().replace(/^["']|["']$/g, '');
            const p = ensureParticipant(id);
            if (p !== null && events.length < MAX_SEQ_EVENTS) {
                events.push({
                    type: actMatch[1].toLowerCase() === 'activate' ? 'activate' : 'deactivate',
                    target: p.id,
                });
            }
            continue;
        }
        // Divider: == Section ==
        const divMatch = /^==\s*(.+?)\s*==$/u.exec(line);
        if (divMatch !== null) {
            if (events.length >= MAX_SEQ_EVENTS)
                return null;
            events.push({ type: 'divider', text: cleanSeqText(divMatch[1]) });
            continue;
        }
        // Note: Note left/right of X: text | Note over X,Y: text | multi-line
        const noteMatch = /^note\s+(left\s+of|right\s+of|over)\s+([^:]+?)(?:\s*:\s*(.*))?$/iu.exec(line);
        if (noteMatch !== null) {
            const placement = noteMatch[1].toLowerCase().replace(/\s+/g, ' ');
            const targetIds = noteMatch[2].split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
            const targets = targetIds.map(id => ensureParticipant(id)).filter(Boolean).map(p => p.id);
            if (targets.length === 0)
                continue;
            if (noteMatch[3] !== undefined) {
                if (events.length >= MAX_SEQ_EVENTS)
                    return null;
                events.push({
                    type: 'note',
                    placement,
                    targets,
                    text: cleanSeqText(noteMatch[3]),
                });
            }
            else {
                inMultiNote = { placement, targets, lines: [] };
            }
            continue;
        }
        // Combined fragments: alt / opt / loop / par / critical / break / group
        const blockStart = /^(alt|opt|loop|par|critical|break|group)(?:\s+(.*))?$/iu.exec(line);
        if (blockStart !== null) {
            if (events.length >= MAX_SEQ_EVENTS)
                return null;
            const kind = blockStart[1].toLowerCase();
            const label = cleanSeqText(blockStart[2] ?? '');
            blockStack.push(kind);
            events.push({ type: 'block_start', kind, label });
            continue;
        }
        const blockElse = /^(else|and|option)(?:\s+(.*))?$/iu.exec(line);
        if (blockElse !== null && blockStack.length > 0) {
            if (events.length >= MAX_SEQ_EVENTS)
                return null;
            events.push({ type: 'block_else', kind: blockElse[1].toLowerCase(), label: cleanSeqText(blockElse[2] ?? '') });
            continue;
        }
        if (/^end$/iu.test(line) && blockStack.length > 0) {
            blockStack.pop();
            if (events.length >= MAX_SEQ_EVENTS)
                return null;
            events.push({ type: 'block_end' });
            continue;
        }
        // Ignore harmless box/create directives
        if (/^(?:box\b|end\s+box|create\b|link\b|links\b|properties\b)/iu.test(line))
            continue;
        // Messages: A ->> B: text  or  "Alice" -> "Bob" : text
        const msg = parseSequenceMessage(line);
        if (msg !== null) {
            const fromP = ensureParticipant(msg.from);
            const toP = ensureParticipant(msg.to);
            if (fromP === null || toP === null)
                return null;
            if (events.length >= MAX_SEQ_EVENTS)
                return null;
            msgCounter += 1;
            messageCount += 1;
            const label = autonumber ? (msg.text ? msgCounter + '. ' + msg.text : String(msgCounter)) : msg.text;
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
            });
            continue;
        }
        // Unrecognized PlantUML activity / state / unknown construct -> bail if not clearly sequence
        if (rawLine.trim().startsWith(':') || /^(?:start|stop|if\s*\(|while\s*\(|repeat|fork|class\s+|interface\s+|state\s+)/iu.test(line)) {
            return null;
        }
    }
    if (participants.length === 0 || (messageCount === 0 && !hasExplicitParticipant))
        return null;
    return { kind: 'sequence', title, hideFootbox, participants, events };
}
function stripSeqComment(line) {
    if (line.trim().startsWith('%%') || line.trim().startsWith("'"))
        return '';
    let quote = '';
    for (let i = 0; i < line.length; i += 1) {
        const ch = line[i];
        if (quote !== '') {
            if (ch === '\\') {
                i += 1;
                continue;
            }
            if (ch === quote)
                quote = '';
            continue;
        }
        if (ch === '"' || ch === "'") {
            quote = ch;
            continue;
        }
        if (ch === '%' && line[i + 1] === '%')
            return line.slice(0, i);
    }
    return line;
}
function parseParticipantDecl(raw) {
    const s = raw.trim();
    // "Label" as Id
    const qAs = /^"([^"]+)"\s+as\s+([A-Za-z0-9_][\w.-]*)$/iu.exec(s);
    if (qAs !== null)
        return { id: qAs[2], label: cleanSeqText(qAs[1]) };
    // Id as Label
    const idAs = /^([A-Za-z0-9_][\w.-]*)\s+as\s+(.+)$/iu.exec(s);
    if (idAs !== null)
        return { id: idAs[1], label: cleanSeqText(idAs[2]) };
    // "Name"
    const qOnly = /^"([^"]+)"$/u.exec(s);
    if (qOnly !== null) {
        const id = qOnly[1].replace(/\s+/g, '_');
        return { id, label: qOnly[1] };
    }
    // Id
    const idOnly = /^([A-Za-z0-9_][\w.-]*)$/u.exec(s);
    if (idOnly !== null)
        return { id: idOnly[1], label: idOnly[1] };
    return null;
}
function parseSequenceMessage(line) {
    // Normalize optional color tags inside PlantUML arrows e.g. -[#red]> -> ->
    const normalized = line.replace(/(<)?(-+)\[[^\]]+\](-+>?)/gu, '$1$2$3');
    const idPat = '"[^"]+"|[A-Za-z0-9_][\\w.]*(?:-[A-Za-z0-9_][\\w.]*)*';
    const re = new RegExp('^(' + idPat + ')\\s*(<-->>|<->>|<-->|<->|-->>|->>|-->|->|--x|-x|--\\)|-\\)|<-|<--)\\s*(\\+|-)?\\s*(' + idPat + ')(?:\\s*:\\s*(.*))?$', 'u');
    const m = re.exec(normalized);
    if (m === null)
        return null;
    let from = m[1].replace(/^"|"$/g, '');
    let arrow = m[2];
    const mod = m[3] ?? '';
    let to = m[4].replace(/^"|"$/g, '');
    const text = cleanSeqText(m[5] ?? '');
    // Reverse left-pointing PlantUML arrows like A <- B
    let bidirectional = false;
    if (arrow === '<-' || arrow === '<--') {
        const tmp = from;
        from = to;
        to = tmp;
        arrow = arrow === '<--' ? '-->' : '->';
    }
    else if (arrow.startsWith('<')) {
        bidirectional = true;
    }
    const dashed = arrow.includes('--');
    const arrowKind = arrow.endsWith('x') ? 'cross' : arrow.endsWith(')') ? 'open' : 'filled';
    return {
        from,
        to,
        dashed,
        arrowKind,
        bidirectional,
        activateTarget: mod === '+',
        deactivateSource: mod === '-',
        text,
    };
}
function cleanSeqText(value) {
    const s = String(value ?? '').trim();
    if (s.length >= 2 && ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'")))) {
        return s.slice(1, -1);
    }
    return s;
}
/**
 * Compute coordinates for a parsed sequence diagram.
 */
function layoutSequenceDiagram(seq) {
    if (seq === null || seq.participants.length === 0)
        return null;
    const margin = 28;
    const participants = seq.participants;
    const indexById = new Map(participants.map((p, i) => [p.id, i]));
    // 1. Measure participant header boxes
    const pMeta = participants.map((p, idx) => {
        const lines = wrapLabel(p.label, 140, 13);
        const textW = Math.max(...lines.map(l => measureTextWidth(l, 13)));
        const isActor = p.kind === 'actor';
        const isDb = p.kind === 'database';
        const width = clamp(textW + 32, isActor ? 76 : 92, 184);
        const height = isActor ? 44 + lines.length * 17 : Math.max(40, lines.length * 18 + (isDb ? 26 : 20));
        return { ...p, index: idx, lines, width, height };
    });
    // 2. Measure minimum adjacent column gaps based on boxes, direct messages, self-loops, and notes
    const pairGap = new Array(Math.max(0, pMeta.length - 1)).fill(0);
    for (let i = 0; i < pMeta.length - 1; i += 1) {
        pairGap[i] = pMeta[i].width / 2 + pMeta[i + 1].width / 2 + 34;
    }
    let extraRightTail = 0;
    let extraLeftHead = 0;
    for (const ev of seq.events) {
        if (ev.type === 'message') {
            const iFrom = indexById.get(ev.from);
            const iTo = indexById.get(ev.to);
            if (iFrom === undefined || iTo === undefined)
                continue;
            const msgLines = ev.label ? wrapLabel(ev.label, 220, 12) : [];
            const msgW = msgLines.length > 0 ? Math.max(...msgLines.map(l => measureTextWidth(l, 12))) : 0;
            if (iFrom === iTo) {
                const needed = 46 + msgW + 24;
                if (iFrom < pMeta.length - 1) {
                    pairGap[iFrom] = Math.max(pairGap[iFrom], needed + pMeta[iFrom + 1].width / 2 + 12);
                }
                else {
                    extraRightTail = Math.max(extraRightTail, needed);
                }
            }
            else if (Math.abs(iFrom - iTo) === 1) {
                const leftIdx = Math.min(iFrom, iTo);
                pairGap[leftIdx] = Math.max(pairGap[leftIdx], Math.min(280, msgW + 56));
            }
        }
        else if (ev.type === 'note') {
            const noteLines = wrapLabel(ev.text, 160, 12);
            const noteW = Math.max(64, ...noteLines.map(l => measureTextWidth(l, 12))) + 24;
            const tIdx = indexById.get(ev.targets[0]);
            if (tIdx === undefined)
                continue;
            if (ev.placement === 'right of') {
                if (tIdx < pMeta.length - 1) {
                    pairGap[tIdx] = Math.max(pairGap[tIdx], noteW + pMeta[tIdx + 1].width / 2 + 28);
                }
                else {
                    extraRightTail = Math.max(extraRightTail, noteW + 24);
                }
            }
            else if (ev.placement === 'left of') {
                if (tIdx > 0) {
                    pairGap[tIdx - 1] = Math.max(pairGap[tIdx - 1], noteW + pMeta[tIdx - 1].width / 2 + 28);
                }
                else {
                    extraLeftHead = Math.max(extraLeftHead, noteW + 24);
                }
            }
        }
    }
    // Assign X coordinates
    let xCursor = margin + Math.max(pMeta[0].width / 2, extraLeftHead);
    pMeta[0].x = xCursor;
    for (let i = 1; i < pMeta.length; i += 1) {
        xCursor += pairGap[i - 1];
        pMeta[i].x = xCursor;
    }
    const maxHeaderH = Math.max(...pMeta.map(p => p.height));
    const titleOffset = seq.title ? 34 : 0;
    const headerTopY = margin + titleOffset;
    const headerBottomY = headerTopY + maxHeaderH;
    let yCursor = headerBottomY + 26;
    // 3. Layout vertical events, activations, and combined fragments
    const positionedEvents = [];
    const activeStacks = new Map(pMeta.map(p => [p.id, []]));
    const activations = [];
    const fragmentStack = [];
    const fragments = [];
    const openActivation = (id, y) => {
        const stack = activeStacks.get(id);
        if (!stack)
            return;
        stack.push({ startY: y, depth: stack.length });
    };
    const closeActivation = (id, y) => {
        const stack = activeStacks.get(id);
        if (!stack || stack.length === 0)
            return;
        const item = stack.pop();
        activations.push({
            participantId: id,
            x: pMeta[indexById.get(id)].x + item.depth * 5,
            startY: item.startY,
            endY: Math.max(item.startY + 14, y),
        });
    };
    const touchFragmentParticipant = (id) => {
        const idx = indexById.get(id);
        if (idx === undefined)
            return;
        for (const frag of fragmentStack) {
            frag.minIdx = Math.min(frag.minIdx, idx);
            frag.maxIdx = Math.max(frag.maxIdx, idx);
        }
    };
    for (const ev of seq.events) {
        if (ev.type === 'activate') {
            openActivation(ev.target, yCursor - 10);
            continue;
        }
        if (ev.type === 'deactivate') {
            closeActivation(ev.target, yCursor - 10);
            continue;
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
            });
            yCursor += 30;
            continue;
        }
        if (ev.type === 'block_else') {
            const top = fragmentStack[fragmentStack.length - 1];
            if (top) {
                top.sections.push({ y: yCursor, label: ev.label });
                yCursor += 26;
            }
            continue;
        }
        if (ev.type === 'block_end') {
            const frag = fragmentStack.pop();
            if (frag) {
                if (frag.minIdx > frag.maxIdx) {
                    frag.minIdx = 0;
                    frag.maxIdx = pMeta.length - 1;
                }
                const pad = 28 + frag.depth * 8;
                const leftX = pMeta[frag.minIdx].x - Math.max(46, pMeta[frag.minIdx].width / 2) - 16 + frag.depth * 6;
                const rightX = pMeta[frag.maxIdx].x + Math.max(46, pMeta[frag.maxIdx].width / 2) + 16 - frag.depth * 6;
                fragments.push({
                    kind: frag.kind,
                    label: frag.label,
                    x: leftX,
                    y: frag.startY,
                    width: Math.max(120, rightX - leftX + pad * 0),
                    height: Math.max(44, yCursor - frag.startY + 8),
                    sections: frag.sections,
                });
                yCursor += 16;
            }
            continue;
        }
        if (ev.type === 'divider') {
            positionedEvents.push({ type: 'divider', y: yCursor + 10, text: ev.text });
            yCursor += 36;
            continue;
        }
        if (ev.type === 'note') {
            for (const t of ev.targets)
                touchFragmentParticipant(t);
            const lines = wrapLabel(ev.text, 160, 12);
            const textW = Math.max(52, ...lines.map(l => measureTextWidth(l, 12)));
            const noteW = textW + 22;
            const noteH = lines.length * 16 + 16;
            const firstX = pMeta[indexById.get(ev.targets[0])].x;
            const lastX = pMeta[indexById.get(ev.targets[ev.targets.length - 1])].x;
            let nx;
            if (ev.placement === 'left of')
                nx = firstX - noteW - 14;
            else if (ev.placement === 'right of')
                nx = firstX + 14;
            else
                nx = (firstX + lastX) / 2 - noteW / 2;
            positionedEvents.push({
                type: 'note',
                x: nx,
                y: yCursor,
                width: noteW,
                height: noteH,
                lines,
            });
            yCursor += noteH + 14;
            continue;
        }
        if (ev.type === 'message') {
            touchFragmentParticipant(ev.from);
            touchFragmentParticipant(ev.to);
            const x1 = pMeta[indexById.get(ev.from)].x;
            const x2 = pMeta[indexById.get(ev.to)].x;
            const isSelf = ev.from === ev.to;
            const lines = ev.label ? wrapLabel(ev.label, isSelf ? 180 : Math.max(120, Math.abs(x2 - x1) - 24), 12) : [];
            const labelW = lines.length > 0 ? Math.max(...lines.map(l => measureTextWidth(l, 12))) + 10 : 0;
            const textH = lines.length * 15;
            if (isSelf) {
                const yTop = yCursor + 8;
                const yBot = yTop + Math.max(24, textH + 8);
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
                });
                if (ev.activateTarget)
                    openActivation(ev.to, yTop);
                if (ev.deactivateSource)
                    closeActivation(ev.from, yBot);
                yCursor = yBot + 16;
            }
            else {
                const msgY = yCursor + textH + 10;
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
                });
                if (ev.activateTarget)
                    openActivation(ev.to, msgY);
                if (ev.deactivateSource)
                    closeActivation(ev.from, msgY);
                yCursor = msgY + 18;
            }
        }
    }
    // Close any unclosed fragments or activations cleanly
    while (fragmentStack.length > 0) {
        const frag = fragmentStack.pop();
        if (frag.minIdx > frag.maxIdx) {
            frag.minIdx = 0;
            frag.maxIdx = pMeta.length - 1;
        }
        const leftX = pMeta[frag.minIdx].x - Math.max(46, pMeta[frag.minIdx].width / 2) - 16;
        const rightX = pMeta[frag.maxIdx].x + Math.max(46, pMeta[frag.maxIdx].width / 2) + 16;
        fragments.push({
            kind: frag.kind,
            label: frag.label,
            x: leftX,
            y: frag.startY,
            width: Math.max(120, rightX - leftX),
            height: Math.max(44, yCursor - frag.startY + 8),
            sections: frag.sections,
        });
    }
    const lifelineBottomY = yCursor + 8;
    for (const [id, stack] of activeStacks.entries()) {
        while (stack.length > 0)
            closeActivation(id, lifelineBottomY - 6);
    }
    const showFootbox = !seq.hideFootbox && positionedEvents.filter(e => e.type === 'message').length >= 5;
    const bottomY = showFootbox ? lifelineBottomY + maxHeaderH + margin : lifelineBottomY + margin;
    let minX = pMeta[0].x - pMeta[0].width / 2;
    let maxX = pMeta[pMeta.length - 1].x + Math.max(pMeta[pMeta.length - 1].width / 2, extraRightTail);
    for (const frag of fragments) {
        minX = Math.min(minX, frag.x);
        maxX = Math.max(maxX, frag.x + frag.width);
    }
    for (const ev of positionedEvents) {
        if (ev.type === 'note') {
            minX = Math.min(minX, ev.x);
            maxX = Math.max(maxX, ev.x + ev.width);
        }
        else if (ev.type === 'message' && ev.isSelf) {
            maxX = Math.max(maxX, ev.x1 + 42 + ev.labelW);
        }
    }
    const shiftX = margin - minX;
    const width = Math.max(160, Math.ceil(maxX - minX + margin * 2));
    const height = Math.ceil(bottomY);
    for (const p of pMeta) {
        p.x += shiftX;
        p.y = headerTopY + (maxHeaderH - p.height) / 2;
    }
    for (const a of activations)
        a.x += shiftX;
    for (const f of fragments)
        f.x += shiftX;
    for (const ev of positionedEvents) {
        if (ev.type === 'note')
            ev.x += shiftX;
        else if (ev.type === 'message') {
            ev.x1 += shiftX;
            ev.x2 += shiftX;
        }
    }
    return {
        kind: 'sequence',
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
    };
}

/**
 * Parsers for UML Class, State, ER, and PlantUML Component/UseCase diagrams.
 * Each parser produces a graph object compatible with layoutFlowchart().
 */
const UML_UNSUPPORTED = /^(?:!include|!define|!pragma|!procedure|!function|@startmindmap|@startwbs|@startgantt|@startsalt|@startjson|@startyaml|@startditaa|repeat\b|while\s*\(|fork\b|\|[^|]+\||nwdiag\b|salt\b)/iu;
// ==================== Class Diagram (Mermaid + PlantUML) ====================
const UML_ID = '[A-Za-z0-9_][\\w.]*(?:-[A-Za-z0-9_][\\w.]*)*';
const CLASS_REL_RE = new RegExp('^(' + UML_ID + ')(?:\\s+"([^"]*)")?\\s+(<\\|--|<\\|\\.\\.|--\\|>|\\.\\.\\|>|\\*--|--\\*|o--|--o|<-->|<--|-->|--|\\.\\.>|\\.\\.<|\\.\\.)\\s+(?:"([^"]*)"\\s+)?(' + UML_ID + ')(?:\\s*:\\s*(.*))?$', 'u');
/**
 * Parse a Mermaid classDiagram or PlantUML class diagram.
 */
function parseClassDiagram(source) {
    if (typeof source !== 'string' || source.length > 20_000)
        return null;
    const rawLines = source.replace(/\r/g, '').replace(/%%\{[\s\S]*?\}%%/gu, '').split('\n');
    const nodes = [];
    const byId = new Map();
    const edges = [];
    const subgraphs = [];
    const sgStack = [];
    let direction = 'TD';
    let sgCounter = 0;
    let currentClass = null;
    let inSkipBlock = false;
    const ensureClassNode = (id, displayTitle = '', stereotype = '') => {
        const cleanId = String(id ?? '').trim();
        if (!cleanId || !/^[A-Za-z0-9_][\w.-]*$/u.test(cleanId))
            return null;
        let node = byId.get(cleanId);
        if (node === undefined) {
            if (nodes.length >= 80)
                return null;
            node = {
                id: cleanId,
                label: displayTitle || cleanId,
                shape: 'uml_class',
                subgraphId: sgStack.length > 0 ? sgStack[sgStack.length - 1] : null,
                sections: {
                    stereotype: stereotype || '',
                    title: displayTitle || cleanId,
                    attrs: [],
                    methods: [],
                },
            };
            nodes.push(node);
            byId.set(cleanId, node);
        }
        else {
            if (displayTitle && node.sections.title === node.id) {
                node.sections.title = displayTitle;
                node.label = displayTitle;
            }
            if (stereotype && !node.sections.stereotype) {
                node.sections.stereotype = stereotype;
            }
        }
        return node;
    };
    for (const rawLine of rawLines) {
        const line = stripUmlComment(rawLine).trim();
        if (line === '')
            continue;
        if (UML_UNSUPPORTED.test(line))
            return null;
        if (inSkipBlock) {
            if (line.includes('}'))
                inSkipBlock = false;
            continue;
        }
        if (/^(?:classDiagram|@startuml(?:\s+.*)?|@enduml|title\s+.*|hide\s+.*|show\s+.*)$/iu.test(line))
            continue;
        if (/^skinparam\b/iu.test(line)) {
            if (line.includes('{') && !line.includes('}'))
                inSkipBlock = true;
            continue;
        }
        const dirMatch = /^(?:direction|left\s+to\s+right\s+direction|top\s+to\s+bottom\s+direction)\s*(TD|TB|BT|LR|RL)?$/iu.exec(line);
        if (dirMatch !== null) {
            if (/left\s+to\s+right/iu.test(line))
                direction = 'LR';
            else if (/top\s+to\s+bottom/iu.test(line))
                direction = 'TD';
            else if (dirMatch[1]) {
                const up = dirMatch[1].toUpperCase();
                direction = up === 'LR' || up === 'RL' || up === 'BT' ? up : 'TD';
            }
            continue;
        }
        if (currentClass !== null) {
            if (line === '}') {
                currentClass = null;
                continue;
            }
            const stereoMatch = /^<<\s*([^>]+?)\s*>>$/u.exec(line);
            if (stereoMatch !== null) {
                currentClass.sections.stereotype = stereoMatch[1].trim();
            }
            else if (line.includes('(') && line.includes(')')) {
                currentClass.sections.methods.push(line);
            }
            else if (line !== '--' && line !== '==') {
                currentClass.sections.attrs.push(line);
            }
            continue;
        }
        // Namespace / package block
        const nsMatch = /^(?:namespace|package)\s+("[^"]+"|[A-Za-z0-9_][\w.-]*)(?:\s+as\s+([A-Za-z0-9_][\w.-]*))?\s*\{$/iu.exec(line);
        if (nsMatch !== null) {
            sgCounter += 1;
            const title = nsMatch[1].replace(/^"|"$/g, '');
            const id = nsMatch[2] || ('ns_' + sgCounter);
            subgraphs.push({ id, title, parentId: sgStack.length > 0 ? sgStack[sgStack.length - 1] : null });
            sgStack.push(id);
            continue;
        }
        if (line === '}') {
            if (sgStack.length > 0)
                sgStack.pop();
            continue;
        }
        // Class / interface / abstract class / enum declaration
        const clsMatch = /^(?:(abstract)\s+)?(class|interface|enum|struct)\s+([A-Za-z0-9_][\w.-]*)(?:\s*\[\s*"([^"]+)"\s*\])?(?:\s+as\s+"([^"]+)")?(?:\s*<<\s*([^>]+?)\s*>>)?(?:\s*\{)?$/iu.exec(line);
        if (clsMatch !== null) {
            const isAbstract = Boolean(clsMatch[1]);
            const kind = clsMatch[2].toLowerCase();
            const id = clsMatch[3];
            const title = clsMatch[4] || clsMatch[5] || id;
            const stereo = clsMatch[6] || (kind === 'interface' ? 'interface' : kind === 'enum' ? 'enumeration' : isAbstract ? 'abstract' : '');
            const node = ensureClassNode(id, title, stereo);
            if (node === null)
                return null;
            if (line.endsWith('{'))
                currentClass = node;
            continue;
        }
        // Inline member: ClassName : +member
        const inlineMatch = /^([A-Za-z0-9_][\w.-]*)\s*:\s*(.+)$/u.exec(line);
        if (inlineMatch !== null && !/[<>.*o-]{2}/.test(inlineMatch[1])) {
            const node = ensureClassNode(inlineMatch[1]);
            if (node === null)
                return null;
            const member = inlineMatch[2].trim();
            if (member.startsWith('<<') && member.endsWith('>>')) {
                node.sections.stereotype = member.slice(2, -2).trim();
            }
            else if (member.includes('(') && member.includes(')')) {
                node.sections.methods.push(member);
            }
            else {
                node.sections.attrs.push(member);
            }
            continue;
        }
        // Relationship
        const relMatch = CLASS_REL_RE.exec(line);
        if (relMatch !== null) {
            const leftId = relMatch[1];
            const leftCard = relMatch[2] ?? '';
            const op = relMatch[3];
            const rightCard = relMatch[4] ?? '';
            const rightId = relMatch[5];
            const rawLabel = (relMatch[6] ?? '').trim();
            const leftNode = ensureClassNode(leftId);
            const rightNode = ensureClassNode(rightId);
            if (leftNode === null || rightNode === null)
                return null;
            if (edges.length >= 160)
                return null;
            const parsedOp = decodeClassRelation(op, leftId, rightId);
            const cardPart = [leftCard, rightCard].filter(Boolean).join(' .. ');
            const label = rawLabel && cardPart ? `${rawLabel} (${cardPart})` : (rawLabel || cardPart);
            edges.push({
                from: parsedOp.from,
                to: parsedOp.to,
                label,
                style: parsedOp.dashed ? 'dashed' : 'normal',
                hasStartArrow: parsedOp.startMarker !== 'none',
                hasEndArrow: parsedOp.endMarker !== 'none',
                startMarker: parsedOp.startMarker,
                endMarker: parsedOp.endMarker,
            });
            continue;
        }
    }
    if (nodes.length === 0)
        return null;
    return { direction, nodes, edges, subgraphs };
}
function decodeClassRelation(op, left, right) {
    const dashed = op.includes('..');
    // Keep inheritance pointing from child -> parent so child sits below parent in TD layout,
    // OR preserve arrow direction with hollow_triangle marker on parent!
    switch (op) {
        case '<|--':
        case '<|..':
            // Parent <|-- Child : arrow points to Parent (left), Child (right) inherits Parent
            return { from: left, to: right, dashed, startMarker: 'hollow_triangle', endMarker: 'none' };
        case '--|>':
        case '..|>':
            return { from: left, to: right, dashed, startMarker: 'none', endMarker: 'hollow_triangle' };
        case '*--':
            return { from: left, to: right, dashed: false, startMarker: 'filled_diamond', endMarker: 'none' };
        case '--*':
            return { from: left, to: right, dashed: false, startMarker: 'none', endMarker: 'filled_diamond' };
        case 'o--':
            return { from: left, to: right, dashed: false, startMarker: 'hollow_diamond', endMarker: 'none' };
        case '--o':
            return { from: left, to: right, dashed: false, startMarker: 'none', endMarker: 'hollow_diamond' };
        case '<--':
        case '..<':
            return { from: left, to: right, dashed, startMarker: 'arrow', endMarker: 'none' };
        case '<-->':
            return { from: left, to: right, dashed: false, startMarker: 'arrow', endMarker: 'arrow' };
        case '--':
        case '..':
            return { from: left, to: right, dashed, startMarker: 'none', endMarker: 'none' };
        default:
            return { from: left, to: right, dashed, startMarker: 'none', endMarker: 'arrow' };
    }
}
// ==================== State Diagram (Mermaid) ====================
/**
 * Parse a Mermaid stateDiagram / stateDiagram-v2 document.
 */
function parseStateDiagram(source) {
    if (typeof source !== 'string' || source.length > 20_000)
        return null;
    const rawLines = source.replace(/\r/g, '').replace(/%%\{[\s\S]*?\}%%/gu, '').split('\n');
    const nodes = [];
    const byId = new Map();
    const edges = [];
    const subgraphs = [];
    const sgStack = [];
    let direction = 'TD';
    let startCount = 0;
    let endCount = 0;
    let inNote = false;
    const ensureStateNode = (id, label = '', shape = 'rounded') => {
        let node = byId.get(id);
        if (node === undefined) {
            if (nodes.length >= 80)
                return null;
            node = {
                id,
                label: label || id,
                shape: shape || 'rounded',
                subgraphId: sgStack.length > 0 ? sgStack[sgStack.length - 1] : null,
            };
            nodes.push(node);
            byId.set(id, node);
        }
        else {
            if (label && node.label === node.id)
                node.label = label;
            if (shape && node.shape === 'rounded')
                node.shape = shape;
        }
        return node;
    };
    for (const rawLine of rawLines) {
        const line = stripUmlComment(rawLine).trim();
        if (line === '')
            continue;
        if (inNote) {
            if (/^end\s+note$/iu.test(line))
                inNote = false;
            continue;
        }
        if (/^(?:stateDiagram(?:-v2)?|@startuml(?:\s+.*)?|@enduml|title\s+.*|hide\s+.*)$/iu.test(line))
            continue;
        if (/^skinparam\b/iu.test(line))
            continue;
        if (/^note\b/iu.test(line)) {
            if (!line.includes(':'))
                inNote = true;
            continue;
        }
        const dirMatch = /^direction\s+(TD|TB|BT|LR|RL)$/iu.exec(line);
        if (dirMatch !== null) {
            const up = dirMatch[1].toUpperCase();
            direction = up === 'LR' || up === 'RL' || up === 'BT' ? up : 'TD';
            continue;
        }
        // Composite state { ... }
        const compMatch = /^state\s+(?:"([^"]+)"\s+as\s+)?([A-Za-z0-9_][\w-]*)\s*\{$/iu.exec(line);
        if (compMatch !== null) {
            const id = compMatch[2];
            const title = compMatch[1] || id;
            subgraphs.push({ id, title, parentId: sgStack.length > 0 ? sgStack[sgStack.length - 1] : null });
            sgStack.push(id);
            continue;
        }
        if (line === '}') {
            if (sgStack.length > 0)
                sgStack.pop();
            continue;
        }
        // Stereotyped state: state id <<choice>> | <<fork>> | <<join>>
        const stereoState = /^state\s+([A-Za-z0-9_][\w-]*)\s+<<\s*(choice|fork|join)\s*>>$/iu.exec(line);
        if (stereoState !== null) {
            const kind = stereoState[2].toLowerCase();
            const shape = kind === 'choice' ? 'diamond' : 'state_bar';
            if (ensureStateNode(stereoState[1], '', shape) === null)
                return null;
            continue;
        }
        // state "Description" as S1
        const aliasState = /^state\s+"([^"]+)"\s+as\s+([A-Za-z0-9_][\w-]*)$/iu.exec(line);
        if (aliasState !== null) {
            if (ensureStateNode(aliasState[2], aliasState[1], 'rounded') === null)
                return null;
            continue;
        }
        // Transition: A --> B : label
        const trans = /^(\[\*\]|[A-Za-z0-9_][\w-]*)\s*(-->|->)\s*(\[\*\]|[A-Za-z0-9_][\w-]*)(?:\s*:\s*(.*))?$/u.exec(line);
        if (trans !== null) {
            const rawFrom = trans[1];
            const rawTo = trans[3];
            const label = (trans[4] ?? '').trim();
            let fromId = rawFrom;
            if (rawFrom === '[*]') {
                startCount += 1;
                fromId = '__state_start_' + startCount;
                if (ensureStateNode(fromId, ' ', 'state_start') === null)
                    return null;
            }
            else if (ensureStateNode(fromId) === null)
                return null;
            let toId = rawTo;
            if (rawTo === '[*]') {
                endCount += 1;
                toId = '__state_end_' + endCount;
                if (ensureStateNode(toId, ' ', 'state_end') === null)
                    return null;
            }
            else if (ensureStateNode(toId) === null)
                return null;
            if (edges.length >= 160)
                return null;
            edges.push({
                from: fromId,
                to: toId,
                label,
                style: 'normal',
                hasStartArrow: false,
                hasEndArrow: true,
            });
            continue;
        }
        // State description: S1 : Description
        const descMatch = /^([A-Za-z0-9_][\w-]*)\s*:\s*(.+)$/u.exec(line);
        if (descMatch !== null) {
            if (ensureStateNode(descMatch[1], descMatch[2].trim(), 'rounded') === null)
                return null;
            continue;
        }
    }
    if (nodes.length === 0)
        return null;
    return { direction, nodes, edges, subgraphs };
}
// ==================== ER Diagram (Mermaid) ====================
const ER_CARD = '(?:\\|\\||\\|o|o\\||\\}\\||\\|\\{|\\}o|o\\{)';
const ER_REL_RE = new RegExp('^([A-Za-z0-9_][\\w-]*)\\s+(' + ER_CARD + ')(\\.\\.|--)(' + ER_CARD + ')\\s+([A-Za-z0-9_][\\w-]*)\\s*:\\s*(.+)$', 'u');
/**
 * Parse a Mermaid erDiagram document.
 */
function parseErDiagram(source) {
    if (typeof source !== 'string' || source.length > 20_000)
        return null;
    const rawLines = source.replace(/\r/g, '').replace(/%%\{[\s\S]*?\}%%/gu, '').split('\n');
    const nodes = [];
    const byId = new Map();
    const edges = [];
    let direction = 'TD';
    let currentEntity = null;
    const ensureEntity = (id) => {
        let node = byId.get(id);
        if (node === undefined) {
            if (nodes.length >= 80)
                return null;
            node = {
                id,
                label: id,
                shape: 'uml_class',
                subgraphId: null,
                sections: { stereotype: '', title: id, attrs: [], methods: [] },
            };
            nodes.push(node);
            byId.set(id, node);
        }
        return node;
    };
    for (const rawLine of rawLines) {
        const line = stripUmlComment(rawLine).trim();
        if (line === '')
            continue;
        if (/^erDiagram$/iu.test(line))
            continue;
        const dirMatch = /^direction\s+(TD|TB|BT|LR|RL)$/iu.exec(line);
        if (dirMatch !== null) {
            const up = dirMatch[1].toUpperCase();
            direction = up === 'LR' || up === 'RL' || up === 'BT' ? up : 'TD';
            continue;
        }
        if (currentEntity !== null) {
            if (line === '}') {
                currentEntity = null;
                continue;
            }
            currentEntity.sections.attrs.push(line.replace(/\s+"[^"]*"\s*$/u, ''));
            continue;
        }
        const blockMatch = /^([A-Za-z0-9_][\w-]*)\s*\{$/u.exec(line);
        if (blockMatch !== null) {
            const node = ensureEntity(blockMatch[1]);
            if (node === null)
                return null;
            currentEntity = node;
            continue;
        }
        const rel = ER_REL_RE.exec(line);
        if (rel !== null) {
            const left = ensureEntity(rel[1]);
            const right = ensureEntity(rel[5]);
            if (left === null || right === null)
                return null;
            if (edges.length >= 160)
                return null;
            const leftC = formatErCard(rel[2]);
            const rightC = formatErCard(rel[4]);
            const rawLabel = rel[6].trim().replace(/^"|"$/g, '');
            edges.push({
                from: left.id,
                to: right.id,
                label: `${leftC} ${rawLabel} ${rightC}`.trim(),
                style: rel[3] === '..' ? 'dashed' : 'normal',
                hasStartArrow: false,
                hasEndArrow: false,
                startMarker: 'none',
                endMarker: 'none',
            });
        }
    }
    if (nodes.length === 0)
        return null;
    return { direction, nodes, edges, subgraphs: [] };
}
function formatErCard(sym) {
    if (sym === '||')
        return '1';
    if (sym === '|o' || sym === 'o|')
        return '0..1';
    if (sym === '}|' || sym === '|{')
        return '1..*';
    return '0..*';
}
// ==================== PlantUML Component / UseCase / Deployment ====================
/**
 * Parse a PlantUML Component / UseCase / Deployment graph.
 * Returns null for unsupported activity/swimlane/complex syntax so it falls back cleanly.
 */
function parsePlantUmlGraph(source) {
    if (typeof source !== 'string' || source.length > 20_000)
        return null;
    const rawLines = source.replace(/\r/g, '').split('\n');
    const nodes = [];
    const byId = new Map();
    const edges = [];
    const subgraphs = [];
    const sgStack = [];
    let direction = 'TD';
    let sgCounter = 0;
    let inSkipBlock = false;
    const ensureNode = (id, label, shape) => {
        const cleanId = String(id ?? '').trim();
        if (!cleanId || !/^[A-Za-z0-9_][\w.-]*$/u.test(cleanId))
            return null;
        let node = byId.get(cleanId);
        if (node === undefined) {
            if (nodes.length >= 80)
                return null;
            node = {
                id: cleanId,
                label: label || cleanId,
                shape: shape || 'rect',
                subgraphId: sgStack.length > 0 ? sgStack[sgStack.length - 1] : null,
            };
            nodes.push(node);
            byId.set(cleanId, node);
        }
        else {
            if (label && node.label === node.id)
                node.label = label;
            if (shape && node.shape === 'rect')
                node.shape = shape;
        }
        return node;
    };
    for (const rawLine of rawLines) {
        const line = stripUmlComment(rawLine).trim();
        if (line === '')
            continue;
        if (UML_UNSUPPORTED.test(line))
            return null;
        if (line.startsWith(':') && line.endsWith(';'))
            return null;
        if (/^(?:start|stop|end|if\s*\(|elseif\s*\(|else\b|endif\b)/iu.test(line))
            return null;
        if (inSkipBlock) {
            if (line.includes('}'))
                inSkipBlock = false;
            continue;
        }
        if (/^(?:@startuml(?:\s+.*)?|@enduml|title\s+.*|hide\s+.*)$/iu.test(line))
            continue;
        if (/^skinparam\b/iu.test(line)) {
            if (line.includes('{') && !line.includes('}'))
                inSkipBlock = true;
            continue;
        }
        if (/^left\s+to\s+right\s+direction$/iu.test(line)) {
            direction = 'LR';
            continue;
        }
        if (/^top\s+to\s+bottom\s+direction$/iu.test(line)) {
            direction = 'TD';
            continue;
        }
        // Container block: package / node / folder / frame / cloud / rectangle ... {
        const pkgMatch = /^(?:package|node|folder|frame|cloud|rectangle|database|together)\s+("[^"]+"|\[[^\]]+\]|[A-Za-z0-9_][\w.-]*)(?:\s+as\s+([A-Za-z0-9_][\w.-]*))?\s*\{$/iu.exec(line);
        if (pkgMatch !== null) {
            sgCounter += 1;
            const title = pkgMatch[1].replace(/^["\[]|["\]]$/g, '');
            const id = pkgMatch[2] || ('pkg_' + sgCounter);
            subgraphs.push({ id, title, parentId: sgStack.length > 0 ? sgStack[sgStack.length - 1] : null });
            sgStack.push(id);
            continue;
        }
        if (line === '}') {
            if (sgStack.length > 0)
                sgStack.pop();
            continue;
        }
        // Component [Label] as Id | (UseCase) as Id | actor/database/queue/node/component/usecase
        const compDecl = /^(\[[^\]]+\]|\([^)]+\))\s*(?:as\s+([A-Za-z0-9_][\w.-]*))?$/iu.exec(line);
        if (compDecl !== null) {
            const raw = compDecl[1];
            const isUseCase = raw.startsWith('(');
            const label = raw.slice(1, -1).trim();
            const id = compDecl[2] || makeSafePlantId(label);
            if (ensureNode(id, label, isUseCase ? 'stadium' : 'rect') === null)
                return null;
            continue;
        }
        const kwDecl = /^(actor|database|queue|component|usecase|rectangle|cloud|node|storage|artifact|interface)\s+("[^"]+"|\[[^\]]+\]|\([^)]+\)|[A-Za-z0-9_][\w.-]*)(?:\s+as\s+([A-Za-z0-9_][\w.-]*))?$/iu.exec(line);
        if (kwDecl !== null) {
            const kw = kwDecl[1].toLowerCase();
            const rawLabel = kwDecl[2].replace(/^["\[\(]|["\]\)]$/g, '').trim();
            const id = kwDecl[3] || makeSafePlantId(rawLabel);
            const shape = kw === 'actor' ? 'actor'
                : kw === 'database' ? 'cylinder'
                    : kw === 'usecase' ? 'stadium'
                        : kw === 'interface' ? 'circle'
                            : kw === 'queue' ? 'subroutine'
                                : 'rect';
            if (ensureNode(id, rawLabel, shape) === null)
                return null;
            continue;
        }
        // Link: [A] --> [B] : label  or  A ..> B : label  or  (UC1) --> (UC2)
        const linkMatch = /^(\[[^\]]+\]|\([^)]+\)|[A-Za-z0-9_][\w.-]*)\s*(<-->|<--|-->|<-|->|<\.\.|\.\.>|-\.->|==>|---|--|\.\.)\s*(\[[^\]]+\]|\([^)]+\)|[A-Za-z0-9_][\w.-]*)(?:\s*:\s*(.*))?$/u.exec(line);
        if (linkMatch !== null) {
            const fromMeta = decodePlantEndpoint(linkMatch[1]);
            const op = linkMatch[2];
            const toMeta = decodePlantEndpoint(linkMatch[3]);
            const label = (linkMatch[4] ?? '').trim();
            const fromNode = ensureNode(fromMeta.id, fromMeta.label, fromMeta.shape);
            const toNode = ensureNode(toMeta.id, toMeta.label, toMeta.shape);
            if (fromNode === null || toNode === null)
                return null;
            if (edges.length >= 160)
                return null;
            const dashed = op.includes('..') || op.includes('-.');
            const thick = op.includes('==');
            const hasStart = op.startsWith('<');
            const hasEnd = op.endsWith('>');
            edges.push({
                from: fromNode.id,
                to: toNode.id,
                label,
                style: dashed ? 'dashed' : thick ? 'thick' : 'normal',
                hasStartArrow: hasStart,
                hasEndArrow: hasEnd,
            });
            continue;
        }
    }
    if (nodes.length === 0 || (edges.length === 0 && nodes.length < 2))
        return null;
    return { direction, nodes, edges, subgraphs };
}
function decodePlantEndpoint(token) {
    const t = token.trim();
    if (t.startsWith('[') && t.endsWith(']')) {
        const label = t.slice(1, -1).trim();
        return { id: makeSafePlantId(label), label, shape: 'rect' };
    }
    if (t.startsWith('(') && t.endsWith(')')) {
        const label = t.slice(1, -1).trim();
        return { id: makeSafePlantId(label), label, shape: 'stadium' };
    }
    return { id: t, label: t, shape: 'rect' };
}
function makeSafePlantId(label) {
    const ascii = label.replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
    if (ascii && /^[A-Za-z0-9_]/u.test(ascii))
        return ascii;
    let hash = 0;
    for (const ch of label)
        hash = ((hash << 5) - hash + (ch.codePointAt(0) ?? 0)) | 0;
    return 'p_' + Math.abs(hash).toString(36);
}
function stripUmlComment(line) {
    const trimmed = line.trim();
    if (trimmed.startsWith('%%') || trimmed.startsWith("'"))
        return '';
    let quote = '';
    for (let i = 0; i < line.length; i += 1) {
        const ch = line[i];
        if (quote !== '') {
            if (ch === '\\') {
                i += 1;
                continue;
            }
            if (ch === quote)
                quote = '';
            continue;
        }
        if (ch === '"' || ch === "'") {
            quote = ch;
            continue;
        }
        if (ch === '%' && line[i + 1] === '%')
            return line.slice(0, i);
    }
    return line;
}

const SUPPORTED_FENCE_LANGUAGES = ['flowchart', 'graph', 'mermaid', 'plantuml', 'puml', 'uml'];
/**
 * Parse and lay out a supported diagram fence into a renderable model.
 * Returns null when the source is unsupported, invalid, or too complex so the
 * caller falls back to the stock code block.
 * @param {string} lang
 * @param {string} source
 * @returns {object | null}
 */
function parseAndLayoutDiagram(lang, source) {
    if (typeof source !== 'string' || source.length === 0 || source.length > 20_000)
        return null;
    const normLang = String(lang ?? '').trim().toLowerCase();
    const lines = source.replace(/\r/g, '').split('\n');
    let firstLine = '';
    for (const raw of lines) {
        const t = raw.trim();
        if (t === '' || t.startsWith('%%') || t.startsWith("'"))
            continue;
        firstLine = t;
        break;
    }
    if (firstLine === '')
        return null;
    // Immediately bail on preprocessor macros or unsupported diagram types
    if (/^@(?:startmindmap|startwbs|startgantt|startsalt|startjson|startyaml|startditaa|startebnf|startregex)\b/iu.test(firstLine)) {
        return null;
    }
    if (/^\s*!(?:include|define|pragma|procedure|function)\b/imu.test(source)) {
        return null;
    }
    const isPlantUml = normLang === 'plantuml' || normLang === 'puml' || normLang === 'uml' || /^@startuml\b/iu.test(firstLine);
    if (isPlantUml) {
        return dispatchPlantUml(source, lines);
    }
    if (/^sequenceDiagram\b/iu.test(firstLine)) {
        return layoutSequenceDiagram(parseSequenceDiagram(source));
    }
    if (/^classDiagram\b/iu.test(firstLine)) {
        return layoutFlowchart(parseClassDiagram(source));
    }
    if (/^stateDiagram(?:-v2)?\b/iu.test(firstLine)) {
        return layoutFlowchart(parseStateDiagram(source));
    }
    if (/^erDiagram\b/iu.test(firstLine)) {
        return layoutFlowchart(parseErDiagram(source));
    }
    return layoutFlowchart(parseFlowchart(source));
}
function dispatchPlantUml(source, lines) {
    // Reject PlantUML activity / swimlane / unsupported DSLs cleanly
    for (const raw of lines) {
        const t = raw.trim();
        if (t.startsWith(':') && t.endsWith(';'))
            return null;
        if (/^(?:start|stop|if\s*\(|elseif\s*\(|endif\b|repeat\b|while\s*\(|fork\b|\|[^|]+\||nwdiag\b|salt\b)/iu.test(t)) {
            return null;
        }
    }
    const body = lines.map(l => l.trim()).filter(l => l !== '' && !l.startsWith("'"));
    const hasClassSyntax = body.some(l => /^(?:(?:abstract\s+)?class|interface|enum|struct)\s+/iu.test(l) ||
        /(?:<\|--|<\|\.\.|--\|>|\.\.\|>|\*--|--\*|o--|--o)/.test(l));
    if (hasClassSyntax) {
        return layoutFlowchart(parseClassDiagram(source));
    }
    const hasStateStartEnd = body.some(l => /\[\*\]\s*(?:-->|->)|(?:-->|->)\s*\[\*\]/.test(l));
    if (hasStateStartEnd) {
        return layoutFlowchart(parseStateDiagram(source));
    }
    const hasComponentSyntax = body.some(l => /^(?:component|usecase|package|node|folder|frame|cloud|storage|artifact)\s+/iu.test(l) ||
        /\[[^\]]+\]\s*(?:as\b|<--|-->|\.\.>|<\.\.|---)/.test(l) ||
        /\([^)]+\)\s*(?:as\b|<--|-->|\.\.>|<\.\.|---)/.test(l));
    if (hasComponentSyntax) {
        return layoutFlowchart(parsePlantUmlGraph(source));
    }
    const hasSequenceSyntax = body.some(l => /^(?:participant|autonumber|activate|deactivate|alt|opt|loop)\b/iu.test(l) ||
        /^(?:"[^"]+"|[A-Za-z0-9_][\w.-]*)\s*(?:<-->>|<->>|<-->|<->|-->>|->>|-->|->|<-|<--)\s*(?:"[^"]+"|[A-Za-z0-9_][\w.-]*)\s*:/.test(l));
    if (hasSequenceSyntax) {
        return layoutSequenceDiagram(parseSequenceDiagram(source));
    }
    return layoutFlowchart(parsePlantUmlGraph(source));
}
        const FLOWCHART_ID = '@local/dsh-markdown-flowchart/fence';
        const FLOWCHART_NS = 'markdownFlowchart';
        const FLOWCHART_LANGUAGES = SUPPORTED_FENCE_LANGUAGES;
        const flowchartZh = {
            'diagram.flowchart': '流程图',
            'diagram.mermaid': 'Mermaid 图表',
            'diagram.plantuml': 'PlantUML 图表',
            'diagram.sequence': '时序图',
        };
        const flowchartEn = {
            'diagram.flowchart': 'Flowchart',
            'diagram.mermaid': 'Mermaid diagram',
            'diagram.plantuml': 'PlantUML diagram',
            'diagram.sequence': 'Sequence diagram',
        };
        /** Render a settled diagram fence, preserving the stock code block while streaming or on parse/layout fallback. */
        function FlowchartFence({ lang, code, streaming, children, t }) {
            const markerBase = 'dsh-fc-' + React.useId().replace(/[^A-Za-z0-9_-]/g, '');
            const diagram = React.useMemo(() => {
                if (streaming)
                    return null;
                try {
                    return parseAndLayoutDiagram(lang, code);
                }
                catch (_error) {
                    return null;
                }
            }, [lang, code, streaming]);
            if (diagram === null)
                return children;
            const labelKey = diagram.kind === 'sequence'
                ? 'diagram.sequence'
                : (lang === 'plantuml' || lang === 'puml' || lang === 'uml')
                    ? 'diagram.plantuml'
                    : lang === 'mermaid'
                        ? 'diagram.mermaid'
                        : 'diagram.flowchart';
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
                : renderGraphSvg(diagram, markerBase));
        }
        function svgStyleForWidth(width) {
            return {
                display: 'block',
                margin: '0 auto',
                maxWidth: '100%',
                minWidth: Math.min(width, Math.round(width * 0.72)) + 'px',
                height: 'auto',
            };
        }
        // ==================== Sequence Diagram SVG Renderer ====================
        function renderSequenceSvg(seq, markerBase) {
            const filledArrowId = markerBase + '-seq-filled';
            const openArrowId = markerBase + '-seq-open';
            const crossEndId = markerBase + '-seq-cross';
            return h('svg', {
                viewBox: '0 0 ' + seq.width + ' ' + seq.height,
                width: seq.width,
                height: seq.height,
                role: 'presentation',
                style: svgStyleForWidth(seq.width),
            }, h('defs', null, h('marker', {
                id: filledArrowId,
                markerWidth: 9,
                markerHeight: 8,
                refX: 8,
                refY: 4,
                orient: 'auto-start-reverse',
                markerUnits: 'userSpaceOnUse',
            }, h('path', { d: 'M0,1 L9,4 L0,7 L2.2,4 z', fill: 'var(--dsw-alias-link)' })), h('marker', {
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
            })), h('marker', {
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
            }))), seq.title ? h('text', {
                x: seq.width / 2,
                y: 24,
                textAnchor: 'middle',
                fontSize: 14,
                fontWeight: 600,
                fill: 'var(--dsw-alias-label-primary)',
            }, seq.title) : null, seq.fragments.map((frag, idx) => renderSeqFragment(frag, idx)), seq.participants.map(p => h('line', {
                key: 'lifeline:' + p.id,
                x1: p.x,
                y1: seq.headerBottomY,
                x2: p.x,
                y2: seq.lifelineBottomY,
                stroke: 'var(--dsw-alias-border-l3)',
                strokeWidth: 1.25,
                strokeDasharray: '5 4',
            })), seq.activations.map((act, idx) => h('rect', {
                key: 'act:' + idx,
                x: act.x - 5,
                y: act.startY,
                width: 10,
                height: act.endY - act.startY,
                rx: 3,
                fill: 'color-mix(in srgb, var(--dsw-alias-link) 18%, var(--dsw-alias-bg-layer-1))',
                stroke: 'var(--dsw-alias-link)',
                strokeWidth: 1.25,
            })), seq.participants.map(p => renderSeqParticipant(p, p.y, 'top')), seq.showFootbox
                ? seq.participants.map(p => renderSeqParticipant(p, seq.lifelineBottomY + (seq.maxHeaderH - p.height) / 2, 'bot'))
                : null, seq.events.map((ev, idx) => renderSeqEvent(ev, seq.width, filledArrowId, openArrowId, crossEndId, idx)));
        }
        function renderSeqParticipant(p, topY, pos) {
            const cx = p.x;
            const w = p.width;
            const ht = p.height;
            const x = cx - w / 2;
            if (p.kind === 'actor') {
                const lineH = 17;
                const textStartY = topY + 42;
                return h('g', { key: 'p-' + pos + ':' + p.id }, renderActorIcon(cx, topY + 20, 'var(--dsw-alias-link)'), h('text', {
                    x: cx,
                    y: textStartY,
                    textAnchor: 'middle',
                    dominantBaseline: 'central',
                    fontSize: 13,
                    fontWeight: 500,
                    fill: 'var(--dsw-alias-label-primary)',
                }, p.lines.map((l, i) => h('tspan', { key: i, x: cx, dy: i === 0 ? 0 : lineH }, l))));
            }
            if (p.kind === 'database') {
                const ry = 6;
                const rx = w / 2;
                const bodyPath = 'M ' + x + ' ' + (topY + ry) +
                    ' L ' + x + ' ' + (topY + ht - ry) +
                    ' A ' + rx + ' ' + ry + ' 0 0 0 ' + (x + w) + ' ' + (topY + ht - ry) +
                    ' L ' + (x + w) + ' ' + (topY + ry) + ' Z';
                const lineH = 17;
                const textStartY = topY + ht / 2 + 3 - ((p.lines.length - 1) * lineH) / 2;
                return h('g', { key: 'p-' + pos + ':' + p.id }, h('path', { d: bodyPath, fill: 'var(--dsw-alias-bg-layer-1)', stroke: 'var(--dsw-alias-border-l3)', strokeWidth: 1.5 }), h('ellipse', { cx, cy: topY + ry, rx, ry, fill: 'var(--dsw-alias-bg-layer-1)', stroke: 'var(--dsw-alias-border-l3)', strokeWidth: 1.5 }), h('text', {
                    x: cx,
                    y: textStartY,
                    textAnchor: 'middle',
                    dominantBaseline: 'central',
                    fontSize: 13,
                    fontWeight: 500,
                    fill: 'var(--dsw-alias-label-primary)',
                }, p.lines.map((l, i) => h('tspan', { key: i, x: cx, dy: i === 0 ? 0 : lineH }, l))));
            }
            const lineH = 18;
            const textStartY = topY + ht / 2 - ((p.lines.length - 1) * lineH) / 2;
            return h('g', { key: 'p-' + pos + ':' + p.id }, h('rect', {
                x,
                y: topY,
                width: w,
                height: ht,
                rx: 8,
                fill: 'var(--dsw-alias-bg-layer-1)',
                stroke: 'var(--dsw-alias-border-l3)',
                strokeWidth: 1.5,
            }), h('text', {
                x: cx,
                y: textStartY,
                textAnchor: 'middle',
                dominantBaseline: 'central',
                fontSize: 13,
                fontWeight: 500,
                fill: 'var(--dsw-alias-label-primary)',
            }, p.lines.map((l, i) => h('tspan', { key: i, x: cx, dy: i === 0 ? 0 : lineH }, l))));
        }
        function renderSeqFragment(frag, key) {
            const badgeW = Math.max(42, frag.kind.length * 8 + 18);
            const badgePath = 'M ' + frag.x + ' ' + frag.y +
                ' L ' + (frag.x + badgeW) + ' ' + frag.y +
                ' L ' + (frag.x + badgeW) + ' ' + (frag.y + 15) +
                ' L ' + (frag.x + badgeW - 7) + ' ' + (frag.y + 22) +
                ' L ' + frag.x + ' ' + (frag.y + 22) + ' Z';
            return h('g', { key: 'frag:' + key }, h('rect', {
                x: frag.x,
                y: frag.y,
                width: frag.width,
                height: frag.height,
                rx: 6,
                fill: 'color-mix(in srgb, var(--dsw-alias-label-primary) 2.5%, transparent)',
                stroke: 'var(--dsw-alias-border-l3)',
                strokeWidth: 1.25,
            }), h('path', {
                d: badgePath,
                fill: 'color-mix(in srgb, var(--dsw-alias-state-business-primary) 12%, var(--dsw-alias-bg-layer-1))',
                stroke: 'var(--dsw-alias-border-l3)',
                strokeWidth: 1,
            }), h('text', {
                x: frag.x + (badgeW - 3) / 2,
                y: frag.y + 11,
                textAnchor: 'middle',
                dominantBaseline: 'central',
                fontSize: 11,
                fontWeight: 600,
                fill: 'var(--dsw-alias-label-primary)',
            }, frag.kind), frag.label ? h('text', {
                x: frag.x + badgeW + 8,
                y: frag.y + 11,
                dominantBaseline: 'central',
                fontSize: 11.5,
                fontWeight: 500,
                fill: 'var(--dsw-alias-label-secondary)',
            }, '[' + frag.label + ']') : null, frag.sections.map((sec, sIdx) => h('g', { key: 'sec:' + sIdx }, h('line', {
                x1: frag.x,
                y1: sec.y,
                x2: frag.x + frag.width,
                y2: sec.y,
                stroke: 'var(--dsw-alias-border-l3)',
                strokeWidth: 1,
                strokeDasharray: '4 4',
            }), sec.label ? h('text', {
                x: frag.x + 12,
                y: sec.y + 13,
                fontSize: 11.5,
                fontWeight: 500,
                fill: 'var(--dsw-alias-label-secondary)',
            }, '[' + sec.label + ']') : null)));
        }
        function renderSeqEvent(ev, totalWidth, filledArrowId, openArrowId, crossEndId, key) {
            if (ev.type === 'divider') {
                const pillW = Math.max(60, ev.text.length * 10 + 28);
                return h('g', { key: 'div:' + key }, h('line', {
                    x1: 24,
                    y1: ev.y,
                    x2: totalWidth - 24,
                    y2: ev.y,
                    stroke: 'var(--dsw-alias-border-l3)',
                    strokeWidth: 1,
                }), h('rect', {
                    x: totalWidth / 2 - pillW / 2,
                    y: ev.y - 11,
                    width: pillW,
                    height: 22,
                    rx: 11,
                    fill: 'var(--dsw-alias-bg-layer-1)',
                    stroke: 'var(--dsw-alias-border-l3)',
                    strokeWidth: 1,
                }), h('text', {
                    x: totalWidth / 2,
                    y: ev.y,
                    textAnchor: 'middle',
                    dominantBaseline: 'central',
                    fontSize: 11.5,
                    fontWeight: 600,
                    fill: 'var(--dsw-alias-label-secondary)',
                }, ev.text));
            }
            if (ev.type === 'note') {
                const fold = 9;
                const x = ev.x;
                const y = ev.y;
                const w = ev.width;
                const ht = ev.height;
                const notePath = 'M ' + x + ' ' + y +
                    ' L ' + (x + w - fold) + ' ' + y +
                    ' L ' + (x + w) + ' ' + (y + fold) +
                    ' L ' + (x + w) + ' ' + (y + ht) +
                    ' L ' + x + ' ' + (y + ht) + ' Z';
                const foldPath = 'M ' + (x + w - fold) + ' ' + y +
                    ' L ' + (x + w - fold) + ' ' + (y + fold) +
                    ' L ' + (x + w) + ' ' + (y + fold);
                const lineH = 16;
                const textStartY = y + ht / 2 - ((ev.lines.length - 1) * lineH) / 2;
                return h('g', { key: 'note:' + key }, h('path', {
                    d: notePath,
                    fill: 'color-mix(in srgb, var(--dsw-alias-state-business-primary) 9%, var(--dsw-alias-bg-layer-1))',
                    stroke: 'var(--dsw-alias-border-l3)',
                    strokeWidth: 1.25,
                    strokeLinejoin: 'round',
                }), h('path', { d: foldPath, fill: 'none', stroke: 'var(--dsw-alias-border-l3)', strokeWidth: 1 }), h('text', {
                    x: x + w / 2,
                    y: textStartY,
                    textAnchor: 'middle',
                    dominantBaseline: 'central',
                    fontSize: 12,
                    fill: 'var(--dsw-alias-label-primary)',
                }, ev.lines.map((l, i) => h('tspan', { key: i, x: x + w / 2, dy: i === 0 ? 0 : lineH }, l))));
            }
            const endMarker = ev.arrowKind === 'cross'
                ? crossEndId
                : ev.arrowKind === 'open'
                    ? openArrowId
                    : filledArrowId;
            if (ev.isSelf) {
                const loopX = ev.x1 + 32;
                const d = 'M ' + ev.x1 + ' ' + ev.y +
                    ' L ' + loopX + ' ' + ev.y +
                    ' L ' + loopX + ' ' + ev.yEnd +
                    ' L ' + (ev.x1 + 2) + ' ' + ev.yEnd;
                const lineH = 15;
                const textY = (ev.y + ev.yEnd) / 2 - ((ev.lines.length - 1) * lineH) / 2;
                return h('g', { key: 'msg:' + key }, h('path', {
                    d,
                    fill: 'none',
                    stroke: 'var(--dsw-alias-link)',
                    strokeWidth: 1.5,
                    strokeDasharray: ev.dashed ? '5 4' : undefined,
                    strokeLinejoin: 'round',
                    markerEnd: 'url(#' + endMarker + ')',
                }), ev.lines.length > 0 ? h('text', {
                    x: loopX + 8,
                    y: textY,
                    textAnchor: 'start',
                    dominantBaseline: 'central',
                    fontSize: 12,
                    fontWeight: 500,
                    fill: 'var(--dsw-alias-label-primary)',
                }, ev.lines.map((l, i) => h('tspan', { key: i, x: loopX + 8, dy: i === 0 ? 0 : lineH }, l))) : null);
            }
            const dir = ev.x2 >= ev.x1 ? 1 : -1;
            const startX = ev.x1 + dir * 2;
            const endX = ev.x2 - dir * 2;
            const midX = (ev.x1 + ev.x2) / 2;
            const lineH = 15;
            const textBaseY = ev.y - 9 - (ev.lines.length - 1) * lineH;
            return h('g', { key: 'msg:' + key }, h('line', {
                x1: startX,
                y1: ev.y,
                x2: endX,
                y2: ev.y,
                stroke: 'var(--dsw-alias-link)',
                strokeWidth: 1.5,
                strokeDasharray: ev.dashed ? '5 4' : undefined,
                markerEnd: 'url(#' + endMarker + ')',
                markerStart: ev.bidirectional ? 'url(#' + endMarker + ')' : undefined,
            }), ev.lines.length > 0 ? h('text', {
                x: midX,
                y: textBaseY,
                textAnchor: 'middle',
                dominantBaseline: 'central',
                fontSize: 12,
                fontWeight: 500,
                fill: 'var(--dsw-alias-label-primary)',
            }, ev.lines.map((l, i) => h('tspan', { key: i, x: midX, dy: i === 0 ? 0 : lineH }, l))) : null);
        }
        function renderActorIcon(cx, cy, strokeColor) {
            return h('g', { stroke: strokeColor, strokeWidth: 1.6, fill: 'none', strokeLinecap: 'round', strokeLinejoin: 'round' }, h('circle', { cx, cy: cy - 11, r: 5.5, fill: 'color-mix(in srgb, var(--dsw-alias-link) 8%, var(--dsw-alias-bg-layer-1))' }), h('line', { x1: cx, y1: cy - 5.5, x2: cx, y2: cy + 5 }), h('line', { x1: cx - 8, y1: cy - 1, x2: cx + 8, y2: cy - 1 }), h('line', { x1: cx, y1: cy + 5, x2: cx - 6, y2: cy + 13 }), h('line', { x1: cx, y1: cy + 5, x2: cx + 6, y2: cy + 13 }));
        }
        // ==================== Layered Graph SVG Renderer (Flowchart / Class / State / ER / Component) ====================
        function renderGraphSvg(diagram, markerBase) {
            const mIds = {
                arrowEnd: markerBase + '-end',
                arrowStart: markerBase + '-start',
                hollowTriEnd: markerBase + '-htri-end',
                hollowTriStart: markerBase + '-htri-start',
                filledDiaEnd: markerBase + '-fdia-end',
                filledDiaStart: markerBase + '-fdia-start',
                hollowDiaEnd: markerBase + '-hdia-end',
                hollowDiaStart: markerBase + '-hdia-start',
            };
            return h('svg', {
                viewBox: '0 0 ' + diagram.width + ' ' + diagram.height,
                width: diagram.width,
                height: diagram.height,
                role: 'presentation',
                style: svgStyleForWidth(diagram.width),
            }, h('defs', null, h('marker', {
                id: mIds.arrowEnd,
                markerWidth: 9,
                markerHeight: 8,
                refX: 8,
                refY: 4,
                orient: 'auto',
                markerUnits: 'userSpaceOnUse',
            }, h('path', { d: 'M0,1 L9,4 L0,7 L2.2,4 z', fill: 'var(--dsw-alias-link)' })), h('marker', {
                id: mIds.arrowStart,
                markerWidth: 9,
                markerHeight: 8,
                refX: 1,
                refY: 4,
                orient: 'auto',
                markerUnits: 'userSpaceOnUse',
            }, h('path', { d: 'M9,1 L0,4 L9,7 L6.8,4 z', fill: 'var(--dsw-alias-link)' })), h('marker', {
                id: mIds.hollowTriEnd,
                markerWidth: 11,
                markerHeight: 10,
                refX: 10,
                refY: 5,
                orient: 'auto',
                markerUnits: 'userSpaceOnUse',
            }, h('path', { d: 'M1,1 L10,5 L1,9 Z', fill: 'var(--dsw-alias-bg-layer-1)', stroke: 'var(--dsw-alias-link)', strokeWidth: 1.5, strokeLinejoin: 'round' })), h('marker', {
                id: mIds.hollowTriStart,
                markerWidth: 11,
                markerHeight: 10,
                refX: 1,
                refY: 5,
                orient: 'auto',
                markerUnits: 'userSpaceOnUse',
            }, h('path', { d: 'M10,1 L1,5 L10,9 Z', fill: 'var(--dsw-alias-bg-layer-1)', stroke: 'var(--dsw-alias-link)', strokeWidth: 1.5, strokeLinejoin: 'round' })), h('marker', {
                id: mIds.filledDiaEnd,
                markerWidth: 13,
                markerHeight: 10,
                refX: 12,
                refY: 5,
                orient: 'auto',
                markerUnits: 'userSpaceOnUse',
            }, h('path', { d: 'M1,5 L6.5,1.5 L12,5 L6.5,8.5 Z', fill: 'var(--dsw-alias-link)' })), h('marker', {
                id: mIds.filledDiaStart,
                markerWidth: 13,
                markerHeight: 10,
                refX: 1,
                refY: 5,
                orient: 'auto',
                markerUnits: 'userSpaceOnUse',
            }, h('path', { d: 'M1,5 L6.5,1.5 L12,5 L6.5,8.5 Z', fill: 'var(--dsw-alias-link)' })), h('marker', {
                id: mIds.hollowDiaEnd,
                markerWidth: 13,
                markerHeight: 10,
                refX: 12,
                refY: 5,
                orient: 'auto',
                markerUnits: 'userSpaceOnUse',
            }, h('path', { d: 'M1,5 L6.5,1.5 L12,5 L6.5,8.5 Z', fill: 'var(--dsw-alias-bg-layer-1)', stroke: 'var(--dsw-alias-link)', strokeWidth: 1.5 })), h('marker', {
                id: mIds.hollowDiaStart,
                markerWidth: 13,
                markerHeight: 10,
                refX: 1,
                refY: 5,
                orient: 'auto',
                markerUnits: 'userSpaceOnUse',
            }, h('path', { d: 'M1,5 L6.5,1.5 L12,5 L6.5,8.5 Z', fill: 'var(--dsw-alias-bg-layer-1)', stroke: 'var(--dsw-alias-link)', strokeWidth: 1.5 }))), (diagram.subgraphs ?? []).map(sg => renderSubgraph(sg)), diagram.edges.map((edge, index) => renderEdge(edge, mIds, index)), diagram.nodes.map(node => renderNode(node)));
        }
        function renderSubgraph(sg) {
            return h('g', { key: 'sg:' + sg.id }, h('rect', {
                x: sg.x,
                y: sg.y,
                width: sg.width,
                height: sg.height,
                rx: 12,
                fill: 'color-mix(in srgb, var(--dsw-alias-label-primary) 3%, transparent)',
                stroke: 'var(--dsw-alias-border-l3)',
                strokeWidth: 1,
                strokeDasharray: '5 4',
            }), h('text', {
                x: sg.x + 14,
                y: sg.y + 19,
                fontSize: 12,
                fontWeight: 600,
                fill: 'var(--dsw-alias-label-secondary)',
            }, sg.title));
        }
        function resolveMarkerUrl(kind, isStart, mIds) {
            if (kind === 'hollow_triangle')
                return 'url(#' + (isStart ? mIds.hollowTriStart : mIds.hollowTriEnd) + ')';
            if (kind === 'filled_diamond')
                return 'url(#' + (isStart ? mIds.filledDiaStart : mIds.filledDiaEnd) + ')';
            if (kind === 'hollow_diamond')
                return 'url(#' + (isStart ? mIds.hollowDiaStart : mIds.hollowDiaEnd) + ')';
            if (kind === 'arrow')
                return 'url(#' + (isStart ? mIds.arrowStart : mIds.arrowEnd) + ')';
            return undefined;
        }
        function renderEdge(edge, mIds, key) {
            const strokeWidth = edge.style === 'thick' ? 2.5 : 1.5;
            const pathProps = {
                key: 'line',
                d: edge.path,
                fill: 'none',
                stroke: 'var(--dsw-alias-link)',
                strokeWidth,
                strokeLinecap: 'round',
                strokeLinejoin: 'round',
                opacity: edge.isBackEdge ? 0.85 : 1,
            };
            if (edge.style === 'dashed')
                pathProps.strokeDasharray = '5 4';
            const endKind = edge.endMarker ?? (edge.hasEndArrow ? 'arrow' : 'none');
            const startKind = edge.startMarker ?? (edge.hasStartArrow ? 'arrow' : 'none');
            const endUrl = resolveMarkerUrl(endKind, false, mIds);
            const startUrl = resolveMarkerUrl(startKind, true, mIds);
            if (endUrl)
                pathProps.markerEnd = endUrl;
            if (startUrl)
                pathProps.markerStart = startUrl;
            const children = [h('path', pathProps)];
            const label = (edge.label ?? '').trim();
            if (label !== '' && edge.labelLines && edge.labelLines.length > 0) {
                const w = edge.labelWidth;
                const ht = edge.labelHeight;
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
                }));
                const lineHeight = 15;
                const startY = edge.labelY - ((edge.labelLines.length - 1) * lineHeight) / 2;
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
                }, line))));
            }
            return h('g', { key: 'edge:' + key }, children);
        }
        function renderNode(node) {
            const w = node.width;
            const ht = node.height;
            const x = node.x - w / 2;
            const y = node.y - ht / 2;
            if (node.shape === 'state_start') {
                return h('g', { key: 'node:' + node.id }, h('circle', { cx: node.x, cy: node.y, r: 10, fill: 'var(--dsw-alias-label-primary)' }));
            }
            if (node.shape === 'state_end') {
                return h('g', { key: 'node:' + node.id }, h('circle', { cx: node.x, cy: node.y, r: 12, fill: 'var(--dsw-alias-bg-layer-1)', stroke: 'var(--dsw-alias-label-primary)', strokeWidth: 2 }), h('circle', { cx: node.x, cy: node.y, r: 6.5, fill: 'var(--dsw-alias-label-primary)' }));
            }
            if (node.shape === 'state_bar') {
                return h('g', { key: 'node:' + node.id }, h('rect', { x, y, width: w, height: ht, rx: 4, fill: 'var(--dsw-alias-label-primary)' }));
            }
            if (node.shape === 'actor') {
                const lineH = 17;
                return h('g', { key: 'node:' + node.id }, renderActorIcon(node.x, y + 20, 'var(--dsw-alias-link)'), h('text', {
                    x: node.x,
                    y: y + 44,
                    textAnchor: 'middle',
                    dominantBaseline: 'central',
                    fontSize: 13,
                    fontWeight: 500,
                    fill: 'var(--dsw-alias-label-primary)',
                }, node.lines.map((line, index) => h('tspan', { key: index, x: node.x, dy: index === 0 ? 0 : lineH }, line))));
            }
            if (node.shape === 'uml_class' && node.sections) {
                return renderUmlClassNode(node, x, y, w, ht);
            }
            const isDecision = node.shape === 'diamond' || node.shape === 'hexagon';
            const isTerminal = node.shape === 'stadium' || node.shape === 'circle' || node.shape === 'doublecircle';
            const fill = isDecision
                ? 'color-mix(in srgb, var(--dsw-alias-state-business-primary) 7%, var(--dsw-alias-bg-layer-1))'
                : isTerminal
                    ? 'color-mix(in srgb, var(--dsw-alias-link) 6%, var(--dsw-alias-bg-layer-1))'
                    : 'var(--dsw-alias-bg-layer-1)';
            const stroke = isDecision
                ? 'var(--dsw-alias-state-business-primary)'
                : isTerminal
                    ? 'var(--dsw-alias-link)'
                    : 'var(--dsw-alias-border-l3)';
            const shapeProps = { fill, stroke, strokeWidth: 1.5, strokeLinejoin: 'round' };
            let shapeEl;
            let textOffsetY = 0;
            let textOffsetX = 0;
            if (node.shape === 'diamond') {
                const points = [
                    [node.x, y],
                    [x + w, node.y],
                    [node.x, y + ht],
                    [x, node.y],
                ].map(pt => pt.join(',')).join(' ');
                shapeEl = h('polygon', { points, ...shapeProps });
            }
            else if (node.shape === 'hexagon') {
                const ins = 14;
                const points = [
                    [x + ins, y],
                    [x + w - ins, y],
                    [x + w, node.y],
                    [x + w - ins, y + ht],
                    [x + ins, y + ht],
                    [x, node.y],
                ].map(pt => pt.join(',')).join(' ');
                shapeEl = h('polygon', { points, ...shapeProps });
            }
            else if (node.shape === 'parallelogram') {
                const sl = 14;
                const points = [[x + sl, y], [x + w, y], [x + w - sl, y + ht], [x, y + ht]].map(p => p.join(',')).join(' ');
                shapeEl = h('polygon', { points, ...shapeProps });
            }
            else if (node.shape === 'parallelogram_alt') {
                const sl = 14;
                const points = [[x, y], [x + w - sl, y], [x + w, y + ht], [x + sl, y + ht]].map(p => p.join(',')).join(' ');
                shapeEl = h('polygon', { points, ...shapeProps });
            }
            else if (node.shape === 'trapezoid') {
                const sl = 14;
                const points = [[x + sl, y], [x + w - sl, y], [x + w, y + ht], [x, y + ht]].map(p => p.join(',')).join(' ');
                shapeEl = h('polygon', { points, ...shapeProps });
            }
            else if (node.shape === 'trapezoid_alt') {
                const sl = 14;
                const points = [[x, y], [x + w, y], [x + w - sl, y + ht], [x + sl, y + ht]].map(p => p.join(',')).join(' ');
                shapeEl = h('polygon', { points, ...shapeProps });
            }
            else if (node.shape === 'asymmetric') {
                const points = [
                    [x, y],
                    [x + w, y],
                    [x + w, y + ht],
                    [x, y + ht],
                    [x + 12, node.y],
                ].map(p => p.join(',')).join(' ');
                shapeEl = h('polygon', { points, ...shapeProps });
                textOffsetX = 4;
            }
            else if (node.shape === 'circle') {
                shapeEl = h('ellipse', { cx: node.x, cy: node.y, rx: w / 2, ry: ht / 2, ...shapeProps });
            }
            else if (node.shape === 'doublecircle') {
                shapeEl = h('g', null, h('ellipse', { cx: node.x, cy: node.y, rx: w / 2, ry: ht / 2, ...shapeProps }), h('ellipse', { cx: node.x, cy: node.y, rx: Math.max(4, w / 2 - 4), ry: Math.max(4, ht / 2 - 4), fill: 'none', stroke, strokeWidth: 1.25 }));
            }
            else if (node.shape === 'cylinder') {
                const ry = 7;
                const rx = w / 2;
                const bodyPath = 'M ' + x + ' ' + (y + ry) +
                    ' L ' + x + ' ' + (y + ht - ry) +
                    ' A ' + rx + ' ' + ry + ' 0 0 0 ' + (x + w) + ' ' + (y + ht - ry) +
                    ' L ' + (x + w) + ' ' + (y + ry) + ' Z';
                shapeEl = h('g', null, h('path', { d: bodyPath, ...shapeProps }), h('ellipse', { cx: node.x, cy: y + ry, rx, ry, ...shapeProps }));
                textOffsetY = 3;
            }
            else if (node.shape === 'subroutine') {
                shapeEl = h('g', null, h('rect', { x, y, width: w, height: ht, rx: 6, ...shapeProps }), h('line', { x1: x + 9, y1: y, x2: x + 9, y2: y + ht, stroke, strokeWidth: 1.25 }), h('line', { x1: x + w - 9, y1: y, x2: x + w - 9, y2: y + ht, stroke, strokeWidth: 1.25 }));
            }
            else {
                const rx = node.shape === 'stadium' ? ht / 2 : node.shape === 'rounded' ? 14 : 8;
                shapeEl = h('rect', { x, y, width: w, height: ht, rx, ...shapeProps });
            }
            const lineHeight = 18;
            const startY = node.y + textOffsetY - ((node.lines.length - 1) * lineHeight) / 2;
            const textX = node.x + textOffsetX;
            const tspans = node.lines.map((line, index) => h('tspan', {
                key: index,
                x: textX,
                dy: index === 0 ? 0 : lineHeight,
            }, line));
            return h('g', { key: 'node:' + node.id }, shapeEl, h('text', {
                x: textX,
                y: startY,
                textAnchor: 'middle',
                dominantBaseline: 'central',
                fontSize: 13,
                fontWeight: 500,
                fill: 'var(--dsw-alias-label-primary)',
            }, tspans));
        }
        function renderUmlClassNode(node, x, y, w, ht) {
            const s = node.sections;
            const headerH = s.stereotype ? 44 : 30;
            const attrs = s.attrs ?? [];
            const methods = s.methods ?? [];
            const attrsH = attrs.length > 0 ? attrs.length * 18 + 12 : 0;
            const headerFill = 'color-mix(in srgb, var(--dsw-alias-link) 7%, var(--dsw-alias-bg-layer-1))';
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
            ];
            if (s.stereotype) {
                elements.push(h('text', {
                    key: 'stereo',
                    x: node.x,
                    y: y + 13,
                    textAnchor: 'middle',
                    dominantBaseline: 'central',
                    fontSize: 11,
                    fill: 'var(--dsw-alias-label-secondary)',
                }, '«' + s.stereotype + '»'));
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
            }, s.title));
            if (attrs.length > 0 || methods.length > 0) {
                elements.push(h('line', {
                    key: 'div1',
                    x1: x,
                    y1: y + headerH,
                    x2: x + w,
                    y2: y + headerH,
                    stroke: 'var(--dsw-alias-border-l3)',
                    strokeWidth: 1,
                }));
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
                    }, attr));
                });
            }
            if (methods.length > 0) {
                const mTop = y + headerH + attrsH;
                if (attrs.length > 0) {
                    elements.push(h('line', {
                        key: 'div2',
                        x1: x,
                        y1: mTop,
                        x2: x + w,
                        y2: mTop,
                        stroke: 'var(--dsw-alias-border-l3)',
                        strokeWidth: 1,
                    }));
                }
                methods.forEach((m, idx) => {
                    elements.push(h('text', {
                        key: 'method:' + idx,
                        x: x + 12,
                        y: mTop + 15 + idx * 18,
                        dominantBaseline: 'central',
                        fontSize: 12,
                        fill: 'var(--dsw-alias-label-primary)',
                    }, m));
                });
            }
            return h('g', { key: 'node:' + node.id }, elements);
        }
        return {
            inject: ['slots', 'locale'],
            apply(ctx) {
                ctx.effect(() => ctx.locale.register(FLOWCHART_NS, { zh: flowchartZh, en: flowchartEn }), 'markdown-flowchart: dictionaries');
                for (const key of FLOWCHART_LANGUAGES) {
                    ctx.slots.inject('conversation.chat.markdown.fence', () => ctx.slots.register({
                        name: 'conversation.chat.markdown.fence',
                        id: FLOWCHART_ID,
                        key,
                        order: 20,
                        locale: FLOWCHART_NS,
                    }, FlowchartFence));
                }
            },
        };
    },
});
