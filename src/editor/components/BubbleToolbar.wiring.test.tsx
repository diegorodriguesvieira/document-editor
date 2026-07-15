import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { BubbleToolbar } from './BubbleToolbar'
import { defineFeature } from '../core/defineFeature'
import { renderEditor } from '../../test/editorHarness'

/* Wiring pins for the props we hand TipTap's BubbleMenu — mocked here so the
   contract is deterministic (the real plugin only appends its element on the
   first show(), which needs layout jsdom doesn't do). */

const captured = vi.hoisted(() => [] as Array<Record<string, unknown>>)

vi.mock('@tiptap/react/menus', () => ({
  BubbleMenu: (props: Record<string, unknown>) => {
    captured.push(props)
    return <div data-testid="bubble-menu-mock" className={props.className as string} />
  },
}))

const bold = defineFeature({
  id: 'bold',
  extensions: () => [],
  commands: { 'bold.toggle': () => true },
  bubble: [{ id: 'bold', group: 'marks', label: 'Bold', commandId: 'bold.toggle' }],
})

describe('<BubbleToolbar /> → BubbleMenu wiring', () => {
  it('portals the bubble to document.body — OUTSIDE the zoomed page subtree', () => {
    // Inside the subtree, CSS `zoom` scales the bubble and feeds Floating UI
    // zoom-unaware rects: oversized, drifting bubble at any zoom ≠ 1. Every
    // other floating surface already portals to body; the bubble must too.
    const { editor, api, resolved } = renderEditor([bold])
    render(<BubbleToolbar editor={editor} api={api} resolved={resolved} />)
    const appendTo = captured.at(-1)?.appendTo as () => HTMLElement
    expect(appendTo()).toBe(document.body)
  })

  it("keeps the FUNCTIONAL popup namespace even under a consumer className (the region gate's marker)", () => {
    // headerFooter's gate keeps an open region open for clicks inside any
    // '.document-editor-popup' surface — a consumer className must compose
    // with the marker, not replace it.
    const { editor, api, resolved } = renderEditor([bold])
    render(<BubbleToolbar editor={editor} api={api} resolved={resolved} />)
    expect(captured.at(-1)?.className).toBe('document-editor-popup bubble-toolbar')

    render(
      <BubbleToolbar editor={editor} api={api} resolved={resolved} className="my-bubble" />,
    )
    expect(captured.at(-1)?.className).toBe('document-editor-popup my-bubble')
  })
})
