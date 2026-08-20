/**
 * Deterministic RTL layout tests for Management Journal PDF rendering.
 * Imports the pure layout module used by the Edge Function renderer.
 */

import { describe, expect, it } from 'vitest'
import {
  glyphsLeftToRight,
  glyphsRightToLeftReading,
  layoutRtlLine,
  rightmostGlyph,
  splitBidiRuns,
  unitMeasure,
} from '../../supabase/functions/management-journal-daily-summary-pdf/rtlLayout'

function layout(text: string) {
  return layoutRtlLine(text, (chunk) => unitMeasure(chunk))
}

describe('management journal PDF RTL layout', () => {
  it('keeps pure Hebrew readable from the right without string reversal', () => {
    const samples = [
      'סיכום יומי',
      'דף משותף',
      'משימה',
      'סטטוס',
      'בדיקת מסמכים',
      'בטיפול',
      'חדש',
      'הושלם',
      'חסום',
    ]

    for (const sample of samples) {
      const glyphs = layout(sample)
      expect(glyphsRightToLeftReading(glyphs)).toBe(sample)
      expect(rightmostGlyph(glyphs)?.char).toBe([...sample].find((ch) => /[\u0590-\u05FF]/.test(ch)))
      // Must not paint a whole-string reverse of the logical text as one blob.
      expect(glyphsLeftToRight(glyphs)).not.toBe(sample)
      expect(glyphs.map((g) => g.char).join('')).toBe(sample)
    }
  })

  it('keeps 10:30 as an LTR digit block beside Hebrew', () => {
    const text = 'לתאם פגישה בשעה 10:30'
    const glyphs = layout(text)
    const latin = glyphs.filter((g) => !g.hebrew).map((g) => g.char).join('')
    expect(latin).toBe('10:30')

    const hebrewOnly = glyphs.filter((g) => g.hebrew)
    expect(glyphsRightToLeftReading(hebrewOnly).replace(/\s+$/, '')).toBe('לתאם פגישה בשעה')
    expect(rightmostGlyph(glyphs)?.char).toBe('ל')

    // Within the latin block, left-to-right visual order is 10:30 (not 03:01).
    const latinGlyphs = glyphs.filter((g) => !g.hebrew)
    expect(glyphsLeftToRight(latinGlyphs)).toBe('10:30')
  })

  it('keeps dates readable as LTR', () => {
    const glyphs = layout('2026-08-20')
    expect(glyphs.map((g) => g.char).join('')).toBe('2026-08-20')
    expect(glyphsLeftToRight(glyphs)).toBe('2026-08-20')
  })

  it('keeps punctuation/parentheses as separate LTR atoms beside Hebrew', () => {
    const text = 'בדיקה (מסמך) בשעה 10:30'
    const glyphs = layout(text)
    expect(glyphs.map((g) => g.char).join('')).toBe(text)
    expect(glyphs.filter((g) => !g.hebrew).map((g) => g.char).join('')).toBe('() 10:30')
    expect(rightmostGlyph(glyphs)?.char).toBe('ב')
    expect(glyphsLeftToRight(glyphs.filter((g) => !g.hebrew && /[0-9:]/.test(g.char)))).toBe(
      '10:30',
    )
  })

  it('wraps long Hebrew by logical words while preserving RTL glyph order per line', () => {
    const long =
      'לבצע מעקב מלא אחרי כל בקשות ההורים לרישום לגן ולתעד את הסטטוס של כל בקשה במערכת'
    const glyphs = layout(long)
    expect(glyphsRightToLeftReading(glyphs)).toBe(long)
    expect(rightmostGlyph(glyphs)?.char).toBe('ל')
  })

  it('classifies mixed runs without reversing Hebrew inside splitBidiRuns', () => {
    const runs = splitBidiRuns('משימה 12 (א)')
    expect(runs.some((run) => run.hebrew && run.text.includes('משימה'))).toBe(true)
    expect(runs.some((run) => !run.hebrew && run.text.includes('12'))).toBe(true)
    expect(runs.map((run) => run.text).join('')).toBe('משימה 12 (א)')
  })
})
