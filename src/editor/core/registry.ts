import type { AnyExtension } from '@tiptap/core'
import type { CommandFn, FeatureDefinition, SlashItem, ToolbarItem } from './types'

/** The merged, conflict-checked result of composing a set of features. */
export interface ResolvedFeatures {
  features: FeatureDefinition[]
  extensions: AnyExtension[]
  commands: Record<string, CommandFn>
  keymap: Record<string, string>
  toolbar: ToolbarItem[]
  inserts: ToolbarItem[]
  slash: SlashItem[]
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
      throw new Error(`Feature "${feature.id}" foi registrada com duas definições diferentes.`)
    }
    byId.set(feature.id, feature)
  }
  const features = [...byId.values()]

  for (const feature of features) {
    for (const dep of feature.dependsOn ?? []) {
      if (!byId.has(dep)) {
        throw new Error(`Feature "${feature.id}" depende de "${dep}", que não está habilitada.`)
      }
    }
  }

  const commands: Record<string, CommandFn> = {}
  for (const feature of features) {
    for (const [commandId, fn] of Object.entries(feature.commands ?? {})) {
      if (commandId in commands) {
        throw new Error(`Comando "${commandId}" foi declarado por mais de uma feature.`)
      }
      commands[commandId] = fn
    }
  }

  const keymap: Record<string, string> = {}
  for (const feature of features) {
    for (const [key, commandId] of Object.entries(feature.keymap ?? {})) {
      if (key in keymap) {
        throw new Error(`Conflito de atalho: "${key}" foi mapeado por mais de uma feature.`)
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
    slash: features.flatMap((feature) => feature.slash ?? []),
  }
}
