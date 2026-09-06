import { describe, expect, it } from 'vitest'
import {
  buildPrintingSubmissionPolicySavePayload,
  customRelativeNoticeTotalMinutes,
  normalizePrintingCutoffLocalTimeForInput,
  normalizePrintingCutoffLocalTimeForRpc,
  reconstructPrintingSubmissionPolicyChoice,
  validateCustomRelativeNoticeMinutes,
} from './printingSubmissionPolicy'

describe('printingSubmissionPolicy helpers', () => {
  it('reconstructs known presets including 60 minutes', () => {
    expect(
      reconstructPrintingSubmissionPolicyChoice({
        mode: 'relative_notice',
        noticeMinutes: 60,
        cutoffLocalTime: null,
      }),
    ).toEqual({ kind: 'preset', minutes: 60 })
    expect(
      reconstructPrintingSubmissionPolicyChoice({
        mode: 'relative_notice',
        noticeMinutes: 30,
        cutoffLocalTime: null,
      }),
    ).toEqual({ kind: 'preset', minutes: 30 })
    expect(
      reconstructPrintingSubmissionPolicyChoice({
        mode: 'relative_notice',
        noticeMinutes: 120,
        cutoffLocalTime: null,
      }),
    ).toEqual({ kind: 'preset', minutes: 120 })
    expect(
      reconstructPrintingSubmissionPolicyChoice({
        mode: 'relative_notice',
        noticeMinutes: 180,
        cutoffLocalTime: null,
      }),
    ).toEqual({ kind: 'preset', minutes: 180 })
    expect(
      reconstructPrintingSubmissionPolicyChoice({
        mode: 'relative_notice',
        noticeMinutes: 1440,
        cutoffLocalTime: null,
      }),
    ).toEqual({ kind: 'preset', minutes: 1440 })
  })

  it('maps unknown relative values to custom hours/minutes', () => {
    expect(
      reconstructPrintingSubmissionPolicyChoice({
        mode: 'relative_notice',
        noticeMinutes: 90,
        cutoffLocalTime: null,
      }),
    ).toEqual({ kind: 'custom', hours: 1, minutes: 30 })
  })

  it('reconstructs daily cutoff from stored TIME', () => {
    expect(
      reconstructPrintingSubmissionPolicyChoice({
        mode: 'daily_cutoff',
        noticeMinutes: 60,
        cutoffLocalTime: '08:00:00',
      }),
    ).toEqual({ kind: 'daily_cutoff', localTime: '08:00' })
    expect(normalizePrintingCutoffLocalTimeForInput('8:05:00')).toBe('08:05')
    expect(normalizePrintingCutoffLocalTimeForRpc('08:00')).toBe('08:00:00')
  })

  it('converts custom hours/minutes and rejects invalid ranges without clamping', () => {
    expect(customRelativeNoticeTotalMinutes(2, 30)).toBe(150)
    expect(validateCustomRelativeNoticeMinutes(2, 30)).toBeNull()
    expect(validateCustomRelativeNoticeMinutes(0, 0)).toBeNull()
    expect(validateCustomRelativeNoticeMinutes(168, 0)).toBeNull()
    expect(validateCustomRelativeNoticeMinutes(168, 1)).toMatch(/7 ימים/)
    expect(validateCustomRelativeNoticeMinutes(1, 60)).toMatch(/אינם תקינים/)
    expect(validateCustomRelativeNoticeMinutes(-1, 0)).toMatch(/אינם תקינים/)
  })

  it('builds relative preset payload with cutoff NULL', () => {
    expect(
      buildPrintingSubmissionPolicySavePayload({
        choice: { kind: 'preset', minutes: 120 },
        preservedNoticeMinutes: 60,
      }),
    ).toEqual({
      ok: true,
      printSubmissionPolicyMode: 'relative_notice',
      minimumPrintNoticeMinutes: 120,
      printDailyCutoffLocalTime: null,
    })
  })

  it('builds daily payload while preserving notice minutes', () => {
    expect(
      buildPrintingSubmissionPolicySavePayload({
        choice: { kind: 'daily_cutoff', localTime: '08:00' },
        preservedNoticeMinutes: 180,
      }),
    ).toEqual({
      ok: true,
      printSubmissionPolicyMode: 'daily_cutoff',
      minimumPrintNoticeMinutes: 180,
      printDailyCutoffLocalTime: '08:00:00',
    })
  })

  it('rejects invalid custom on save payload', () => {
    const result = buildPrintingSubmissionPolicySavePayload({
      choice: { kind: 'custom', hours: 200, minutes: 0 },
      preservedNoticeMinutes: 60,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errorMessage).toMatch(/7 ימים/)
  })
})
