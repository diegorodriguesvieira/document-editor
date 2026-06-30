import { createContext, useContext, useMemo, type ReactNode } from 'react'

export interface DocumentVariable {
  id: string
  label: string
}

interface DocumentVariablesValue {
  list: DocumentVariable[]
  byId: Map<string, DocumentVariable>
}

const EMPTY: DocumentVariablesValue = { list: [], byId: new Map() }
const DocumentVariablesContext = createContext<DocumentVariablesValue>(EMPTY)

/**
 * Document variables are provided by the *consumer* (e.g. loaded from an API) and
 * shared by every feature that references them — merge fields and conditional
 * blocks. They flow through context, NOT through the `features` list, so loading
 * them async never recreates the editor. Indexed by id once at the boundary so
 * per-node lookups (e.g. a conditional block's label) are O(1), not O(n).
 */
export function DocumentVariablesProvider({
  variables,
  children,
}: {
  variables: DocumentVariable[]
  children: ReactNode
}) {
  const value = useMemo<DocumentVariablesValue>(
    () => ({ list: variables, byId: new Map(variables.map((variable) => [variable.id, variable])) }),
    [variables],
  )
  return <DocumentVariablesContext.Provider value={value}>{children}</DocumentVariablesContext.Provider>
}

/** The full list (e.g. to render a picker). */
export function useDocumentVariables(): DocumentVariable[] {
  return useContext(DocumentVariablesContext).list
}

/** O(1) lookup of a single variable by id. */
export function useDocumentVariable(id: string | null | undefined): DocumentVariable | undefined {
  const { byId } = useContext(DocumentVariablesContext)
  return id ? byId.get(id) : undefined
}
