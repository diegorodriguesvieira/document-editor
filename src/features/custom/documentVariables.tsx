import { createContext, useContext, type ReactNode } from 'react'

export interface DocumentVariable {
  id: string
  label: string
}

const DocumentVariablesContext = createContext<DocumentVariable[]>([])

/**
 * Document variables are provided by the *consumer* (e.g. loaded from an API) and
 * shared by every feature that references them — merge fields and conditional
 * blocks. They flow through context, NOT through the `features` list, so loading
 * them async never recreates the editor.
 */
export function DocumentVariablesProvider({
  variables,
  children,
}: {
  variables: DocumentVariable[]
  children: ReactNode
}) {
  return (
    <DocumentVariablesContext.Provider value={variables}>
      {children}
    </DocumentVariablesContext.Provider>
  )
}

export function useDocumentVariables(): DocumentVariable[] {
  return useContext(DocumentVariablesContext)
}
