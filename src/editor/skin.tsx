import { Global } from '@emotion/react'

/* Tokens + reset */
import { baseStyles } from './base.styles'

/* Editor shell + components */
import { documentEditorStyles } from './components/DocumentEditor.styles'
import { insertToolbarStyles } from './components/InsertToolbar.styles'
import { bubbleToolbarStyles } from './components/BubbleToolbar.styles'

/* In-page block & mark styling */
import { headingStyles } from '../features/blocks/heading.styles'
import { linkStyles } from '../features/marks/link.styles'
import { tableStyles } from '../features/blocks/table.styles'
import { blockquoteStyles } from '../features/blocks/blockquote.styles'
import { codeBlockStyles } from '../features/blocks/codeBlock.styles'
import { dividerStyles } from '../features/blocks/divider.styles'
import { imageStyles } from '../features/blocks/image.styles'

/* Custom node views */
import { calloutStyles } from '../features/custom/callout.styles'
import { variableStyles } from '../features/custom/variable.styles'
import { conditionalBlockStyles } from '../features/custom/conditionalBlock.styles'

/* Floating surfaces (portal to <body>) */
import { slashMenuStyles } from './components/SlashMenu.styles'

/* Page regions + remaining features */
import { pageAffordancesStyles } from './components/PageAffordances.styles'
import { headerFooterStyles } from '../features/custom/headerFooter.styles'
import { commentsStyles } from '../features/custom/comments.styles'
import { commentsPanelStyles } from '../features/custom/commentsPanel.styles'
import { colorStyles } from '../features/custom/color.styles'

/**
 * Default skin for the document editor SDK — the Emotion successor of the old
 * `editor.css` single import (the SDK ships no .css files; every partial lives
 * as a `*.styles.ts` module next to its source, e.g. `custom/callout.styles.ts`
 * beside `custom/callout.tsx`).
 *
 * Array order = the old `editor.css` @import order, top to bottom, so any
 * same-specificity rules keep their cascade. The styles are unlayered (Emotion
 * injects plain rules): consumer overrides compete on normal specificity and
 * source order now — the `--editor-*` tokens (see `base.styles.ts` / THEMING.md)
 * remain the supported theming interface.
 *
 * MODULE-SCOPE constant: serialized once, injected once per mounted <Global>.
 * Never build this array (or any styles) inside a render — that's the
 * CSS-in-JS performance trap.
 */
const SKIN = [
  baseStyles,
  documentEditorStyles,
  insertToolbarStyles,
  bubbleToolbarStyles,
  headingStyles,
  linkStyles,
  tableStyles,
  blockquoteStyles,
  codeBlockStyles,
  dividerStyles,
  imageStyles,
  calloutStyles,
  variableStyles,
  conditionalBlockStyles,
  slashMenuStyles,
  pageAffordancesStyles,
  headerFooterStyles,
  commentsStyles,
  commentsPanelStyles,
  colorStyles,
]

/**
 * Mounts the SDK skin. `DocumentEditor` renders one automatically; custom
 * shells that assemble the exported components themselves (BubbleBar,
 * CommentsPanel, …) should render `<EditorSkin />` once near their root and
 * wrap themselves in `<EditorThemeProvider>` (theme.tsx) for the MUI chrome.
 * Duplicate mounts are harmless (identical rules).
 */
export function EditorSkin() {
  return <Global styles={SKIN} />
}
