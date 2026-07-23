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
      resolveFeatures([feature({ id: 'x', bubble: [{ id: 'x', label: 'X', commandId: 'x.typo' }] })]),
    ).toThrow(/referenced but never registered/)

    // nodeBubble items sit one level deeper (inside sections) — the boot
    // check must reach them too.
    expect(() =>
      resolveFeatures([
        feature({
          id: 'y',
          nodeBubble: [
            { id: 'y', when: () => true, items: [{ id: 'y', label: 'Y', commandId: 'y.typo' }] },
          ],
        }),
      ]),
    ).toThrow(/nodeBubble "y".*y\.typo/)
  })

  it('rejects conflicting keymaps', () => {
    expect(() =>
      resolveFeatures([
        feature({ id: 'a', keymap: { 'Mod-k': 'a.cmd' } }),
        feature({ id: 'b', keymap: { 'Mod-k': 'b.cmd' } }),
      ]),
    ).toThrow(/Shortcut conflict/)
  })

  it('aggregates extensions and bubble contributions in order', () => {
    const resolved = resolveFeatures([
      feature({
        id: 'a',
        extensions: () => [{} as unknown as AnyExtension],
        commands: { 'a.cmd': () => true },
        bubble: [{ id: 'a', label: 'A', commandId: 'a.cmd' }],
      }),
      feature({
        id: 'b',
        extensions: () => [{} as unknown as AnyExtension, {} as unknown as AnyExtension],
        commands: { 'b.cmd': () => true },
        bubble: [{ id: 'b', label: 'B', commandId: 'b.cmd' }],
      }),
    ])
    expect(resolved.extensions).toHaveLength(3)
    expect(resolved.bubble.map((t) => t.id)).toEqual(['a', 'b'])
  })

  it('flattens nodeBubble sections in feature order and sorts items WITHIN a section by `order`', () => {
    const resolved = resolveFeatures([
      feature({
        id: 'image',
        commands: { 'image.a': () => true, 'image.b': () => true },
        nodeBubble: [
          {
            id: 'image',
            when: () => true,
            items: [
              { id: 'second', label: 'B', commandId: 'image.b', order: 2 },
              { id: 'first', label: 'A', commandId: 'image.a', order: 1 },
            ],
          },
        ],
      }),
      feature({
        id: 'divider',
        commands: { 'divider.a': () => true },
        nodeBubble: [
          { id: 'divider', when: () => false, items: [{ id: 'd', label: 'D', commandId: 'divider.a' }] },
        ],
      }),
    ])
    expect(resolved.nodeBubble.map((section) => section.id)).toEqual(['image', 'divider'])
    expect(resolved.nodeBubble[0].items.map((item) => item.id)).toEqual(['first', 'second'])
  })

  it('orders bubble items by their optional `order` (stable for ties)', () => {
    const resolved = resolveFeatures([
      feature({
        id: 'a',
        commands: { 'a.c': () => true },
        bubble: [{ id: 'a', label: 'A', commandId: 'a.c', order: 2 }],
      }),
      feature({
        id: 'b',
        commands: { 'b.c': () => true },
        bubble: [{ id: 'b', label: 'B', commandId: 'b.c', order: 1 }],
      }),
    ])
    expect(resolved.bubble.map((t) => t.id)).toEqual(['b', 'a'])
  })
})

describe('per-channel item-id uniqueness (boot fail-fast)', () => {
  it('throws when two features contribute the SAME bubble/insert item id', () => {
    // Every registry surface keys React children by item id — a collision
    // composes without error and mis-reconciles the bars.
    const a = feature({ id: 'a', commands: { 'a.run': () => true },
      bubble: [{ id: 'dup', label: 'A', commandId: 'a.run' }] })
    const b = feature({ id: 'b', commands: { 'b.run': () => true },
      bubble: [{ id: 'dup', label: 'B', commandId: 'b.run' }] })
    expect(() => resolveFeatures([a, b])).toThrow(/duplicate.*bubble "dup"/i)

    const c = feature({ id: 'c', commands: { 'c.run': () => true },
      insert: [{ id: 'image', label: 'C', commandId: 'c.run' }] })
    const d = feature({ id: 'd', commands: { 'd.run': () => true },
      insert: [{ id: 'image', label: 'D', commandId: 'd.run' }] })
    expect(() => resolveFeatures([c, d])).toThrow(/duplicate.*insert "image"/i)
  })

  it('throws on duplicate nodeBubble ids — sections AND items across sections', () => {
    const s1 = feature({ id: 'n1', commands: { 'n1.run': () => true },
      nodeBubble: [{ id: 'sec', when: () => true, items: [{ id: 'n1', label: 'A', commandId: 'n1.run' }] }] })
    const s2 = feature({ id: 'n2', commands: { 'n2.run': () => true },
      nodeBubble: [{ id: 'sec', when: () => true, items: [{ id: 'n2', label: 'B', commandId: 'n2.run' }] }] })
    expect(() => resolveFeatures([s1, s2])).toThrow(/duplicate.*nodeBubble section "sec"/i)

    // Item ids collide ACROSS sections too: two sections can match the same
    // node at once, and their items land keyed in ONE bar.
    const i1 = feature({ id: 'i1', commands: { 'i1.run': () => true },
      nodeBubble: [{ id: 'a', when: () => true, items: [{ id: 'dup', label: 'A', commandId: 'i1.run' }] }] })
    const i2 = feature({ id: 'i2', commands: { 'i2.run': () => true },
      nodeBubble: [{ id: 'b', when: () => true, items: [{ id: 'dup', label: 'B', commandId: 'i2.run' }] }] })
    expect(() => resolveFeatures([i1, i2])).toThrow(/duplicate.*nodeBubble "dup"/i)
  })

  it('throws on duplicate pageRegion and contextMenu SECTION ids across features', () => {
    const r1 = feature({ id: 'r1', commands: { 'r1.add': () => true },
      pageRegions: [{ id: 'header', position: 'top', label: 'H', nodeName: 'x', addCommandId: 'r1.add' }] })
    const r2 = feature({ id: 'r2', commands: { 'r2.add': () => true },
      pageRegions: [{ id: 'header', position: 'top', label: 'H2', nodeName: 'y', addCommandId: 'r2.add' }] })
    expect(() => resolveFeatures([r1, r2])).toThrow(/duplicate.*pageRegion "header"/i)

    // Group/item keys are namespaced BY section id — reuse collapses that.
    const s1 = feature({ id: 's1', contextMenu: [{ id: 'sec', when: () => true, groups: [] }] })
    const s2 = feature({ id: 's2', contextMenu: [{ id: 'sec', when: () => true, groups: [] }] })
    expect(() => resolveFeatures([s1, s2])).toThrow(/duplicate.*contextMenu section "sec"/i)
  })

  it('a feature listed twice (dedup path) is NOT a duplicate-id error', () => {
    const a = feature({ id: 'a', commands: { 'a.run': () => true },
      bubble: [{ id: 'a', label: 'A', commandId: 'a.run' }] })
    expect(() => resolveFeatures([a, a])).not.toThrow()
  })
})
