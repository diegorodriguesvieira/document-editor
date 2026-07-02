import type { AnyExtension, Editor } from '@tiptap/core'
import type { ReactNode } from 'react'
import type { EditorApi, EditorStateView } from './EditorApi'

/** Runs a feature command against the editor. Returns whether it applied. */
export type CommandFn = (editor: Editor, payload?: unknown) => boolean

/** What a feature-rendered piece of UI (toolbar control, side panel) receives. */
export interface FeatureRenderContext {
  editor: Editor | null
  api: EditorApi
}

/** Declarative toolbar contribution — data, not JSX, so the host renders it. */
export interface ToolbarItem {
  id: string
  group?: string
  /** Sort hint within a bar (ascending; default 0, stable for ties). Lets two
   *  features interleave their buttons deterministically. */
  order?: number
  label: string
  /** Short text/emoji icon; the host decides how to render it. */
  icon?: string
  /** Command id (from some feature's `commands`) to run on click. Optional
   *  when `render` provides a fully custom control. */
  commandId?: string
  /** Read from the engine-agnostic state view, so it works with a real editor
   *  or `createMockEditor` alike. */
  isActive?: (state: EditorStateView) => boolean
  isDisabled?: (state: EditorStateView) => boolean
  /** Escape hatch: render a fully custom control (dropdown, picker, etc.)
   *  instead of the default button. Lets a feature ship its own toolbar UI. */
  render?: (ctx: FeatureRenderContext) => ReactNode
}

/** A single right-click (context menu) action. */
export interface ContextMenuItem {
  id: string
  label: string
  /** Short text/emoji icon; the host decides how to render it. */
  icon?: string
  /** Command id (from some feature's `commands`) to run when picked. */
  commandId: string
  /** Render in a destructive (red) style, e.g. "Delete row". */
  danger?: boolean
  /** Show the item only when it currently applies (e.g. "Split cell" only in a
   *  merged cell). Omit to always show.
   *
   *  DELIBERATELY receives the raw `Editor` (not {@link EditorStateView} like
   *  `ToolbarItem.isDisabled`): availability checks are TipTap-native
   *  `editor.can().<command>()` probes the thin state view can't express, and
   *  features are TipTap-native by design. The trade-off: `when` and toolbar
   *  predicates stay mock-testable; `isAvailable` needs a real editor. */
  isAvailable?: (editor: Editor) => boolean
}

/** A labelled group of context-menu items, e.g. "Row" / "Column" / "Cell". */
export interface ContextMenuGroup {
  id: string
  label?: string
  items: ContextMenuItem[]
}

/**
 * A context menu a feature shows on right-click, when `when` matches the
 * engine-agnostic state at the clicked spot (e.g. the caret is in a table).
 */
export interface ContextMenuSection {
  id: string
  when: (state: EditorStateView) => boolean
  groups: ContextMenuGroup[]
}

/**
 * A page-edge "chrome" region (header/footer). The hover affordance to add it
 * shows while no node of `nodeName` exists; clicking runs `addCommandId`.
 */
export interface PageRegion {
  id: string
  /** Where the affordance sits on the page. */
  position: 'top' | 'bottom'
  /** Affordance label, e.g. "Add header". */
  label: string
  /** Command run when the affordance is clicked. */
  addCommandId: string
  /** Doc node representing the region; the affordance hides while it exists. */
  nodeName: string
}

/**
 * The contract every feature implements. A feature bundles its TipTap
 * extension(s) with the stable, engine-independent surface the app consumes:
 * commands, keybindings and toolbar/insert contributions.
 */
export interface FeatureDefinition {
  /** Stable unique id, e.g. 'bold', 'callout'. */
  id: string
  /** Other feature ids this one needs to be enabled alongside. */
  dependsOn?: string[]
  /** The TipTap extension(s) this feature installs. */
  extensions: () => AnyExtension[]
  /** Stable command ids → implementation. Referenced by toolbar/keymap. */
  commands?: Record<string, CommandFn>
  /** Extra shortcuts, e.g. `{ 'Mod-Shift-c': 'callout.toggle' }`. */
  keymap?: Record<string, string>
  toolbar?: ToolbarItem[]
  /**
   * Contributions to the left insert rail (same shape as toolbar items). The
   * `/` slash menu mirrors the runnable ones (those with a `commandId`).
   */
  insert?: ToolbarItem[]
  /** Right-click menu shown when its `when` predicate matches the click. */
  contextMenu?: ContextMenuSection[]
  /** Page-edge regions (header/footer) with a hover "add" affordance. */
  pageRegions?: PageRegion[]
}
