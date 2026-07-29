import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { NodeBubbleToolbar } from './NodeBubbleToolbar'
import { DocumentEditor } from './DocumentEditor'
import { BoldFeature, ImageFeature } from '../../features'
import { renderEditor } from '../../test/editorHarness'

/* Wiring pins for the props we hand TipTap's BubbleMenu — mocked here so the
   contract is deterministic (the real plugin only appends its element on the
   first show(), which needs layout jsdom doesn't do). Same idiom as the text
   bubble's wiring test. */

const captured = vi.hoisted(() => [] as Array<Record<string, unknown>>)

vi.mock('@tiptap/react/menus', () => ({
  BubbleMenu: (props: Record<string, unknown>) => {
    captured.push(props)
    return <div data-testid="bubble-menu-mock" className={props.className as string} />
  },
}))

/** Only the NODE bubble's instances — DocumentEditor mounts the text bubble
 *  too (default pluginKey), and both land in the same capture array. */
const nodeBubbleMounts = () => captured.filter((props) => props.pluginKey === 'nodeBubbleMenu')

describe('<NodeBubbleToolbar /> → BubbleMenu wiring', () => {
  it('own plugin instance, body portal, bottom placement — beside the text bubble, clear of the handles', () => {
    const { editor, api, resolved } = renderEditor([ImageFeature])
    render(<NodeBubbleToolbar editor={editor} api={api} resolved={resolved} />)

    const props = captured.at(-1)!
    // A second BubbleMenu needs its OWN pluginKey or it clashes with the text
    // bubble's default instance.
    expect(props.pluginKey).toBe('nodeBubbleMenu')
    // Portal to body: inside the zoomed page subtree, Floating UI gets
    // zoom-unaware rects (mispositioned bubble at any zoom ≠ 1).
    expect((props.appendTo as () => HTMLElement)()).toBe(document.body)
    // Below the node — on top it would sit on an image's resize handles.
    expect((props.options as { placement: string }).placement).toBe('bottom')
    // No debounce: TipTap's 250ms default exists for drag-selections; a NODE
    // bubble must follow an alignment change in the SAME frame.
    expect(props.updateDelay).toBe(0)
  })

  it("keeps the FUNCTIONAL popup namespace even under a consumer className (the region gate's marker)", () => {
    const { editor, api, resolved } = renderEditor([ImageFeature])
    render(<NodeBubbleToolbar editor={editor} api={api} resolved={resolved} />)
    expect(captured.at(-1)?.className).toBe('document-editor-popup bubble-toolbar node-bubble-toolbar')

    render(<NodeBubbleToolbar editor={editor} api={api} resolved={resolved} className="my-bubble" />)
    expect(captured.at(-1)?.className).toBe('document-editor-popup my-bubble')
  })
})

describe('<DocumentEditor /> node bubble surface', () => {
  it('mounts the node bubble by DEFAULT when a feature contributes sections', async () => {
    captured.length = 0
    render(<DocumentEditor features={[ImageFeature]} />)
    await waitFor(() => expect(document.querySelector('.ProseMirror')).not.toBeNull())
    expect(nodeBubbleMounts().length).toBeGreaterThan(0)
  })

  it('mounts NO node bubble when no feature contributes sections', async () => {
    captured.length = 0
    render(<DocumentEditor features={[BoldFeature]} />)
    await waitFor(() => expect(document.querySelector('.ProseMirror')).not.toBeNull())
    expect(nodeBubbleMounts()).toHaveLength(0)
  })

  it('renderNodeBubble replaces the default surface (the swap seam), with the render context', async () => {
    captured.length = 0
    render(
      <DocumentEditor
        features={[ImageFeature]}
        renderNodeBubble={(ctx) => <div>my bubble {String(Boolean(ctx.api))}</div>}
      />,
    )
    expect(await screen.findByText('my bubble true')).toBeInTheDocument()
    expect(nodeBubbleMounts()).toHaveLength(0) // the default did NOT mount
  })
})
