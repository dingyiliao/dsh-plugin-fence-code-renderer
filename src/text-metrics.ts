/**
 * Shared CJK-aware text measurement and line wrapping utilities.
 */

/**
 * Measure approximate visual width of text in pixels at a given font size.
 * Accounts for wide CJK/fullwidth glyphs versus narrower Latin characters.
 */
function measureTextWidth(text: string, fontSize = 13): number {
  let units = 0
  for (const ch of String(text ?? '')) {
    const code = ch.codePointAt(0) ?? 0
    if (
      (code >= 0x2e80 && code <= 0x9fff) ||
      (code >= 0xac00 && code <= 0xd7af) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xff01 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6) ||
      code >= 0x1f000
    ) {
      units += 1.0
    } else if (ch === ' ' || ch === 'i' || ch === 'l' || ch === 'I' || ch === '1' || ch === '.' || ch === ',' || ch === ':' || ch === ';') {
      units += 0.36
    } else if ((code >= 65 && code <= 90) || ch === 'm' || ch === 'w' || ch === '@' || ch === '%' || ch === '&') {
      units += 0.72
    } else {
      units += 0.56
    }
  }
  return Math.ceil(units * fontSize)
}

/**
 * Split label on explicit line breaks (<br/>, \n) and wrap lines by visual width.
 */
function wrapLabel(value: string, maxLineWidth = 156, fontSize = 13): string[] {
  const raw = String(value ?? '')
    .replace(/<br\s*\/?>/giu, '\n')
    .replace(/\\n/gu, '\n')
  const paragraphs = raw.split('\n')
  const lines: string[] = []

  for (const para of paragraphs) {
    const text = para.replace(/\s+/gu, ' ').trim()
    if (text === '') {
      if (paragraphs.length === 1) lines.push(' ')
      continue
    }
    const tokens = text.split(' ')
    let current = ''
    for (const token of tokens) {
      const candidate = current === '' ? token : current + ' ' + token
      if (measureTextWidth(candidate, fontSize) <= maxLineWidth) {
        current = candidate
        continue
      }
      if (current !== '') {
        lines.push(current)
        current = ''
      }
      if (measureTextWidth(token, fontSize) <= maxLineWidth) {
        current = token
      } else {
        let chunk = ''
        for (const ch of token) {
          if (chunk !== '' && measureTextWidth(chunk + ch, fontSize) > maxLineWidth) {
            lines.push(chunk)
            chunk = ch
          } else {
            chunk += ch
          }
        }
        current = chunk
      }
    }
    if (current !== '') lines.push(current)
  }

  return lines.length > 0 ? lines : [' ']
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val))
}

export { clamp, measureTextWidth, wrapLabel }
