/**
 * Deterministic RTL line layout for Management Journal PDFs.
 * Pure helpers (no pdf-lib) so Vitest can assert glyph order.
 *
 * Rule:
 * - Keep logical character order (never reverse Hebrew strings for painting).
 * - Compose the line from the right edge.
 * - Hebrew runs: place each glyph right-to-left in logical order.
 * - Non-Hebrew runs (digits, Latin, ASCII punct): place as one LTR block.
 *
 * Why not reverse+drawText: modern PDF viewers apply Unicode BIDI to
 * multi-character text operators and re-flip already-visual Hebrew.
 */

export type BidiRun = {
  text: string
  hebrew: boolean
}

export type RtlGlyph = {
  char: string
  hebrew: boolean
  /**
   * Distance from the line's right edge to this glyph's left edge.
   * Smaller = closer to the right.
   */
  offsetFromRight: number
  width: number
}

const HEBREW_RE = /[\u0590-\u05FF]/
const SPACE_RE = /\s/

function isHebrewChar(ch: string): boolean {
  return HEBREW_RE.test(ch)
}

/**
 * Split into Hebrew vs non-Hebrew runs.
 * Spaces attach to the preceding run.
 * Digits, Latin letters, and ASCII punctuation stay non-Hebrew (Helvetica)
 * so we never paint ',' / ':' / '(' with the Hebrew TTF.
 */
export function splitBidiRuns(text: string): BidiRun[] {
  const runs: BidiRun[] = []
  const chars = [...text]

  const push = (ch: string, hebrew: boolean) => {
    const last = runs[runs.length - 1]
    if (last && last.hebrew === hebrew) {
      last.text += ch
    } else {
      runs.push({ text: ch, hebrew })
    }
  }

  for (const ch of chars) {
    if (SPACE_RE.test(ch)) {
      if (runs.length > 0) {
        runs[runs.length - 1]!.text += ch
      } else {
        push(ch, false)
      }
      continue
    }

    if (isHebrewChar(ch)) {
      push(ch, true)
      continue
    }

    push(ch, false)
  }

  return runs.filter((run) => run.text.length > 0)
}

export function measureMixedLineWidth(
  text: string,
  measure: (chunk: string, hebrew: boolean) => number,
): number {
  return splitBidiRuns(text).reduce((total, run) => total + measure(run.text, run.hebrew), 0)
}

/**
 * Layout one line from the right edge using logical text.
 * `measure(chunk, hebrew)` returns advance width for that chunk.
 */
export function layoutRtlLine(
  text: string,
  measure: (chunk: string, hebrew: boolean) => number,
): RtlGlyph[] {
  const glyphs: RtlGlyph[] = []
  let cursor = 0

  for (const run of splitBidiRuns(text)) {
    if (run.hebrew) {
      for (const ch of run.text) {
        const width = measure(ch, true)
        cursor += width
        glyphs.push({
          char: ch,
          hebrew: true,
          offsetFromRight: cursor,
          width,
        })
      }
    } else {
      const chars = [...run.text]
      const widths = chars.map((ch) => measure(ch, false))
      const blockWidth = widths.reduce((sum, w) => sum + w, 0)
      let preceding = 0
      for (let i = 0; i < chars.length; i += 1) {
        const cw = widths[i]!
        glyphs.push({
          char: chars[i]!,
          hebrew: false,
          offsetFromRight: cursor + blockWidth - preceding,
          width: cw,
        })
        preceding += cw
      }
      cursor += blockWidth
    }
  }

  return glyphs
}

/** Distance from the line's right edge to this glyph's right edge (0 = flush right). */
export function glyphRightEdgeFromRight(glyph: RtlGlyph): number {
  return glyph.offsetFromRight - glyph.width
}

/** Characters in visual left→right order. */
export function glyphsLeftToRight(glyphs: RtlGlyph[]): string {
  return [...glyphs]
    .sort((a, b) => b.offsetFromRight - a.offsetFromRight)
    .map((g) => g.char)
    .join('')
}

/**
 * Reading order from the right for a pure-Hebrew (or RTL-only) glyph list.
 * For a correctly laid-out pure-Hebrew line this equals the logical input.
 */
export function glyphsRightToLeftReading(glyphs: RtlGlyph[]): string {
  return [...glyphs]
    .sort((a, b) => glyphRightEdgeFromRight(a) - glyphRightEdgeFromRight(b))
    .map((g) => g.char)
    .join('')
}

/** Rightmost glyph on the line (first Hebrew letter for a typical Hebrew title). */
export function rightmostGlyph(glyphs: RtlGlyph[]): RtlGlyph | undefined {
  if (glyphs.length === 0) return undefined
  return [...glyphs].sort((a, b) => glyphRightEdgeFromRight(a) - glyphRightEdgeFromRight(b))[0]
}

/** Unit-width measure used by deterministic layout tests. */
export function unitMeasure(chunk: string): number {
  return [...chunk].length
}
