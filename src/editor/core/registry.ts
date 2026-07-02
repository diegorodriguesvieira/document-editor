import type { AnyExtension } from '@tiptap/core'
import type {
  CommandFn,
  ContextMenuSection,
  FeatureDefinition,
  PageRegion,
  PanelContribution,
  ToolbarItem,
} from './types'

/** Stable ascending sort by `order` (default 0), preserving input order on ties. */
function byOrder<T extends { order?: number }>(items: T[]): T[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => (a.item.order ?? 0) - (b.item.order ?? 0) || a.index - b.index)
    .map(({ item }) => item)
}

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
  panels: PanelContribution[]
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

  // Referential integrity: every commandId a channel or keymap points at must
  // resolve to a registered command. Catches typos / removed-from-this-preset
  // commands at boot, instead of a button that renders enabled and no-ops on click.
  const missing: string[] = []
  const check = (commandId: string | undefined, where: string) => {
    if (commandId && !(commandId in commands)) missing.push(`${where} -> "${commandId}"`)
  }
  for (const feature of features) {
    for (const item of feature.toolbar ?? []) check(item.commandId, `toolbar "${item.id}"`)
    for (const item of feature.insert ?? []) check(item.commandId, `insert "${item.id}"`)
    for (const section of feature.contextMenu ?? []) {
      for (const group of section.groups) {
        for (const item of group.items) check(item.commandId, `contextMenu "${item.id}"`)
      }
    }
    for (const region of feature.pageRegions ?? []) check(region.addCommandId, `pageRegion "${region.id}"`)
  }
  for (const commandId of Object.values(keymap)) check(commandId, 'keymap')
  if (missing.length > 0) {
    throw new Error(`Command id(s) referenced but never registered: ${missing.join(', ')}.`)
  }

  // Panel ids double as React keys in FeaturePanels — a cross-team collision
  // must fail at boot like duplicate commands do, not silently at render.
  const panelIds = new Set<string>()
  for (const feature of features) {
    for (const panel of feature.panels ?? []) {
      if (panelIds.has(panel.id)) {
        throw new Error(`Panel "${panel.id}" was contributed by more than one feature.`)
      }
      panelIds.add(panel.id)
    }
  }

  return {
    features,
    extensions: features.flatMap((feature) => feature.extensions()),
    commands,
    keymap,
    toolbar: byOrder(features.flatMap((feature) => feature.toolbar ?? [])),
    inserts: byOrder(features.flatMap((feature) => feature.insert ?? [])),
    contextMenu: features.flatMap((feature) => feature.contextMenu ?? []),
    pageRegions: features.flatMap((feature) => feature.pageRegions ?? []),
    panels: byOrder(features.flatMap((feature) => feature.panels ?? [])),
  }
}
