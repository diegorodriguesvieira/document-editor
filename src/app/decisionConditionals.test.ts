import { afterEach, describe, expect, it, vi } from 'vitest'
import { normalizeConditionals, RAW_CONDITIONALS } from './decisionConditionals'

describe('normalizeConditionals (backend catalog → condition-scoped variables)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('re-expresses a decision flag as a ConditionFlag (id + label only — the provider stamps type/scope)', () => {
    expect(
      normalizeConditionals([
        { key: 'EC_DECISION_FULLTIME', label: 'If contract is full-time', providedBy: 'EOR' },
      ]),
    ).toEqual([{ id: 'EC_DECISION_FULLTIME', label: 'If contract is full-time' }])
  })

  it('invents no group — the backend catalog has none, so entries stay flat', () => {
    for (const variable of normalizeConditionals(RAW_CONDITIONALS)) {
      expect(variable.group).toBeUndefined()
    }
  })

  it('drops malformed entries and duplicate keys — warning, never silently shrinking', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = normalizeConditionals([
      { key: 'EC_DECISION_FULLTIME', label: 'If contract is full-time', providedBy: 'EOR' },
      { key: '', label: 'no key', providedBy: 'EOR' },
      { key: 'EC_DECISION_NO_LABEL', label: '', providedBy: 'EOR' },
      null,
      { key: 'EC_DECISION_FULLTIME', label: 'duplicate', providedBy: 'EOR' },
    ])
    expect(result.map((variable) => variable.id)).toEqual(['EC_DECISION_FULLTIME'])
    expect(result[0].label).toBe('If contract is full-time') // first occurrence wins
    expect(warn).toHaveBeenCalledTimes(4)
  })

  it('normalizes a non-array payload to an empty list instead of throwing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(normalizeConditionals({ conditionals: [] })).toEqual([])
    expect(normalizeConditionals(undefined)).toEqual([])
    expect(warn).toHaveBeenCalledTimes(2)
  })

  it('accepts the bundled sample whole (nothing dropped)', () => {
    expect(normalizeConditionals(RAW_CONDITIONALS)).toHaveLength(RAW_CONDITIONALS.length)
  })
})
