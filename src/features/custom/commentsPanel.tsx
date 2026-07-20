import { useEffect, useRef, useState } from 'react'
import Avatar from '@mui/material/Avatar'
import Button from '@mui/material/Button'
import ButtonBase from '@mui/material/ButtonBase'
import IconButton from '@mui/material/IconButton'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import Paper from '@mui/material/Paper'
import TextField from '@mui/material/TextField'
import MoreVert from '@mui/icons-material/MoreVert'
import type { Editor } from '@tiptap/core'
import { POPUP_CLASS, useDismissable, useEscapeSurface } from '../../editor'
import { useComments, type CommentUser, type DocumentComment } from './commentsProvider'

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((word) => word[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

/** Consumer-provided user → src/initials avatar; no user → MUI's generic one. */
function UserAvatar({ user }: { user: CommentUser | null }) {
  if (!user) return <Avatar className="comments-panel__avatar" alt="Anonymous" />
  return (
    <Avatar className="comments-panel__avatar" src={user.avatarUrl} alt={user.name}>
      {initials(user.name)}
    </Avatar>
  )
}

/** Collapse the document selection (read-only: no focus involved). */
function collapseSelectionAt(editor: Editor | null, pos: number) {
  if (!editor || editor.isDestroyed) return
  editor.commands.setTextSelection(Math.max(0, Math.min(pos, editor.state.doc.content.size)))
}

/**
 * The avatar + field row a captured draft opens. Cancel/Comment appear once
 * there is text; Enter sends, Shift+Enter breaks the line; Escape or a
 * mousedown anywhere outside the panel cancels — clicking away IS the
 * "never mind" gesture, exactly like Escape (both discard typed text).
 * Cancelling/sending also COLLAPSES the document selection — the still-live
 * range would summon the balloon right back.
 */
function Composer({ editor, draftTo }: { editor: Editor | null; draftTo: number }) {
  const context = useComments()
  const [text, setText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  const cancel = () => {
    context?.clearDraft()
    context?.setActiveId(null)
    collapseSelectionAt(editor, draftTo)
  }

  // The shared dismiss contract (outside mousedown + stack-coordinated
  // Escape) — the composer is a "floating surface" that happens to dock in
  // the panel. "Inside" is the whole PANEL (reading cards mid-draft is not
  // abandonment), plus portaled popups and the modal backdrop under them:
  // dismissing the card menu must not also throw the draft away.
  useDismissable(rootRef, cancel, {
    isOutsideClick: (target) => {
      const el = target instanceof Element ? target : target.parentElement
      return el == null || !el.closest(`.comments-panel, .${POPUP_CLASS}, .MuiBackdrop-root`)
    },
  })

  if (!context) return null

  const submit = async () => {
    if (text.trim() === '' || submitting) return
    setSubmitting(true)
    const saved = await context.addComment(text)
    setSubmitting(false)
    if (saved) collapseSelectionAt(editor, draftTo)
    // On failure the draft and text stay — the provider keeps the error.
  }

  return (
    <div ref={rootRef} className="comments-panel__composer">
      <UserAvatar user={context.user} />
      <div className="comments-panel__composer-main">
        <TextField
          multiline
          autoFocus
          fullWidth
          size="small"
          minRows={2}
          placeholder="Add a comment…"
          value={text}
          slotProps={{ htmlInput: { 'aria-label': 'Comment text' } }}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              void submit()
            }
            // Escape is owned by useDismissable above — global while the
            // draft lives, and it yields to newer surfaces (the card menu).
          }}
        />
        {text.trim() !== '' ? (
          <div className="comments-panel__composer-actions">
            <Button size="small" className="comments-panel__cancel" onClick={cancel}>
              Cancel
            </Button>
            <Button
              size="small"
              variant="contained"
              className="comments-panel__submit"
              disabled={submitting}
              onClick={() => void submit()}
            >
              Comment
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  )
}

/**
 * One comment: avatar + author + text. Clicking it scrolls the document to
 * the anchored range and lights it up (`comment--active`, via `activeId`).
 * The author's own comments carry a 3-dots menu with Delete.
 */
function CommentCard({ comment, editor }: { comment: DocumentComment; editor: Editor | null }) {
  const context = useComments()
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null)
  // The MODAL Menu owns its own dismissal; registering it keeps the open
  // composer's Escape (useDismissable) yielding while the menu is on top.
  useEscapeSurface(menuAnchor != null)
  const cardRef = useRef<HTMLLIElement>(null)
  const active = context?.activeId === comment.id
  // Clicking the HIGHLIGHT in the document activates this card — bring it
  // into the panel's scrolled viewport. (Optional chaining: jsdom has no
  // scrollIntoView.)
  useEffect(() => {
    if (active) cardRef.current?.scrollIntoView?.({ block: 'nearest' })
  }, [active])
  if (!context) return null
  const isOwn = context.user != null && comment.author.id === context.user.id

  const jump = () => {
    context.setActiveId(comment.id)
    if (!editor || editor.isDestroyed) return
    // A COLLAPSED caret — selecting the whole range would summon the
    // "Add comment" balloon over the very comment being read.
    editor
      .chain()
      .setTextSelection(Math.max(0, Math.min(comment.from, editor.state.doc.content.size)))
      .run()
    // PM's own scrollIntoView is a NO-OP here: prosemirror-view bails out of
    // scrollToSelection while the DOM focus sits outside the view — and it
    // does, the user just clicked this panel. Scroll the highlight span
    // itself instead (it exists: the setTextSelection dispatch above just
    // re-derived the decorations). Optional-chained: jsdom has no
    // scrollIntoView.
    const escaped = globalThis.CSS?.escape?.(comment.id) ?? comment.id
    editor.view.dom
      .querySelector(`[data-comment-id="${escaped}"]`)
      ?.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
  }

  return (
    <li
      ref={cardRef}
      className={`comments-panel__card${active ? ' comments-panel__card--active' : ''}`}
    >
      <ButtonBase className="comments-panel__card-body" onClick={jump}>
        <span className="comments-panel__card-header">
          <UserAvatar user={comment.author} />
          <span className="comments-panel__author">{comment.author.name}</span>
        </span>
        <span className="comments-panel__text">{comment.text}</span>
      </ButtonBase>
      {isOwn ? (
        <>
          <IconButton
            size="small"
            className="comments-panel__menu"
            aria-label="Comment actions"
            onClick={(event) => setMenuAnchor(event.currentTarget)}
          >
            <MoreVert fontSize="inherit" />
          </IconButton>
          <Menu
            anchorEl={menuAnchor}
            open={menuAnchor != null}
            onClose={() => setMenuAnchor(null)}
            // The popup marker rides the PAPER (portal root), same as the
            // context menu — never the backdrop.
            slotProps={{ paper: { className: POPUP_CLASS } }}
          >
            <MenuItem
              onClick={() => {
                setMenuAnchor(null)
                void context.removeComment(comment.id)
              }}
            >
              Delete
            </MenuItem>
          </Menu>
        </>
      ) : null}
    </li>
  )
}

/**
 * The review-mode comments panel: the composer while a draft is being written
 * (the balloon captured a selection), then the comment cards — newest data
 * straight from the adapter, refetched after every mutation. Renders nothing
 * without a {@link CommentsProvider}, and nothing while there is neither a
 * draft nor any comment (the product rule the old panel had too).
 */
export function CommentsPanel({ editor }: { editor: Editor | null }) {
  const context = useComments()
  if (!context) return null
  const { comments, draft, error } = context
  if (!draft && comments.length === 0) return null

  return (
    <Paper component="aside" className="comments-panel" aria-label="Comments" elevation={0}>
      <div className="comments-panel__title">
        Comments{comments.length > 0 ? ` (${comments.length})` : ''}
      </div>
      {draft ? (
        // Keyed by the captured range: a new capture starts a FRESH composer.
        <Composer key={`${draft.from}:${draft.to}`} editor={editor} draftTo={draft.to} />
      ) : null}
      {error ? <div className="comments-panel__error">{error}</div> : null}
      {comments.length > 0 ? (
        <ul className="comments-panel__list">
          {comments.map((comment) => (
            <CommentCard key={comment.id} comment={comment} editor={editor} />
          ))}
        </ul>
      ) : null}
    </Paper>
  )
}
