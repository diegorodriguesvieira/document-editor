import { useEffect, useRef, useState } from 'react'
import Avatar from '@mui/material/Avatar'
import Button from '@mui/material/Button'
import ButtonBase from '@mui/material/ButtonBase'
import CircularProgress from '@mui/material/CircularProgress'
import IconButton from '@mui/material/IconButton'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import Paper from '@mui/material/Paper'
import Tab from '@mui/material/Tab'
import Tabs from '@mui/material/Tabs'
import TextField from '@mui/material/TextField'
import Tooltip from '@mui/material/Tooltip'
import Check from '@mui/icons-material/Check'
import MoreVert from '@mui/icons-material/MoreVert'
import Schedule from '@mui/icons-material/Schedule'
import type { Editor } from '@tiptap/core'
import { POPUP_CLASS, useDismissable, useEscapeSurface, useFeatureState } from '../../editor'
// Deliberate deep import: the ONE scroll implementation behind api.scrollTo
// (the panel holds an Editor, not an api) — see scrollEditorTo's docblock.
import { scrollEditorTo } from '../../editor/core/EditorApi'
import {
  segmentsFromRange,
  textForSegments,
  type CommentAnchorPayload,
} from './commentAnchor'
import { getCommentAnchorState, getCommentPosition } from './comments'
import type { CommentSyncState } from './commentsProvider'
import { useCommentsBridge } from './commentsLayer'
import {
  useComments,
  type CommentDraft,
  type CommentReply,
  type CommentStatus,
  type CommentUser,
  type CommentsLabels,
  type DocumentComment,
} from './commentsProvider'

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((word) => word[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

/** "2 days ago" — locale-aware, no dependency. Empty for unparseable input. */
function formatRelativeTime(iso: string, now = Date.now()): string {
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return ''
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
  const seconds = Math.round((then - now) / 1000)
  if (Math.abs(seconds) < 60) return rtf.format(seconds, 'second')
  const minutes = Math.round(seconds / 60)
  if (Math.abs(minutes) < 60) return rtf.format(minutes, 'minute')
  const hours = Math.round(minutes / 60)
  if (Math.abs(hours) < 24) return rtf.format(hours, 'hour')
  const days = Math.round(hours / 24)
  if (Math.abs(days) < 30) return rtf.format(days, 'day')
  const months = Math.round(days / 30)
  if (Math.abs(months) < 12) return rtf.format(months, 'month')
  return rtf.format(Math.round(months / 12), 'year')
}

/** Muted relative timestamp; renders nothing for unparseable dates. */
function TimeStamp({ iso }: { iso: string }) {
  const relative = formatRelativeTime(iso)
  if (!relative) return null
  return (
    <time className="comments-panel__time" dateTime={iso} title={new Date(iso).toLocaleString()}>
      {relative}
    </time>
  )
}

/** Consumer-provided user → src/initials avatar; no user → MUI's generic one. */
function UserAvatar({
  user,
  labels,
  small = false,
}: {
  user: CommentUser | null
  labels: CommentsLabels
  small?: boolean
}) {
  const className = `comments-panel__avatar${small ? ' comments-panel__avatar--small' : ''}`
  if (!user) return <Avatar className={className} alt={labels.anonymous} />
  return (
    <Avatar className={className} src={user.avatarUrl} alt={user.name}>
      {initials(user.name)}
    </Avatar>
  )
}

/** Collapse the document selection (read-only: no focus involved). */
function collapseSelectionAt(editor: Editor | null, pos: number) {
  if (!editor || editor.isDestroyed) return
  editor.commands.setTextSelection(Math.max(0, Math.min(pos, editor.state.doc.content.size)))
}

/* The draft composer's "outside": the whole PANEL counts as inside (reading
   cards mid-draft is not abandonment), plus portaled popups and the modal
   backdrop under them — dismissing a card menu must not throw the draft away. */
const panelOutsideClick = (target: Node) => {
  const el = target instanceof Element ? target : target.parentElement
  return el == null || !el.closest(`.comments-panel, .${POPUP_CLASS}, .MuiBackdrop-root`)
}

/**
 * The one text field every comment surface shares — the draft composer, the
 * reply composer and edit-in-place are all this component with different
 * labels and exits. Owns the text (which survives a failed submit) and the
 * keyboard contract: Enter sends, Shift+Enter breaks the line, Escape cancels
 * via {@link useDismissable} — document-level and stack-coordinated, so it
 * works with focus anywhere and newer surfaces close first. By default there
 * is NO outside-click dismissal (`isOutsideClick` constant-false): losing a
 * typed reply/edit to a stray click is worse than an extra Escape — only the
 * draft composer opts into the panel-wide outside-click rule.
 * `errorText` renders a failure AT the field (screen-reader-visible via the
 * panel's alert too) — the parent supplies it when its submit failed.
 */
function InlineTextComposer({
  initialText = '',
  placeholder,
  fieldLabel,
  submitLabel,
  cancelLabel,
  alwaysShowActions = false,
  errorText = null,
  isOutsideClick,
  onTextChange,
  onSubmit,
  onCancel,
}: {
  initialText?: string
  placeholder: string
  fieldLabel: string
  submitLabel: string
  cancelLabel: string
  alwaysShowActions?: boolean
  errorText?: string | null
  isOutsideClick?: (target: Node) => boolean
  /** Observer for a parent-owned draft store — a composer that can be
   *  UNMOUNTED by remote lifecycle changes (its card leaving the tab) writes
   *  every keystroke there, and `initialText` restores it on remount. */
  onTextChange?: (text: string) => void
  onSubmit: (text: string) => Promise<boolean>
  onCancel: () => void
}) {
  const [text, setText] = useState(initialText)
  const [submitting, setSubmitting] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useDismissable(rootRef, onCancel, {
    isOutsideClick: isOutsideClick ?? (() => false),
  })

  const submit = async () => {
    if (text.trim() === '' || submitting) return
    setSubmitting(true)
    // The parent decides what `true` means (usually: unmount this composer).
    // On `false` the text stays — nothing typed is lost.
    await onSubmit(text)
    setSubmitting(false)
  }

  return (
    <div ref={rootRef} className="comments-panel__composer-main">
      <TextField
        multiline
        autoFocus
        fullWidth
        size="small"
        minRows={2}
        placeholder={placeholder}
        value={text}
        error={errorText != null}
        helperText={errorText ?? undefined}
        slotProps={{ htmlInput: { 'aria-label': fieldLabel } }}
        onChange={(event) => {
          setText(event.target.value)
          onTextChange?.(event.target.value)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            void submit()
          }
          // Escape is owned by useDismissable above — global while mounted,
          // and it yields to newer surfaces (menus, later composers).
        }}
      />
      {alwaysShowActions || text.trim() !== '' ? (
        <div className="comments-panel__composer-actions">
          <Button
            size="small"
            className="comments-panel__cancel"
            // While a submit is in flight, cancelling would not abort it —
            // the honest option is to wait it out.
            disabled={submitting}
            onClick={onCancel}
          >
            {cancelLabel}
          </Button>
          <Button
            size="small"
            variant="contained"
            className="comments-panel__submit"
            disabled={submitting}
            onClick={() => void submit()}
          >
            {submitLabel}
          </Button>
        </div>
      ) : null}
    </div>
  )
}

/**
 * The row a captured draft opens: avatar + {@link InlineTextComposer}.
 * Cancelling/sending COLLAPSES the document selection — the still-live range
 * would summon the balloon right back. Outside-mousedown cancels (unlike
 * replies/edits): the draft is anchored to a live selection, and clicking
 * away IS the "never mind" gesture, exactly like Escape.
 */
function Composer({ editor, draft }: { editor: Editor | null; draft: CommentDraft }) {
  const context = useComments()
  const [failed, setFailed] = useState(false)
  if (!context) return null
  const { labels } = context

  const cancel = () => {
    context.clearDraft()
    context.setActiveId(null)
    collapseSelectionAt(editor, draft.to)
  }

  const submit = async (text: string) => {
    // The anchor payload derives from the REMAPPED draft range at SUBMIT time
    // (the bridge keeps `draft` mapped through every doc change — deriving at
    // capture would ship stale geometry): one segment per textblock the range
    // touches, quote = exactly the text those segments cover. No editor → the
    // comment still saves, anchorless, and shows as orphaned.
    let anchor: CommentAnchorPayload | undefined
    if (editor && !editor.isDestroyed) {
      const nodes = segmentsFromRange(editor.state.doc, draft.from, draft.to)
      if (nodes.length > 0) anchor = { nodes, quote: textForSegments(editor.state.doc, nodes) }
    }
    // Collapse BEFORE the round-trip: the payload is captured, the draft
    // decoration owns the range's visibility from here, and a collapse issued
    // after the save resolves would stomp whatever the user selected during
    // the latency window. On failure the draft survives (composer + range
    // decoration stay), so the balloon cannot resurface either way.
    collapseSelectionAt(editor, draft.to)
    const saved = await context.addComment(text, anchor)
    setFailed(!saved)
    return saved
  }

  return (
    <>
      <div className="comments-panel__composer">
        <UserAvatar user={context.user} labels={labels} />
        <InlineTextComposer
          placeholder={labels.commentPlaceholder}
          fieldLabel={labels.commentText}
          submitLabel={labels.submitComment}
          cancelLabel={labels.cancel}
          errorText={failed ? context.error : null}
          isOutsideClick={panelOutsideClick}
          onSubmit={submit}
          onCancel={cancel}
        />
      </div>
      {/* STALE_CONTENT create rejection: someone saved over the quoted text.
          Guidance, not the raw backend message (that one rides the banner). */}
      {context.createError === 'stale' ? (
        <div className="comments-panel__notice">{labels.staleCreate}</div>
      ) : null}
    </>
  )
}

/**
 * The visible tail of the ENVELOPE pipeline, per card: `pendingSave` (anchor
 * drifted, riding the next save) and `saving` (collected into an envelope in
 * flight). Comments with nothing in flight render nothing — and there is no
 * per-card failure state: a failed envelope persists NOTHING and retries
 * wholesale through the consumer's autosave.
 */
function SyncIndicator({
  state,
  labels,
}: {
  state: CommentSyncState | undefined
  labels: CommentsLabels
}) {
  if (!state) return null
  const pending = state === 'pendingSave'
  return (
    <div className={`comments-panel__sync comments-panel__sync--${pending ? 'pending' : 'saving'}`}>
      <Tooltip title={pending ? labels.anchorPendingSave : labels.anchorSaving}>
        <span role="img" aria-label={pending ? labels.anchorPendingSave : labels.anchorSaving}>
          {pending ? <Schedule fontSize="inherit" /> : <CircularProgress size={12} />}
        </span>
      </Tooltip>
    </div>
  )
}

/**
 * One entry of a card's or reply's 3-dots menu — data, not JSX (the same
 * philosophy as the toolbar's `BarItemBase`). Consumers extend the menus by
 * returning these from `CommentsPanel`'s `commentMenuItems`/`replyMenuItems`;
 * pass labels already localized (the built-ins flow through
 * {@link CommentsLabels}).
 */
export interface ActionsMenuItem {
  label: string
  /** In-place confirmation: the first click swaps the item to this label
   *  (menu stays open); only the second click executes. */
  confirmLabel?: string
  onClick: () => void
}

/**
 * The 3-dots menu of a card or reply row. Callers build `items` from the
 * BACKEND's permission flags alone (authorship is never inferred client-side)
 * — destructive actions last, guarded by an in-place confirm step. Absent
 * when nothing is allowed: no dead menus.
 */
function ActionsMenu({
  ariaLabel,
  className,
  items,
  disabled = false,
}: {
  ariaLabel: string
  className: string
  items: ActionsMenuItem[]
  disabled?: boolean
}) {
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  // The MODAL Menu owns its own dismissal; registering it keeps any open
  // composer's Escape (useDismissable) yielding while the menu is on top.
  useEscapeSurface(menuAnchor != null)
  if (items.length === 0) return null

  const close = () => {
    setMenuAnchor(null)
    setConfirming(null)
  }

  return (
    <>
      <IconButton
        size="small"
        className={className}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={(event) => setMenuAnchor(event.currentTarget)}
      >
        <MoreVert fontSize="inherit" />
      </IconButton>
      <Menu
        anchorEl={menuAnchor}
        open={menuAnchor != null}
        onClose={close}
        // Without this the Popover restores focus to the 3-dots on close —
        // AFTER the edit field autofocused, stealing its focus.
        disableRestoreFocus
        // The popup marker rides the PAPER (portal root), same as the
        // context menu — never the backdrop.
        slotProps={{ paper: { className: POPUP_CLASS } }}
      >
        {items.map((item) => (
          <MenuItem
            key={item.label}
            onClick={() => {
              if (item.confirmLabel && confirming !== item.label) {
                setConfirming(item.label)
                return
              }
              close()
              item.onClick()
            }}
          >
            {item.confirmLabel && confirming === item.label ? item.confirmLabel : item.label}
          </MenuItem>
        ))}
      </Menu>
    </>
  )
}

/**
 * The reply composer a card's Reply button opens: small avatar + field.
 * The typed text is mirrored into the panel's `drafts` store keyed by the
 * PARENT comment id: a remote status flip moves the card off the tab and
 * unmounts this composer, and the draft must survive to the next mount.
 * A reply rejected with PARENT_DELETED keeps the text too and swaps the
 * error line for the "comment was deleted" notice.
 */
function ReplyComposer({
  comment,
  drafts,
  onClose,
  onReplied,
}: {
  comment: DocumentComment
  drafts: Map<string, string>
  onClose: () => void
  onReplied: () => void
}) {
  const context = useComments()
  const [failed, setFailed] = useState(false)
  if (!context) return null
  const { labels } = context
  const parentDeleted = context.parentDeletedId === comment.id
  return (
    <div className="comments-panel__reply-composer">
      <UserAvatar user={context.user} labels={labels} small />
      <InlineTextComposer
        initialText={drafts.get(comment.id) ?? ''}
        placeholder={labels.replyPlaceholder}
        fieldLabel={labels.replyText}
        submitLabel={labels.submitReply}
        cancelLabel={labels.cancel}
        // Cancel visible from the start — an empty composer must still show
        // its way out.
        alwaysShowActions
        errorText={failed ? (parentDeleted ? labels.replyParentDeleted : context.error) : null}
        onTextChange={(text) => drafts.set(comment.id, text)}
        onSubmit={async (text) => {
          const sent = await context.replyToComment(comment.id, text)
          setFailed(!sent)
          if (sent) {
            drafts.delete(comment.id)
            onClose()
            onReplied()
          }
          return sent
        }}
        onCancel={() => {
          // Cancel is EXPLICIT abandonment — remounting must not resurrect it.
          drafts.delete(comment.id)
          onClose()
        }}
      />
    </div>
  )
}

/**
 * One direct reply (replies are ONE level — no reply-to-reply). Edit/Delete
 * come from the reply's own flags; editing swaps the text for the shared
 * composer prefilled with it. `frozen` (resolved/archived tabs) renders the
 * plain read-only row: no editing, no menu.
 */
function ReplyRow({
  reply,
  comment,
  frozen = false,
  replyMenuItems,
}: {
  reply: CommentReply
  comment: DocumentComment
  frozen?: boolean
  replyMenuItems?: (reply: CommentReply, comment: DocumentComment) => ActionsMenuItem[]
}) {
  const context = useComments()
  const [editing, setEditing] = useState(false)
  const [failed, setFailed] = useState(false)
  if (!context) return null
  const { labels } = context
  const busy = context.busyIds.has(reply.id)

  // Built-ins are flag-gated and frozen-gated; CONSUMER items are always
  // offered (the callback sees the parent's status and decides) and sit
  // between them — destructive last.
  const items: ActionsMenuItem[] = []
  if (!frozen && reply.canEdit) items.push({ label: labels.edit, onClick: () => setEditing(true) })
  items.push(...(replyMenuItems?.(reply, comment) ?? []))
  if (!frozen && reply.canDelete)
    items.push({
      label: labels.delete,
      confirmLabel: labels.confirmDelete,
      onClick: () => void context.removeComment(reply.id),
    })

  return (
    <li className="comments-panel__reply">
      <span className="comments-panel__card-header">
        <UserAvatar user={reply.author} labels={labels} small />
        <span className="comments-panel__author">{reply.author.name}</span>
        <TimeStamp iso={reply.createdAt} />
      </span>
      {editing && !frozen ? (
        <InlineTextComposer
          initialText={reply.text}
          placeholder={labels.editReplyPlaceholder}
          fieldLabel={labels.editText}
          submitLabel={labels.submitSave}
          cancelLabel={labels.cancel}
          alwaysShowActions
          errorText={failed ? context.error : null}
          onSubmit={async (text) => {
            const saved = await context.updateComment(reply.id, text)
            setFailed(!saved)
            if (saved) setEditing(false)
            return saved
          }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <span className="comments-panel__text">{reply.text}</span>
      )}
      {/* Self-hides when items are empty — a frozen row only carries a menu
          when the CONSUMER contributed items for it. */}
      {!editing ? (
        <ActionsMenu
          ariaLabel={labels.replyActions}
          className="comments-panel__reply-menu"
          items={items}
          disabled={busy}
        />
      ) : null}
    </li>
  )
}

/**
 * One comment thread: avatar + author + time + text, its direct replies, and
 * a Reply footer when the backend allows (`canReply` — orphans included, the
 * discussion outlives the anchored text). Clicking the body scrolls the
 * document to the anchor's first live segment and lights every segment up
 * (`comment--active`, via `activeId`). Anchor health comes from the segments
 * PLUGIN (`getCommentAnchorState`, re-derived per transaction): `orphaned`
 * (nothing live — orphan-forever) keeps the content but loses the jump: the
 * body shows the original quote with a hint instead. A PARTIAL anchor (some
 * segments dormant) renders like a healthy one on purpose: the state exists
 * for custom surfaces, but the stock card had nothing actionable to say
 * about it. Actions render from the comment's
 * flags: the ✓ Resolve corner button (`canResolve`, spinner while its
 * mutation is in flight), and the 3-dots with Edit/Archive/Delete (Delete
 * confirms in place). While EDITING the body goes inert (the orphan trick)
 * so a click in the field can't jump, and the corner hides — actions are
 * footguns mid-edit.
 * `frozen` (the resolved/archived tabs) is read-only + Delete: inert body
 * with the quote for context (their highlights are gone by design — no
 * anomaly hint), plain reply rows, no Reply/Edit/Resolve/Archive.
 */
function CommentCard({
  comment,
  editor,
  frozen = false,
  announce,
  focusPanel,
  replyDrafts,
  commentMenuItems,
  replyMenuItems,
}: {
  comment: DocumentComment
  editor: Editor | null
  frozen?: boolean
  announce: (message: string) => void
  focusPanel: () => void
  /** Panel-owned reply-draft store (id → typed text) — see ReplyComposer. */
  replyDrafts: Map<string, string>
  commentMenuItems?: (comment: DocumentComment) => ActionsMenuItem[]
  replyMenuItems?: (reply: CommentReply, comment: DocumentComment) => ActionsMenuItem[]
}) {
  const context = useComments()
  const [editing, setEditing] = useState(false)
  const [replying, setReplying] = useState(false)
  const [editFailed, setEditFailed] = useState(false)
  const cardRef = useRef<HTMLLIElement>(null)
  // Anchor health, straight from the plugin state — re-derived on every
  // transaction, so edits that kill (or revive) segments reflect live. No
  // editor mounted → null → never orphan-style (positions are unknowable).
  const anchorState = useFeatureState(editor, (current) =>
    getCommentAnchorState(current, comment.id),
  )
  const orphan = !frozen && anchorState === 'orphaned'
  const active = !orphan && !frozen && context?.activeId === comment.id
  // Clicking the HIGHLIGHT in the document activates this card — bring it
  // into the panel's scrolled viewport. (Optional chaining: jsdom has no
  // scrollIntoView.)
  useEffect(() => {
    if (active) cardRef.current?.scrollIntoView?.({ block: 'nearest' })
  }, [active])
  if (!context) return null
  const { labels } = context
  const busy = context.busyIds.has(comment.id)
  const syncState = context.anchorSync?.states.get(comment.id)

  const jump = () => {
    context.setActiveId(comment.id)
    if (!editor || editor.isDestroyed) return
    // The FIRST live segment in document order, from the plugin — positions
    // shift with every edit, so this derives fresh at click time.
    const pos = getCommentPosition(editor, comment.id)
    if (pos == null) return
    // A COLLAPSED caret at the anchor's start — selecting the whole range
    // would summon the "Add comment" balloon over the very comment being read.
    editor.chain().setTextSelection(pos).run()
    // The api.scrollTo implementation: a DOM scroll, because PM's own
    // scrollIntoView bails while the DOM focus sits outside the view — and it
    // does, the user just clicked this panel.
    scrollEditorTo(editor, pos)
  }

  const resolve = async () => {
    if (await context.setCommentStatus(comment.id, 'RESOLVED')) {
      announce(labels.announceResolved)
      focusPanel()
    }
  }

  const showResolve = !frozen && comment.canResolve
  // Built-ins first, CONSUMER items in the middle (always offered — the
  // callback sees `status` and decides what a frozen card gets), Delete last.
  const items: ActionsMenuItem[] = []
  if (!frozen && comment.canEdit)
    items.push({ label: labels.edit, onClick: () => setEditing(true) })
  if (!frozen && comment.canArchive)
    items.push({
      label: labels.archive,
      onClick: () =>
        void context.setCommentStatus(comment.id, 'ARCHIVED').then((done) => {
          if (done) {
            announce(labels.announceArchived)
            focusPanel()
          }
        }),
    })
  items.push(...(commentMenuItems?.(comment) ?? []))
  if (comment.canDelete)
    items.push({
      label: labels.delete,
      confirmLabel: labels.confirmDelete,
      onClick: () =>
        void context.removeComment(comment.id).then((done) => {
          if (done) {
            announce(labels.announceDeleted)
            focusPanel()
          }
        }),
    })

  const header = (
    <span
      className={`comments-panel__card-header${
        showResolve && items.length > 0 ? ' comments-panel__card-header--roomy' : ''
      }`}
    >
      <UserAvatar user={comment.author} labels={labels} />
      <span className="comments-panel__author">{comment.author.name}</span>
      <TimeStamp iso={comment.createdAt} />
    </span>
  )

  return (
    <li
      ref={cardRef}
      className={`comments-panel__card${active ? ' comments-panel__card--active' : ''}`}
      aria-current={active ? 'true' : undefined}
    >
      {editing && !frozen ? (
        <div className="comments-panel__card-body comments-panel__card-body--editing">
          {header}
          <InlineTextComposer
            initialText={comment.text}
            placeholder={labels.editCommentPlaceholder}
            fieldLabel={labels.editText}
            submitLabel={labels.submitSave}
            cancelLabel={labels.cancel}
            alwaysShowActions
            errorText={editFailed ? context.error : null}
            onSubmit={async (text) => {
              const saved = await context.updateComment(comment.id, text)
              setEditFailed(!saved)
              if (saved) setEditing(false)
              return saved
            }}
            onCancel={() => setEditing(false)}
          />
        </div>
      ) : frozen ? (
        <div className="comments-panel__card-body comments-panel__card-body--frozen">
          {header}
          <span className="comments-panel__text">{comment.text}</span>
          <span className="comments-panel__orphan-quote">“{comment.quote}”</span>
        </div>
      ) : orphan ? (
        <div className="comments-panel__card-body comments-panel__card-body--orphan">
          {header}
          <span className="comments-panel__text">{comment.text}</span>
          <span className="comments-panel__orphan-quote">“{comment.quote}”</span>
          <span className="comments-panel__orphan-hint">{labels.originalTextRemoved}</span>
        </div>
      ) : (
        <ButtonBase
          className="comments-panel__card-body"
          aria-label={labels.showInDocument(comment.author.name)}
          onClick={jump}
        >
          {header}
          <span className="comments-panel__text">{comment.text}</span>
        </ButtonBase>
      )}
      {/* Anchor sync badge — outside the jump ButtonBase. */}
      {!frozen ? <SyncIndicator state={syncState} labels={labels} /> : null}
      {/* Corner BEFORE the replies: keyboard order matches the visual order
          (the container is absolutely positioned, so DOM order is free). */}
      {!editing ? (
        <span className="comments-panel__corner">
          {showResolve ? (
            <IconButton
              size="small"
              aria-label={labels.resolve}
              disabled={busy}
              onClick={() => void resolve()}
            >
              {busy ? <CircularProgress size={16} /> : <Check fontSize="inherit" />}
            </IconButton>
          ) : null}
          <ActionsMenu
            ariaLabel={labels.commentActions}
            className="comments-panel__menu"
            items={items}
            disabled={busy}
          />
        </span>
      ) : null}
      {comment.replies.length > 0 ? (
        <ul className="comments-panel__replies">
          {comment.replies.map((reply) => (
            <ReplyRow
              key={reply.id}
              reply={reply}
              comment={comment}
              frozen={frozen}
              replyMenuItems={replyMenuItems}
            />
          ))}
        </ul>
      ) : null}
      {!frozen && comment.canReply ? (
        replying ? (
          <ReplyComposer
            comment={comment}
            drafts={replyDrafts}
            onClose={() => {
              setReplying(false)
              // Keyboard users came from here — put them back.
              cardRef.current?.focus?.()
            }}
            onReplied={() => announce(labels.announceReplyAdded)}
          />
        ) : (
          <Button
            size="small"
            className="comments-panel__reply-button"
            onClick={() => setReplying(true)}
          >
            {labels.reply}
          </Button>
        )
      ) : null}
    </li>
  )
}

/**
 * The comments panel, for BOTH modes (only composing a NEW comment is
 * review-only — replying and editing work everywhere): status TABS (open
 * "Comments (n)" / Resolved / Archived — n counts OPEN threads, not replies),
 * the composer while a draft is being written, then the active tab's threads
 * — newest data straight from the adapter, refetched after every mutation.
 * Capturing a draft or clicking a highlight auto-switches to the Comments
 * tab. Mounts {@link useCommentsBridge}, so the highlights stay wired even if
 * the consumer forgot {@link CommentsLayer}. Renders nothing without a
 * {@link CommentsProvider}, and nothing while there is neither a draft nor
 * any (undeleted) comment of ANY status NOR an error to show.
 */
export function CommentsPanel({
  editor,
  commentMenuItems,
  replyMenuItems,
}: {
  editor: Editor | null
  /** CONSUMER extension of a card's 3-dots menu — items land between the
   *  built-ins and Delete. Called per comment (any status: the callback
   *  decides what frozen/orphaned cards get). Labels arrive pre-localized. */
  commentMenuItems?: (comment: DocumentComment) => ActionsMenuItem[]
  /** Same, for reply rows — called with the reply AND its parent comment. */
  replyMenuItems?: (reply: CommentReply, comment: DocumentComment) => ActionsMenuItem[]
}) {
  const context = useComments()
  useCommentsBridge(editor)
  const [tab, setTab] = useState<CommentStatus>('OPEN')
  const [announcement, setAnnouncement] = useState('')
  const panelRef = useRef<HTMLDivElement>(null)
  // Reply drafts by PARENT comment id: typed text survives its composer being
  // unmounted by a REMOTE lifecycle flip (the card leaving the tab). A ref,
  // not state — keystrokes must not re-render the panel.
  const replyDraftsRef = useRef(new Map<string, string>())
  const draft = context?.draft ?? null
  const activeId = context?.activeId ?? null
  // Composing and the active highlight live on the Comments tab — follow
  // them there. (The composer still renders on ANY tab, see below.)
  useEffect(() => {
    if (draft) setTab('OPEN')
  }, [draft])
  useEffect(() => {
    if (activeId) setTab('OPEN')
  }, [activeId])
  if (!context) return null
  const { error, labels } = context
  // Soft-deleted rows are tombstones for delta sync — never rendered.
  const comments = context.comments.filter((comment) => !comment.isDeleted)
  // An initial-fetch failure must not be a silent nothing — show the error.
  if (!draft && comments.length === 0 && !error) return null
  const openCount = comments.filter((comment) => comment.status === 'OPEN').length
  const visible = comments.filter((comment) => comment.status === tab)
  const emptyCopy: Record<CommentStatus, string> = {
    OPEN: labels.emptyOpen,
    RESOLVED: labels.emptyResolved,
    ARCHIVED: labels.emptyArchived,
  }
  const countBadge = openCount > 99 ? '99+' : `${openCount}`

  const announce = (message: string) => setAnnouncement(message)
  const focusPanel = () => panelRef.current?.focus?.()

  return (
    <Paper
      component="aside"
      className="comments-panel"
      aria-label={labels.panelLabel}
      elevation={0}
      ref={panelRef}
      // Focus parking spot after a card the user acted on unmounts —
      // keyboard/SR users must not be dropped on <body>.
      tabIndex={-1}
    >
      <Tabs
        value={tab}
        onChange={(_event, next: CommentStatus) => setTab(next)}
        aria-label={labels.statusTabsLabel}
        className="comments-panel__tabs"
        variant="scrollable"
        scrollButtons={false}
      >
        <Tab
          value="OPEN"
          id="comments-tab-open"
          aria-controls="comments-tabpanel"
          label={`${labels.tabOpen}${openCount > 0 ? ` (${countBadge})` : ''}`}
        />
        <Tab
          value="RESOLVED"
          id="comments-tab-resolved"
          aria-controls="comments-tabpanel"
          label={labels.tabResolved}
        />
        <Tab
          value="ARCHIVED"
          id="comments-tab-archived"
          aria-controls="comments-tabpanel"
          label={labels.tabArchived}
        />
      </Tabs>
      <div role="tabpanel" id="comments-tabpanel" aria-labelledby={`comments-tab-${tab}`}>
        {draft ? (
          // Keyed by the captured range: a new capture starts a FRESH composer.
          // Rendered on EVERY tab — a manual tab flip mid-typing must never
          // unmount the composer and destroy its text.
          <Composer key={`${draft.from}:${draft.to}`} editor={editor} draft={draft} />
        ) : null}
        {error ? (
          <div role="alert" className="comments-panel__error">
            {error}
          </div>
        ) : null}
        {visible.length > 0 ? (
          <ul className="comments-panel__list">
            {visible.map((comment) => (
              <CommentCard
                key={comment.id}
                comment={comment}
                editor={editor}
                frozen={tab !== 'OPEN'}
                announce={announce}
                focusPanel={focusPanel}
                replyDrafts={replyDraftsRef.current}
                commentMenuItems={commentMenuItems}
                replyMenuItems={replyMenuItems}
              />
            ))}
          </ul>
        ) : !(tab === 'OPEN' && draft) ? (
          <div className="comments-panel__empty">{emptyCopy[tab]}</div>
        ) : null}
      </div>
      {/* Mutation outcomes, announced to assistive tech. */}
      <div role="status" className="comments-panel__sr-only">
        {announcement}
      </div>
    </Paper>
  )
}
