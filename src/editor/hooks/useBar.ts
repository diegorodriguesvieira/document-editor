import { useEffect, useMemo, useReducer } from 'react'
import type { Editor } from '@tiptap/core'
import { useEditorState } from '@tiptap/react'
import type { EditorApi } from '../core/EditorApi'
import type { ResolvedFeatures } from '../core/registry'
import type { BarItemBase } from '../core/types'

/** A live bar entry: the contribution plus its current state and action. */
export interface BarButton {
  item: BarItemBase
  active: boolean
  disabled: boolean
  run: () => boolean
}

interface Flag {
  active: boolean
  disabled: boolean
}

function computeFlags(items: BarItemBase[], api: EditorApi): Flag[] {
  return items.map((item) => ({
    active: item.isActive ? item.isActive(api) : false,
    disabled: item.isDisabled ? item.isDisabled(api) : false,
  }))
}

/** Re-render driver for the headless/mock path (no real editor to subscribe to). */
function useApiRevision(api: EditorApi, enabled: boolean): number {
  const [revision, bump] = useReducer((n: number) => n + 1, 0)
  useEffect(() => {
    if (!enabled) return
    const offUpdate = api.on('update', bump)
    const offSelection = api.on('selection', bump)
    return () => {
      offUpdate()
      offSelection()
    }
  }, [api, enabled])
  return revision
}

/**
 * Core headless engine for any registry-driven bar (bubble menu, insert
 * dock). Given a list of contributions, returns the live buttons.
 *
 * State is read through the {@link EditorApi} seam, so it works with a real
 * editor *or* `createMockEditor`. With a real editor it rides `useEditorState`
 * (skips re-renders when flags don't change); without one it re-renders on the
 * api's update/selection events.
 */
function useBarButtons(
  editor: Editor | null,
  api: EditorApi,
  items: BarItemBase[],
): BarButton[] {
  const editorFlags = useEditorState({
    editor,
    selector: (snapshot) => (snapshot.editor ? computeFlags(items, api) : null),
  })

  const revision = useApiRevision(api, editor === null)

  const flags = useMemo(
    () => editorFlags ?? computeFlags(items, api),
    [editorFlags, items, api, revision],
  )

  return items.map((item, index) => ({
    item,
    active: flags[index]?.active ?? false,
    disabled: flags[index]?.disabled ?? false,
    run: () => (item.commandId ? api.exec(item.commandId) : false),
  }))
}

/** Headless state for the selection bubble (the `resolved.bubble` channel). */
export function useBubbleBar(
  editor: Editor | null,
  api: EditorApi,
  resolved: ResolvedFeatures,
): BarButton[] {
  return useBarButtons(editor, api, resolved.bubble)
}

/** Headless state for the insert dock (the `resolved.inserts` channel). */
export function useInsertBar(
  editor: Editor | null,
  api: EditorApi,
  resolved: ResolvedFeatures,
): BarButton[] {
  return useBarButtons(editor, api, resolved.inserts)
}
