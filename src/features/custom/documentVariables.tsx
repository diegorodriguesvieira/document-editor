import { createContext, useContext, useMemo, type ReactNode } from 'react'

export interface DocumentVariable {
  id: string
  label: string
  /** Optional section for pickers (e.g. the variables panel groups by it). */
  group?: string
  /** Value type. Drives the condition builder (a 'boolean' variable locks the
   *  operator to EQUALS and offers a True/False value) and rendering (a
   *  'signature' chip is stamped into the document + styled with the
   *  signature font). Default: 'text'. */
  type?: 'text' | 'boolean' | 'signature'
  /** Where the variable is offered. 'document' (default) = insertable in text
   *  AND usable in conditions; 'condition' = condition builder only (never in
   *  the @ picker/panel — e.g. backend decision flags). */
  scope?: 'document' | 'condition'
}

/**
 * A boolean predicate offered ONLY in the condition builder (e.g. a backend
 * decision catalog: "If contract is full-time"). Sugar over the registry —
 * the provider stamps `type: 'boolean'` + `scope: 'condition'`, so consumers
 * can't forget either and leak a flag into the @ picker.
 */
export interface ConditionFlag {
  id: string
  label: string
  /** Optional section for the builder's variable select. */
  group?: string
}

const DocumentVariablesContext = createContext<DocumentVariable[]>([])

/**
 * Document variables are provided by the *consumer* (e.g. loaded from an API)
 * and shared by every feature that references them — variables and
 * conditional blocks. They flow through context, NOT through the `features`
 * list, so loading them async never recreates the editor.
 *
 * `conditions` is the self-documenting spelling for condition-only boolean
 * flags: entries fold into the SAME registry (one ref namespace, one lookup)
 * already stamped `type: 'boolean'` + `scope: 'condition'`.
 */
export function DocumentVariablesProvider({
  variables,
  conditions,
  children,
}: {
  variables: DocumentVariable[]
  conditions?: ConditionFlag[]
  children: ReactNode
}) {
  const value = useMemo(
    () =>
      conditions?.length
        ? [
            ...variables,
            ...conditions.map(
              (flag): DocumentVariable => ({ ...flag, type: 'boolean', scope: 'condition' }),
            ),
          ]
        : variables,
    [variables, conditions],
  )
  return (
    <DocumentVariablesContext.Provider value={value}>
      {children}
    </DocumentVariablesContext.Provider>
  )
}

/** The full list, all scopes — what the condition builder consumes. */
export function useDocumentVariables(): DocumentVariable[] {
  return useContext(DocumentVariablesContext)
}

/**
 * Variables insertable in TEXT — the blessed list for every insertion surface
 * (the variables panel, the `@` suggestion). Condition-scoped variables are
 * predicates, not content: they never render inline, so they never show here.
 */
export function useMentionVariables(): DocumentVariable[] {
  const variables = useDocumentVariables()
  return useMemo(() => variables.filter((variable) => variable.scope !== 'condition'), [variables])
}

/** Grouping by `group` (ungrouped under ''), ordered by first appearance. */
export function groupVariables(variables: DocumentVariable[]): Array<[string, DocumentVariable[]]> {
  const groups = new Map<string, DocumentVariable[]>()
  for (const variable of variables) {
    const key = variable.group ?? ''
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(variable)
  }
  return [...groups.entries()]
}
