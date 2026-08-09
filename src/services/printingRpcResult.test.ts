import { describe, expect, it } from 'vitest'
import {
  normalizePrintingErrorCode,
  parseClaimRequestResult,
  parseCreateRequestResult,
  parsePrintingRpcResult,
  parseStatusResult,
} from './printingRpcResult'

describe('printingRpcResult parsers', () => {
  it('keeps known codes and maps unknown/malformed codes to PRINT_REQUEST_UNKNOWN_ERROR', () => {
    expect(normalizePrintingErrorCode('PRINT_REQUEST_LOCKED')).toBe('PRINT_REQUEST_LOCKED')
    expect(normalizePrintingErrorCode('PRINT_REQUEST_FORBIDDEN')).toBe('PRINT_REQUEST_FORBIDDEN')
    expect(normalizePrintingErrorCode({})).toBe('PRINT_REQUEST_UNKNOWN_ERROR')
    expect(normalizePrintingErrorCode('NOT_A_REAL_CODE')).toBe('PRINT_REQUEST_UNKNOWN_ERROR')
    expect(normalizePrintingErrorCode(undefined)).toBe('PRINT_REQUEST_UNKNOWN_ERROR')
  })

  it('parses create success payloads and rejects malformed success rows as unknown', () => {
    const ok = parsePrintingRpcResult(
      {
        ok: true,
        printing_request_id: 'req-1',
        request_number: 12,
        items: [
          { id: 'item-1', storage_object_path: 'a/b.pdf', display_order: 0 },
        ],
      },
      parseCreateRequestResult,
    )
    expect(ok).toEqual({
      ok: true,
      printing_request_id: 'req-1',
      request_number: 12,
      items: [{ id: 'item-1', storage_object_path: 'a/b.pdf', display_order: 0 }],
    })

    const malformed = parsePrintingRpcResult(
      { ok: true, printing_request_id: 'req-1' },
      parseCreateRequestResult,
    )
    expect(malformed).toEqual({ ok: false, error_code: 'PRINT_REQUEST_UNKNOWN_ERROR' })
  })

  it('parses claim and status success payloads', () => {
    expect(
      parsePrintingRpcResult(
        {
          ok: true,
          assigned_secretary_user_id: 'sec-1',
          status: 'in_progress',
        },
        parseClaimRequestResult,
      ),
    ).toEqual({
      ok: true,
      assigned_secretary_user_id: 'sec-1',
      status: 'in_progress',
    })

    expect(
      parsePrintingRpcResult({ ok: true, status: 'cancelled' }, parseStatusResult),
    ).toEqual({ ok: true, status: 'cancelled' })
  })

  it('keeps forbidden distinct from unknown when mapping failure envelopes', () => {
    expect(
      parsePrintingRpcResult(
        { ok: false, error_code: 'PRINT_REQUEST_FORBIDDEN' },
        parseStatusResult,
      ),
    ).toEqual({ ok: false, error_code: 'PRINT_REQUEST_FORBIDDEN' })

    expect(
      parsePrintingRpcResult(
        { ok: false, error_code: 'PRINT_REQUEST_ALREADY_CLAIMED' },
        parseStatusResult,
      ),
    ).toEqual({ ok: false, error_code: 'PRINT_REQUEST_ALREADY_CLAIMED' })

    expect(
      parsePrintingRpcResult({ ok: false, error_code: {} }, parseStatusResult),
    ).toEqual({ ok: false, error_code: 'PRINT_REQUEST_UNKNOWN_ERROR' })

    expect(parsePrintingRpcResult(null, parseStatusResult)).toEqual({
      ok: false,
      error_code: 'PRINT_REQUEST_UNKNOWN_ERROR',
    })
  })
})
