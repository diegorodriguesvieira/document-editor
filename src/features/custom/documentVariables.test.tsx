import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { ReactNode } from 'react'
import {
  DocumentVariablesProvider,
  groupVariables,
  useDocumentVariables,
  useMentionVariables,
  type ConditionFlag,
  type DocumentVariable,
} from './documentVariables'

const VARS: DocumentVariable[] = [
  { id: 'client.name', label: 'Client name' },
  { id: 'company.name', label: 'Company', group: 'Company' },
  // A backend decision flag: boolean, condition-builder only.
  {
    id: 'EC_DECISION_FULLTIME',
    label: 'If contract is full-time',
    type: 'boolean',
    scope: 'condition',
  },
]

const wrapper = ({ children }: { children: ReactNode }) => (
  <DocumentVariablesProvider variables={VARS}>{children}</DocumentVariablesProvider>
)

describe('document variables (the consumer-owned context)', () => {
  it('exposes exactly the provided list', () => {
    const { result } = renderHook(() => useDocumentVariables(), { wrapper })
    expect(result.current).toBe(VARS)
  })

  it('without a provider the context degrades to empty, never throws', () => {
    const { result } = renderHook(() => useDocumentVariables())
    expect(result.current).toEqual([])
  })
})

describe('useMentionVariables (insertion surfaces)', () => {
  it('filters condition-scoped variables out; the full hook keeps them', () => {
    const full = renderHook(() => useDocumentVariables(), { wrapper })
    expect(full.result.current).toHaveLength(3)

    const mention = renderHook(() => useMentionVariables(), { wrapper })
    expect(mention.result.current.map((v) => v.id)).toEqual(['client.name', 'company.name'])
  })

  it('is referentially stable while the provided list does not change', () => {
    const { result, rerender } = renderHook(() => useMentionVariables(), { wrapper })
    const first = result.current
    rerender()
    expect(result.current).toBe(first)
  })
})

describe('the `conditions` prop (sugar for backend decision catalogs)', () => {
  const FLAGS: ConditionFlag[] = [
    { id: 'EC_DECISION_HAS_PROBATION', label: 'If there is probation period' },
  ]
  const sugarWrapper = ({ children }: { children: ReactNode }) => (
    <DocumentVariablesProvider variables={VARS} conditions={FLAGS}>
      {children}
    </DocumentVariablesProvider>
  )

  it('folds flags into the ONE registry, stamped boolean + condition-scoped', () => {
    const { result } = renderHook(() => useDocumentVariables(), { wrapper: sugarWrapper })
    expect(result.current.at(-1)).toEqual({
      id: 'EC_DECISION_HAS_PROBATION',
      label: 'If there is probation period',
      type: 'boolean',
      scope: 'condition',
    })
  })

  it('mention surfaces never see them — the invariant lives in the API, not convention', () => {
    const { result } = renderHook(() => useMentionVariables(), { wrapper: sugarWrapper })
    expect(result.current.map((v) => v.id)).toEqual(['client.name', 'company.name'])
  })

  it('an empty conditions list passes the variables through by identity', () => {
    const empty = ({ children }: { children: ReactNode }) => (
      <DocumentVariablesProvider variables={VARS} conditions={[]}>
        {children}
      </DocumentVariablesProvider>
    )
    const { result } = renderHook(() => useDocumentVariables(), { wrapper: empty })
    expect(result.current).toBe(VARS)
  })
})

describe('groupVariables', () => {
  it('buckets by group (ungrouped under ""), ordered by first appearance', () => {
    expect(groupVariables(VARS).map(([group, items]) => [group, items.map((v) => v.id)])).toEqual([
      ['', ['client.name', 'EC_DECISION_FULLTIME']],
      ['Company', ['company.name']],
    ])
  })
})
