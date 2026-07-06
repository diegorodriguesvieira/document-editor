import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { ReactNode } from 'react'
import {
  DocumentVariablesProvider,
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
  it('exposes exactly the provided list', () => {
    const { result } = renderHook(() => useDocumentVariables(), { wrapper })
    expect(result.current).toBe(VARS)
  })

  it('without a provider the context degrades to empty, never throws', () => {
    const { result } = renderHook(() => useDocumentVariables())
    expect(result.current).toEqual([])
  })
})
