import { describe, expect, it } from 'vitest'
import { bubbleToolbarStyles } from './BubbleToolbar.styles'
import { documentEditorStyles } from './DocumentEditor.styles'
import { slashMenuStyles } from './SlashMenu.styles'
import { variableStyles } from '../../features/custom/variable.styles'

describe('chrome styles contracts', () => {
  it('the bubble stacks ABOVE the fixed header/footer bars — z-index is inert without position', () => {
    // The class lands on BubbleMenu's inner STATIC div (the positioned wrapper
    // is TipTap's, classless). Dropping `position: relative` silently sends
    // the bubble back UNDER the z-900 bars.
    const rule = bubbleToolbarStyles.styles.match(/\.bubble-toolbar\s*\{[^}]*\}/)?.[0]
    expect(rule).toBeDefined()
    expect(rule).toContain('position: relative')
    expect(rule).toContain('z-index: var(--editor-z-popup)')
  })

  it('popup stacking is declared ONCE — the .document-editor-popup base rule, not per surface', () => {
    // The base rule stacks every body-portaled surface at --editor-z-popup;
    // re-declaring it per popup is drift waiting to disagree.
    expect(slashMenuStyles.styles).not.toContain('--editor-z-popup')
    expect(variableStyles.styles).not.toContain('--editor-z-popup')
  })

  it('the zoomed-OUT page stays viewport-centered — auto margins absorb the free space', () => {
    // Without them the fixed-width scale block left-pins in its column flexbox
    // at zoom < 1 (up to (1-zoom)*page-width/2 off-center). Auto margins
    // resolve to 0 with negative free space, so zoom > 1 keeps its overflow.
    const rule = documentEditorStyles.styles.match(/\.document-editor__scale\s*\{[^}]*\}/)?.[0]
    expect(rule).toBeDefined()
    expect(rule).toContain('margin: 0 auto')
  })
})
