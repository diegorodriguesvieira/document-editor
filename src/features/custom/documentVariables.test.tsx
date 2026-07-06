import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { ReactNode } from 'react'
import {
  DocumentVariablesProvider,
  useDocumentVariable,
  useDocumentVariables,
  type DocumentVariable,
} from './documentVariables'

const VARS: DocumentVariable[] = [
  { id: 'client.name', label: 'Client name' },
  { id: 'company.name', label: 'Company', group: 'Company' },
]

const wrapper = ({ children }: { children: ReactNode }) => (
  <DocumentVariablesProvider variables={VARS}>{children}</DocumentVariablesProvider>
)

describe('document variables (the consumer-owned context)', () => {
  it('useDocumentVariable looks a variable up by id — unknown and null resolve to undefined', () => {
    const known = renderHook(() => useDocumentVariable('client.name'), { wrapper })
    expect(known.result.current).toEqual({ id: 'client.name', label: 'Client name' })

    const unknown = renderHook(() => useDocumentVariable('nope'), { wrapper })
    expect(unknown.result.current).toBeUndefined()

    // Node attrs can carry null (a draft condition) — the hook absorbs it.
    const empty = renderHook(() => useDocumentVariable(null), { wrapper })
    expect(empty.result.current).toBeUndefined()
  })

  it('without a provider the context degrades to empty, never throws', () => {
    const list = renderHook(() => useDocumentVariables())
    expect(list.result.current).toEqual([])

    const lookup = renderHook(() => useDocumentVariable('client.name'))
    expect(lookup.result.current).toBeUndefined()
  })
})
