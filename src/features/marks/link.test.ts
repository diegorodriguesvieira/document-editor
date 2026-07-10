import { describe, expect, it } from 'vitest'
import { docWith, renderEditor } from '../../test/editorHarness'
import { LinkFeature } from './link'

describe('link commands', () => {
  it('link.insert with a text+href payload inserts a linked run', () => {
    const created = renderEditor([LinkFeature], { content: docWith('base') })
    expect(created.api.exec('link.insert', { text: 'Docs', href: 'https://docs.example' })).toBe(
      true,
    )
    expect(created.api.getHTML()).toMatch(
      /<a [^>]*href="https:\/\/docs\.example"[^>]*>Docs<\/a>/,
    )
  })

  it('link.insert needs BOTH text and href — a missing field aborts cleanly', () => {
    const created = renderEditor([LinkFeature], { content: docWith('base') })
    const before = created.api.getHTML()

    expect(created.api.exec('link.insert', { text: 'Docs' })).toBe(false) // no href
    expect(created.api.exec('link.insert', { href: 'https://docs.example' })).toBe(false) // no text
    expect(created.api.exec('link.insert', {})).toBe(false)

    expect(created.api.getHTML()).toBe(before)
  })

  it('link.insert enforces href validation — script URLs never persist', () => {
    const created = renderEditor([LinkFeature], { content: docWith('base') })
    const before = created.api.getHTML()

    // insertContent applies mark attrs unchecked; the command routes href
    // through the Link extension's isAllowedUri gate so the raw-JSON insert
    // path is never a bypass into the document JSON.
    expect(created.api.exec('link.insert', { text: 'x', href: 'javascript:alert(1)' })).toBe(false)
    expect(created.api.exec('link.insert', { text: 'x', href: 'vbscript:msgbox' })).toBe(false)

    expect(created.api.getHTML()).toBe(before)
    expect(JSON.stringify(created.api.getJSON())).not.toContain('javascript:')
  })

  it('link.openInsert no-ops (returns false) when no insert dock is mounted to open', () => {
    // The command is a UI bridge: with no LinkInsertControl mounted, the bridge
    // has no opener, so Mod-k is left unhandled rather than silently swallowed.
    const created = renderEditor([LinkFeature], { content: docWith('x') })
    expect(created.api.exec('link.openInsert')).toBe(false)
  })
})
