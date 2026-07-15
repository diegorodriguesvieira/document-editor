import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'
import TextField from '@mui/material/TextField'
import ToggleButton from '@mui/material/ToggleButton'
import {
  PopupShell,
  tokenVar,
  useFeatureState,
  type EditorStateView,
  type FeatureRenderContext,
} from '../editor'
import { icons } from './icons'
import { linkInsertBridge } from './marks/linkInsertBridge'

/**
 * Shared button-state predicates — the ONE definition each rule has. The
 * feature's bar item (`isActive`/`isDisabled`, driving the default-button
 * path and the mock seam) and the custom controls below both read these.
 */
export const commentAddActive = (state: EditorStateView) => state.isActive('comment')
export const commentAddDisabled = (state: EditorStateView) => state.isSelectionEmpty()

/**
 * The prop block every popup TRIGGER shares: accessible name, the
 * haspopup/expanded pair, selection-preserving mousedown, and the toggle.
 * Site-specific props (ToggleButton value/selected, refs, classNames) stay
 * at the site.
 */
export function popupTriggerProps(
  label: string,
  open: boolean,
  toggle: () => void,
  haspopup: 'dialog' | 'menu' = 'dialog',
) {
  return {
    title: label,
    'aria-label': label,
    'aria-haspopup': haspopup,
    'aria-expanded': open,
    onMouseDown: (event: React.MouseEvent<HTMLButtonElement>) => event.preventDefault(),
    onClick: toggle,
  }
}

/**
 * The chrome forms that replaced `window.prompt` (link/image/comment), on the
 * SDK's non-modal {@link PopupShell}. The commands themselves are unchanged —
 * the form collects the payload and `api.exec`s it (`promptOr` remains the
 * headless/keymap fallback).
 */
function FormPopover({
  anchor,
  open,
  label,
  submitLabel = 'Apply',
  onClose,
  onSubmit,
  children,
}: {
  anchor: HTMLElement | null
  open: boolean
  label: string
  submitLabel?: string
  onClose: () => void
  onSubmit: () => void
  children: ReactNode
}) {
  return (
    <PopupShell
      anchorEl={anchor}
      open={open}
      onClose={onClose}
      surfaceClassName="form-popover"
      role="dialog"
      ariaLabel={label}
      offset={[0, 6]}
      paperProps={{
        component: 'form',
        className: 'form-popover__card',
        sx: {
          p: 1.5,
          display: 'flex',
          flexDirection: 'column',
          gap: 1.5,
          width: 300,
          border: `1px solid ${tokenVar('--editor-border')}`,
        },
        onSubmit: (event: React.FormEvent) => {
          event.preventDefault()
          onSubmit()
        },
      }}
    >
      {children}
      <Button type="submit" variant="contained" size="small" sx={{ alignSelf: 'flex-end' }}>
        {submitLabel}
      </Button>
    </PopupShell>
  )
}

/** Insert a brand-new linked text run (the dock's Link action). */
function LinkInsertControl({ editor, api }: FeatureRenderContext) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [href, setHref] = useState('')
  const buttonRef = useRef<HTMLButtonElement>(null)

  // Open with the current selection pre-filled: the selected run becomes the
  // link text, and when it's ALREADY a link its href pre-fills the URL — so
  // selecting a link opens the form ready to edit both fields. When only PART
  // (or none) of a link is selected, extend to the mark's full range first, so
  // `link.insert`'s replace rewrites the whole link in place instead of
  // splitting it. Empty, non-link selection → blank fields (you type both).
  const openWithSelection = useCallback(() => {
    if (editor) {
      const href = editor.getAttributes('link').href
      if (typeof href === 'string') editor.commands.extendMarkRange('link')
      const { from, to, empty } = editor.state.selection
      setText(empty ? '' : editor.state.doc.textBetween(from, to, ' '))
      setHref(typeof href === 'string' ? href : '')
    }
    setOpen(true)
  }, [editor])

  // Let the Mod-k shortcut (the `link.openInsert` command) pop THIS same form,
  // pre-filled the same way: park an opener in the bridge storage while
  // mounted, clear it on unmount.
  useEffect(() => {
    if (!editor) return
    const bridge = linkInsertBridge(editor)
    bridge.open = openWithSelection
    return () => {
      bridge.open = null
    }
  }, [editor, openWithSelection])

  const reset = () => {
    setOpen(false)
    setText('')
    setHref('')
  }
  return (
    <>
      <IconButton
        ref={buttonRef}
        className="insert-dock__btn"
        {...popupTriggerProps('Link', open, () => (open ? reset() : openWithSelection()))}
      >
        {icons.link}
      </IconButton>
      <FormPopover
        anchor={buttonRef.current}
        open={open}
        label="Insert link"
        submitLabel="Insert"
        onClose={reset}
        onSubmit={() => {
          if (api.exec('link.insert', { text, href })) reset()
        }}
      >
        <TextField
          label="Text"
          value={text}
          autoFocus={!text}
          slotProps={{ htmlInput: { 'aria-label': 'Link text' } }}
          onChange={(event) => setText(event.target.value)}
        />
        <TextField
          label="URL"
          value={href}
          autoFocus={!!text}
          slotProps={{ htmlInput: { 'aria-label': 'Link URL' } }}
          onChange={(event) => setHref(event.target.value)}
        />
      </FormPopover>
    </>
  )
}

/** Insert an image by URL (the dock's Image action). */
function ImageInsertControl({ api }: FeatureRenderContext) {
  const [open, setOpen] = useState(false)
  const [src, setSrc] = useState('')
  const buttonRef = useRef<HTMLButtonElement>(null)

  const reset = () => {
    setOpen(false)
    setSrc('')
  }
  return (
    <>
      <IconButton
        ref={buttonRef}
        className="insert-dock__btn"
        {...popupTriggerProps('Image', open, () => setOpen((value) => !value))}
      >
        {icons.image}
      </IconButton>
      <FormPopover
        anchor={buttonRef.current}
        open={open}
        label="Insert image"
        submitLabel="Insert"
        onClose={reset}
        onSubmit={() => {
          if (api.exec('image.insert', src)) reset()
        }}
      >
        <TextField
          label="Image URL"
          value={src}
          autoFocus
          helperText="http(s) or data: URLs"
          slotProps={{ htmlInput: { 'aria-label': 'Image URL' } }}
          onChange={(event) => setSrc(event.target.value)}
        />
      </FormPopover>
    </>
  )
}

/** Anchor a comment to the current selection (the bubble's Comment button). */
function CommentAddControl({ editor, api }: FeatureRenderContext) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const buttonRef = useRef<HTMLButtonElement>(null)
  const active = useFeatureState(editor, () => commentAddActive(api)) ?? false
  const disabled = useFeatureState(editor, () => commentAddDisabled(api)) ?? true

  const reset = () => {
    setOpen(false)
    setText('')
  }
  return (
    <>
      <ToggleButton
        ref={buttonRef}
        value="comment"
        selected={active}
        disabled={disabled}
        {...popupTriggerProps('Comment', open, () => setOpen((value) => !value))}
      >
        {icons.comment}
      </ToggleButton>
      <FormPopover
        anchor={buttonRef.current}
        open={open}
        label="Add comment"
        submitLabel="Comment"
        onClose={reset}
        onSubmit={() => {
          if (api.exec('comment.add', { text })) reset()
        }}
      >
        <TextField
          label="Comment"
          value={text}
          autoFocus
          multiline
          minRows={2}
          slotProps={{ htmlInput: { 'aria-label': 'Comment text' } }}
          onChange={(event) => setText(event.target.value)}
        />
      </FormPopover>
    </>
  )
}

/* Plain-function faces so .ts feature files can wire `render` without JSX. */
export const renderLinkInsertControl = (ctx: FeatureRenderContext) => (
  <LinkInsertControl {...ctx} />
)
export const renderImageInsertControl = (ctx: FeatureRenderContext) => (
  <ImageInsertControl {...ctx} />
)
export const renderCommentAddControl = (ctx: FeatureRenderContext) => (
  <CommentAddControl {...ctx} />
)
