import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { BubbleBar, InsertToolbar } from '../editor'
import { docWith, jsonHasNode, renderEditor } from '../test/editorHarness'
import { CommentsFeature } from './custom/comments'
import { getCommentThreads } from './custom/comments'
import { ImageFeature } from './blocks/image'
import { LinkFeature } from './marks/link'

/**
 * The MUI forms that replaced window.prompt. The COMMANDS are untouched
 * (payload-driven, promptOr as headless fallback) — these tests pin the form
 * → payload → exec wiring end-to-end against a real editor.
 */

describe('link forms', () => {
  it('dock Link action collects text + URL and inserts the linked run', async () => {
    const user = userEvent.setup()
    const created = renderEditor([LinkFeature])
    render(
      <InsertToolbar
        editor={created.editor}
        api={created.api}
        resolved={created.resolved}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Link' }))
    await user.type(screen.getByRole('textbox', { name: 'Link text' }), 'Docs')
    await user.type(screen.getByRole('textbox', { name: 'Link URL' }), 'https://docs.example')
    await user.click(screen.getByRole('button', { name: 'Insert' }))

    const html = created.api.getHTML()
    expect(html).toContain('>Docs</a>')
    expect(html).toContain('href="https://docs.example"')
  })

  it('pre-fills the Text field with the selected run — you only add the URL', async () => {
    const user = userEvent.setup()
    const created = renderEditor([LinkFeature], { content: docWith('read the docs here') })
    created.editor.commands.setTextSelection({ from: 6, to: 9 }) // "the"
    render(
      <InsertToolbar
        editor={created.editor}
        api={created.api}
        resolved={created.resolved}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Link' }))
    // Selected text arrives in the input — no re-typing.
    expect(screen.getByRole('textbox', { name: 'Link text' })).toHaveValue('the')
    await user.type(screen.getByRole('textbox', { name: 'Link URL' }), 'https://docs.example')
    await user.click(screen.getByRole('button', { name: 'Insert' }))

    expect(created.api.getHTML()).toContain('href="https://docs.example"')
    expect(created.api.getHTML()).toContain('>the</a>')
  })

  it('selecting an existing link pre-fills BOTH text and its URL for editing', async () => {
    const user = userEvent.setup()
    const created = renderEditor([LinkFeature], { content: docWith('visit the site') })
    // Link the "the" run, then select it again to open the form over the link.
    created.editor
      .chain()
      .setTextSelection({ from: 7, to: 10 })
      .setLink({ href: 'https://old.example' })
      .run()
    created.editor.commands.setTextSelection({ from: 7, to: 10 })
    render(
      <InsertToolbar
        editor={created.editor}
        api={created.api}
        resolved={created.resolved}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Link' }))
    expect(screen.getByRole('textbox', { name: 'Link text' })).toHaveValue('the')
    expect(screen.getByRole('textbox', { name: 'Link URL' })).toHaveValue('https://old.example')

    // Edit just the URL and re-apply — the linked run is rewritten in place.
    const urlField = screen.getByRole('textbox', { name: 'Link URL' })
    await user.clear(urlField)
    await user.type(urlField, 'https://new.example')
    await user.click(screen.getByRole('button', { name: 'Insert' }))

    const html = created.api.getHTML()
    expect(html).toContain('href="https://new.example"')
    expect(html).not.toContain('old.example')
  })

  it('selecting only PART of a link edits the WHOLE link (no split)', async () => {
    const user = userEvent.setup()
    const created = renderEditor([LinkFeature], { content: docWith('go docs now') })
    // Link "docs" → old URL, then select just "do" inside it.
    created.editor
      .chain()
      .setTextSelection({ from: 4, to: 8 })
      .setLink({ href: 'https://old.example' })
      .run()
    created.editor.commands.setTextSelection({ from: 4, to: 6 }) // "do"
    render(
      <InsertToolbar
        editor={created.editor}
        api={created.api}
        resolved={created.resolved}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Link' }))
    // The form opens over the FULL link, not the partial selection.
    expect(screen.getByRole('textbox', { name: 'Link text' })).toHaveValue('docs')
    expect(screen.getByRole('textbox', { name: 'Link URL' })).toHaveValue('https://old.example')

    const urlField = screen.getByRole('textbox', { name: 'Link URL' })
    await user.clear(urlField)
    await user.type(urlField, 'https://new.example')
    await user.click(screen.getByRole('button', { name: 'Insert' }))

    const html = created.api.getHTML()
    // One rewritten link, nothing left pointing at the old URL.
    expect(html).toContain('>docs</a>')
    expect(html).toContain('href="https://new.example"')
    expect(html).not.toContain('old.example')
  })

  it('a rejected submit (unsafe URL) keeps the form OPEN — no silent drop', async () => {
    const user = userEvent.setup()
    const created = renderEditor([LinkFeature])
    render(
      <InsertToolbar
        editor={created.editor}
        api={created.api}
        resolved={created.resolved}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Link' }))
    await user.type(screen.getByRole('textbox', { name: 'Link text' }), 'x')
    await user.type(screen.getByRole('textbox', { name: 'Link URL' }), 'javascript:alert(1)')
    await user.click(screen.getByRole('button', { name: 'Insert' }))

    expect(created.api.getHTML()).not.toContain('javascript:')
    expect(screen.getByRole('dialog', { name: 'Insert link' })).toBeInTheDocument()
  })

  it('Mod-k opens the SAME insert-link form (the keyboard shortcut, no bubble bar)', () => {
    const created = renderEditor([LinkFeature])
    render(
      <InsertToolbar
        editor={created.editor}
        api={created.api}
        resolved={created.resolved}
      />,
    )
    created.editor.commands.focus()
    expect(screen.queryByRole('dialog', { name: 'Insert link' })).toBeNull()

    // Mod = Ctrl in jsdom (non-mac); the registryKeymap routes it to
    // link.openInsert, which pops the mounted dock control's form.
    fireEvent.keyDown(created.editor.view.dom, { key: 'k', ctrlKey: true })

    expect(screen.getByRole('dialog', { name: 'Insert link' })).toBeInTheDocument()
  })

  it('Mod-k pre-fills the form with the selected run, same as the dock button', () => {
    const created = renderEditor([LinkFeature], { content: docWith('open the modal') })
    render(
      <InsertToolbar
        editor={created.editor}
        api={created.api}
        resolved={created.resolved}
      />,
    )
    created.editor.commands.focus()
    created.editor.commands.setTextSelection({ from: 6, to: 9 }) // "the"

    fireEvent.keyDown(created.editor.view.dom, { key: 'k', ctrlKey: true })

    const dialog = screen.getByRole('dialog', { name: 'Insert link' })
    expect(within(dialog).getByRole('textbox', { name: 'Link text' })).toHaveValue('the')
  })
})

describe('image form', () => {
  it('collects the URL and inserts the image node', async () => {
    const user = userEvent.setup()
    const created = renderEditor([ImageFeature])
    render(
      <InsertToolbar
        editor={created.editor}
        api={created.api}
        resolved={created.resolved}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Image' }))
    await user.type(
      screen.getByRole('textbox', { name: 'Image URL' }),
      'https://example.com/a.png',
    )
    await user.click(screen.getByRole('button', { name: 'Insert' }))

    expect(jsonHasNode(created.api.getJSON().doc, 'image')).toBe(true)
    expect(screen.queryByRole('dialog', { name: 'Insert image' })).toBeNull()
  })
})

describe('comment form', () => {
  it('anchors the comment to the selection and stores the thread text', async () => {
    const user = userEvent.setup()
    const created = renderEditor([CommentsFeature], { content: docWith('review this line') })
    created.editor.commands.setTextSelection({ from: 1, to: 7 })
    render(
      <BubbleBar
        editor={created.editor}
        api={created.api}
        resolved={created.resolved}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Comment' }))
    const dialog = screen.getByRole('dialog', { name: 'Add comment' })
    await user.type(within(dialog).getByRole('textbox', { name: 'Comment text' }), 'tighten the wording')
    // Two buttons share the name (the bar toggle + the submit) — scope
    // the click to the form.
    await user.click(within(dialog).getByRole('button', { name: 'Comment' }))

    expect(created.api.getHTML()).toContain('class="comment"')
    const threads = getCommentThreads(created.editor)
    expect([...(threads?.values() ?? [])].some((t) => t.text === 'tighten the wording')).toBe(true)
  })
})
