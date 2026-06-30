import { describe, expect, it } from 'vitest'
import type { AnyExtension } from '@tiptap/core'
import { resolveFeatures } from './registry'
import { defineFeature } from './defineFeature'
import type { FeatureDefinition } from './types'

const ext = () => [{} as unknown as AnyExtension]

const feature = (over: Partial<FeatureDefinition> & { id: string }): FeatureDefinition =>
  defineFeature({ extensions: ext, ...over })

describe('resolveFeatures', () => {
  it('deduplicates the same feature included twice', () => {
    const bold = feature({ id: 'bold' })
    const resolved = resolveFeatures([bold, bold])
    expect(resolved.features).toHaveLength(1)
  })

  it('throws when one id has two different definitions', () => {
    expect(() =>
      resolveFeatures([feature({ id: 'bold' }), feature({ id: 'bold' })]),
    ).toThrow(/two different definitions/)
  })

  it('accepts a satisfied dependency and rejects a missing one', () => {
    const listItem = feature({ id: 'listItem' })
    const lists = feature({ id: 'lists', dependsOn: ['listItem'] })

    expect(() => resolveFeatures([listItem, lists])).not.toThrow()
    expect(() => resolveFeatures([lists])).toThrow(/depends on "listItem"/)
  })

  it('rejects duplicate command ids across features', () => {
    expect(() =>
      resolveFeatures([
        feature({ id: 'a', commands: { 'shared.cmd': () => true } }),
        feature({ id: 'b', commands: { 'shared.cmd': () => true } }),
      ]),
    ).toThrow(/Command "shared.cmd"/)
  })

  it('rejects a channel commandId that no command registers', () => {
    expect(() =>
      resolveFeatures([feature({ id: 'x', toolbar: [{ id: 'x', label: 'X', commandId: 'x.typo' }] })]),
    ).toThrow(/referenced but never registered/)
  })

  it('rejects conflicting keymaps', () => {
    expect(() =>
      resolveFeatures([
        feature({ id: 'a', keymap: { 'Mod-k': 'a.cmd' } }),
        feature({ id: 'b', keymap: { 'Mod-k': 'b.cmd' } }),
      ]),
    ).toThrow(/Shortcut conflict/)
  })

  it('aggregates extensions and toolbar contributions in order', () => {
    const resolved = resolveFeatures([
      feature({
        id: 'a',
        extensions: () => [{} as unknown as AnyExtension],
        commands: { 'a.cmd': () => true },
        toolbar: [{ id: 'a', label: 'A', commandId: 'a.cmd' }],
      }),
      feature({
        id: 'b',
        extensions: () => [{} as unknown as AnyExtension, {} as unknown as AnyExtension],
        commands: { 'b.cmd': () => true },
        toolbar: [{ id: 'b', label: 'B', commandId: 'b.cmd' }],
      }),
    ])
    expect(resolved.extensions).toHaveLength(3)
    expect(resolved.toolbar.map((t) => t.id)).toEqual(['a', 'b'])
  })

  it('orders toolbar items by their optional `order` (stable for ties)', () => {
    const resolved = resolveFeatures([
      feature({
        id: 'a',
        commands: { 'a.c': () => true },
        toolbar: [{ id: 'a', label: 'A', commandId: 'a.c', order: 2 }],
      }),
      feature({
        id: 'b',
        commands: { 'b.c': () => true },
        toolbar: [{ id: 'b', label: 'B', commandId: 'b.c', order: 1 }],
      }),
    ])
    expect(resolved.toolbar.map((t) => t.id)).toEqual(['b', 'a'])
  })
})
