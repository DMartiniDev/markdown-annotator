import { describe, it, expect } from 'vitest'
import { timestampPrefix } from './timestamp'

describe('timestampPrefix', () => {
  it('formats a normal date correctly', () => {
    const date = new Date(2026, 2, 23, 15, 7, 33) // 2026-03-23 15:07:33
    expect(timestampPrefix(date)).toBe('20260323_150733')
  })

  it('zero-pads single-digit month, day, hour, minute, second', () => {
    const date = new Date(2026, 0, 5, 3, 7, 9) // 2026-01-05 03:07:09
    expect(timestampPrefix(date)).toBe('20260105_030709')
  })

  it('handles December (month 12) correctly', () => {
    const date = new Date(2026, 11, 31, 23, 59, 59) // 2026-12-31 23:59:59
    expect(timestampPrefix(date)).toBe('20261231_235959')
  })

  it('handles January (month 01) — getMonth() is 0-based', () => {
    const date = new Date(2026, 0, 1, 0, 0, 0) // 2026-01-01 00:00:00
    expect(timestampPrefix(date)).toBe('20260101_000000')
  })
})
