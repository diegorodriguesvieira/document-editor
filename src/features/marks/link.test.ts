import { afterEach, describe, expect, it, vi } from 'vitest'
import { docWith, renderEditor } from '../../test/editorHarness'
import { LinkFeature } from './link'

/** The commands fall back to window.prompt when no payload is given (the
 *  placeholder UI). jsdom has no prompt — stub it per test. */
function stubPrompt(...answers: Array<string | null>) {
  const prompt = vi.fn()
  for (const answer of answers) prompt.mockReturnValueOnce(answer)
  vi.stubGlobal('prompt', prompt)
  return prompt
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('link commands', () => {
  const linked = () => {
    const created = renderEditor([LinkFeature], { content: docWith('hello world') })
    created.editor.commands.setTextSelection({ from: 1, to: 6 }) // "hello"
    expect(created.api.exec('link.set', 'https://old.example')).toBe(true)
    return created
  }

  it('link.set with a payload wraps the selection', () => {
    const created = linked()
    expect(created.api.getHTML()).toContain('href="https://old.example"')
    expect(created.api.getHTML()).toMatch(/<a [^>]*>hello<\/a>/)
  })

  it('link.set from a CARET inside a link retargets the WHOLE mark (the edit-link flow)', () => {
    const created = linked()
    created.editor.commands.setTextSelection(3) // caret inside "hello", nothing selected

    expect(created.api.exec('link.set', 'https://new.example')).toBe(true)

    // extendMarkRange: the entire linked run moved to the new URL — not just
    // an empty caret-width mark.
    const html = created.api.getHTML()
    expect(html).toMatch(/<a [^>]*href="https:\/\/new\.example"[^>]*>hello<\/a>/)
    expect(html).not.toContain('https://old.example')
  })

  it('link.set with an EMPTY prompt clears the link instead of linking to ""', () => {
    const created = linked()
    const prompt = stubPrompt(null) // user cancelled the dialog
    created.editor.commands.setTextSelection({ from: 1, to: 6 })

    expect(created.api.exec('link.set')).toBe(true) // ran as an unset

    expect(prompt).toHaveBeenCalledTimes(1)
    expect(created.api.getHTML()).not.toContain('<a ')
  })

  it('link.unset removes the mark from the selection', () => {
    const created = linked()
    created.editor.commands.setTextSelection({ from: 1, to: 6 })
    expect(created.api.exec('link.unset')).toBe(true)
    expect(created.api.getHTML()).not.toContain('<a ')
  })

  it('link.insert prompts for text AND url — cancelling either aborts cleanly', () => {
    const created = renderEditor([LinkFeature], { content: docWith('base') })
    const before = created.api.getHTML()

    stubPrompt(null) // cancelled at the text prompt
    expect(created.api.exec('link.insert')).toBe(false)
    expect(created.api.getHTML()).toBe(before)

    stubPrompt('click here', null) // cancelled at the URL prompt
    expect(created.api.exec('link.insert')).toBe(false)
    expect(created.api.getHTML()).toBe(before)

    stubPrompt('click here', 'https://docs.example')
    expect(created.api.exec('link.insert')).toBe(true)
    expect(created.api.getHTML()).toMatch(
      /<a [^>]*href="https:\/\/docs\.example"[^>]*>click here<\/a>/,
    )
  })
})
