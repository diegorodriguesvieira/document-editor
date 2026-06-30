import type { AnyExtension } from '@tiptap/core'
import type {
  CommandFn,
  ContextMenuSection,
  FeatureDefinition,
  PageRegion,
  ToolbarItem,
} from './types'

/** The merged, conflict-checked result of composing a set of features. */
export interface ResolvedFeatures {
  features: FeatureDefinition[]
  extensions: AnyExtension[]
  commands: Record<string, CommandFn>
  keymap: Record<string, string>
  toolbar: ToolbarItem[]
  inserts: ToolbarItem[]
  contextMenu: ContextMenuSection[]
  pageRegions: PageRegion[]
}

/**
 * Compose a list of opt-in features into the data the editor needs.
 * Deduplicates by id, validates `dependsOn`, and rejects duplicate command
 * ids or conflicting keymaps with a clear error.
 */
export function resolveFeatures(input: FeatureDefinition[]): ResolvedFeatures {
  const byId = new Map<string, FeatureDefinition>()
  for (const feature of input) {
    const existing = byId.get(feature.id)
    if (existing && existing !== feature) {
      throw new Error(`Feature "${feature.id}" was registered with two different definitions.`)
    }
    byId.set(feature.id, feature)
  }
  const features = [...byId.values()]

  for (const feature of features) {
    for (const dep of feature.dependsOn ?? []) {
      if (!byId.has(dep)) {
        throw new Error(`Feature "${feature.id}" depends on "${dep}", which is not enabled.`)
      }
    }
  }

  const commands: Record<string, CommandFn> = {}
  for (const feature of features) {
    for (const [commandId, fn] of Object.entries(feature.commands ?? {})) {
      if (commandId in commands) {
        throw new Error(`Command "${commandId}" was declared by more than one feature.`)
      }
      commands[commandId] = fn
    }
  }

  const keymap: Record<string, string> = {}
  for (const feature of features) {
    for (const [key, commandId] of Object.entries(feature.keymap ?? {})) {
      if (key in keymap) {
        throw new Error(`Shortcut conflict: "${key}" was mapped by more than one feature.`)
      }
      keymap[key] = commandId
    }
  }

  return {
    features,
    extensions: features.flatMap((feature) => feature.extensions()),
    commands,
    keymap,
    toolbar: features.flatMap((feature) => feature.toolbar ?? []),
    inserts: features.flatMap((feature) => feature.insert ?? []),
    contextMenu: features.flatMap((feature) => feature.contextMenu ?? []),
    pageRegions: features.flatMap((feature) => feature.pageRegions ?? []),
  }
}
