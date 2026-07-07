import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef } from 'react'
import { describe, expect, it } from 'vitest'
import { DocumentEditor } from '../../editor'
import {
  DocumentVariablesProvider,
  LinkFeature,
  MergeFieldFeature,
  TableFeature,
} from '../../features'
import { editorFromDOM, jsonHasNode } from '../../test/editorHarness'
import { SlashMenu } from '../components/SlashMenu'
import type { SuggestionPopupRef } from './createSuggestionPopup'

/**
 * End-to-end exercise of the shared suggestion primitive through its two real
 * consumers: the `/` command menu (slashCommands) and the `@` variable menu
 * (mergeFieldSuggestion). Typing goes through the editor so the whole chain
 * runs: @tiptap/suggestion match → onStart/onUpdate popup lifecycle → keydown
 * routing via the imperative ref → command → onExit teardown.
 */
async function mountEditor(ui: React.ReactElement) {
  render(ui)
  const editor = await waitFor(() => editorFromDOM())
  const pm = editor.view.dom as HTMLElement
  // Every interaction re-renders React (the popup renders through the
  // EditorContent portals), so each runs inside act — and drains one frame,
  // because TipTap defers the DOM focus with requestAnimationFrame.
  const drained = (run: () => void) =>
    act(async () => {
      run()
      await new Promise((resolve) => requestAnimationFrame(resolve))
    })
  await drained(() => editor.commands.focus())
  const type = (text: string) => drained(() => editor.commands.insertContent(text))
  const keydown = (key: string) =>
    drained(() =>
      pm.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })),
    )
  return { editor, type, keydown }
}

const popup = () => document.body.querySelector('.suggestion-popup')

describe('createSuggestionPopup (the / menu, end to end)', () => {
  it('typing "/" mounts the popup on <body>, positioned under the caret', async () => {
    const { type } = await mountEditor(<DocumentEditor features={[TableFeature]} />)
    expect(popup()).toBeNull()

    await type('/')

    await waitFor(() => expect(popup()).not.toBeNull())
    const el = popup() as HTMLElement
    // Namespaced for the SDK skin + placed below the caret rect. jsdom rects
    // are all zeros, so the +6 gap IS the observable top.
    expect(el.className).toBe('document-editor-popup suggestion-popup')
    expect(el.style.position).toBe('fixed')
    expect(el.style.top).toBe('6px')
    // It mirrors the insert dock: the table insert shows up.
    expect(await screen.findByRole('option', { name: /Table/ })).toBeInTheDocument()
  })

  it('the query filters the dock items and Enter runs the pick where the "/query" was', async () => {
    const { editor, type, keydown } = await mountEditor(
      <DocumentEditor features={[TableFeature, LinkFeature]} />,
    )
    await type('/tab')

    // Only Table matches "tab" — the link insert is filtered out.
    await waitFor(() => expect(popup()).not.toBeNull())
    await waitFor(() => {
      expect(screen.queryByRole('option', { name: /Link/ })).toBeNull()
      expect(screen.getByRole('option', { name: /Table/ })).toBeInTheDocument()
    })

    await keydown('Enter')

    await waitFor(() => {
      // The insert really ran…
      expect(jsonHasNode(editor.getJSON(), 'table')).toBe(true)
      // …the "/tab" trigger text was consumed by deleteRange…
      expect(editor.getText()).not.toContain('/tab')
      // …and the popup tore down (onExit removed it from <body>).
      expect(popup()).toBeNull()
    })
  })

  it('Escape dismisses the popup without touching the document', async () => {
    const { editor, type, keydown } = await mountEditor(
      <DocumentEditor features={[TableFeature]} />,
    )
    await type('/')
    await waitFor(() => expect(popup()).not.toBeNull())

    await keydown('Escape')

    await waitFor(() => expect(popup()).toBeNull())
    // Only the key was consumed — the typed "/" stays in the paragraph.
    expect(editor.getText()).toContain('/')
    expect(jsonHasNode(editor.getJSON(), 'table')).toBe(false)
  })

  it('arrows move the highlight with wrap-around in BOTH directions', async () => {
    const { type, keydown } = await mountEditor(
      <DocumentEditor features={[TableFeature, LinkFeature]} />,
    )
    await type('/')
    await waitFor(() => expect(screen.queryAllByRole('option')).toHaveLength(2))
    const active = () =>
      screen
        .getAllByRole('option')
        .findIndex((option) => option.getAttribute('aria-selected') === 'true')

    expect(active()).toBe(0)
    await keydown('ArrowDown')
    expect(active()).toBe(1)
    await keydown('ArrowDown') // past the end → wraps to the top
    expect(active()).toBe(0)
    await keydown('ArrowUp') // before the start → wraps to the bottom
    expect(active()).toBe(1)
  })
})

describe('createSuggestionPopup (the @ variable menu)', () => {
  it('typing "@" lists the context variables; Enter swaps the "@query" for a chip + space', async () => {
    const { editor, type, keydown } = await mountEditor(
      <DocumentVariablesProvider
        variables={[
          { id: 'client.name', label: 'Client name' },
          { id: 'company.name', label: 'Company' },
        ]}
      >
        <DocumentEditor features={[MergeFieldFeature]} />
      </DocumentVariablesProvider>,
    )
    await type('@')

    // The popup owns filtering (context), not the plugin's items().
    await waitFor(() => expect(popup()).not.toBeNull())
    expect(await screen.findByRole('option', { name: /Client name/ })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /Company/ })).toBeInTheDocument()

    await keydown('Enter')

    await waitFor(() => {
      const paragraph = editor.getJSON().content?.[0]
      expect(paragraph?.content).toMatchObject([
        { type: 'mergeField', attrs: { id: 'client.name', label: 'Client name' } },
        { type: 'text', text: ' ' }, // trailing space so typing is not glued to the chip
      ])
      expect(popup()).toBeNull()
    })
  })
})

describe('useListKeyboardNav (the shared ref contract)', () => {
  const keyEvent = (key: string) => ({ event: new KeyboardEvent('keydown', { key }) })

  it('an empty list refuses every key — PM keeps its defaults', () => {
    const ref = createRef<SuggestionPopupRef>()
    render(<SlashMenu ref={ref} items={[]} command={() => {}} />)
    expect(screen.getByText('No results')).toBeInTheDocument()
    expect(ref.current!.onKeyDown(keyEvent('ArrowDown'))).toBe(false)
    expect(ref.current!.onKeyDown(keyEvent('Enter'))).toBe(false)
  })

  it('keys it does not own fall through', () => {
    const ref = createRef<SuggestionPopupRef>()
    render(
      <SlashMenu
        ref={ref}
        items={[{ id: 'x', label: 'X', commandId: 'x.run' }]}
        command={() => {}}
      />,
    )
    expect(ref.current!.onKeyDown(keyEvent('a'))).toBe(false)
    expect(ref.current!.onKeyDown(keyEvent('Tab'))).toBe(false)
    // ArrowDown moves the highlight — a state update, so inside act.
    let handled = false
    act(() => {
      handled = ref.current!.onKeyDown(keyEvent('ArrowDown'))
    })
    expect(handled).toBe(true)
  })
})

describe('Escape ordering across surfaces (innermost-first)', () => {
  it('closes the POPUP first — an older pinned panel survives the press', async () => {
    // The popup lives in TipTap plugin callbacks, not a useDismissable
    // component: without joining the Escape stack, the PANEL (older surface,
    // still top-of-stack) closed in its place, its preventDefault starved
    // ProseMirror, and the popup survived — exactly inverted.
    const user = userEvent.setup()
    const { type, keydown } = await mountEditor(
      <DocumentVariablesProvider variables={[{ id: 'client.name', label: 'Client name' }]}>
        <DocumentEditor features={[MergeFieldFeature]} />
      </DocumentVariablesProvider>,
    )
    await user.click(screen.getByRole('button', { name: 'Variables' }))
    await user.click(screen.getByRole('button', { name: 'Pin panel' }))
    expect(screen.getByRole('dialog', { name: 'Variables' })).toBeInTheDocument()

    await type('@')
    await waitFor(() => expect(popup()).not.toBeNull())

    await keydown('Escape')
    await waitFor(() => expect(popup()).toBeNull())
    // The pinned panel is untouched — only the innermost surface closed.
    expect(screen.getByRole('dialog', { name: 'Variables' })).toBeInTheDocument()

    // With the popup gone the panel is innermost again: Escape now closes IT.
    await keydown('Escape')
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Variables' })).toBeNull(),
    )
  })
})
