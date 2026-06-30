import type { AnyExtension, Editor } from '@tiptap/core'
import type { ReactNode } from 'react'
import type { EditorApi, EditorStateView } from './EditorApi'

/** Runs a feature command against the editor. Returns whether it applied. */
export type CommandFn = (editor: Editor, payload?: unknown) => boolean

/** What a custom toolbar control receives when it renders itself. */
export interface ToolbarItemContext {
  editor: Editor | null
  api: EditorApi
}

/** Declarative toolbar contribution — data, not JSX, so the host renders it. */
export interface ToolbarItem {
  id: string
  group?: string
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
  render?: (ctx: ToolbarItemContext) => ReactNode
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
}
