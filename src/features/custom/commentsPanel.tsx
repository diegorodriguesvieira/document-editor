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
import Check from '@mui/icons-material/Check'
import MoreVert from '@mui/icons-material/MoreVert'
import type { Editor } from '@tiptap/core'
import { POPUP_CLASS, useDismissable, useEscapeSurface, useFeatureState } from '../../editor'
import { applyCommentAnchor, collectCommentAnchors } from './commentAnchors'
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
        onChange={(event) => setText(event.target.value)}
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
    // Once the backend returns the created id, the draft range becomes the
    // comment's MARK (its anchor in the document). No editor → the comment
    // still saves, anchorless, and shows as orphaned.
    const saved = await context.addComment(text, (id) => {
      if (editor && !editor.isDestroyed) applyCommentAnchor(editor, id, draft)
    })
    setFailed(!saved)
    if (saved) collapseSelectionAt(editor, draft.to)
    return saved
  }

  return (
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

/** The reply composer a card's Reply button opens: small avatar + field. */
function ReplyComposer({
  comment,
  onClose,
  onReplied,
}: {
  comment: DocumentComment
  onClose: () => void
  onReplied: () => void
}) {
  const context = useComments()
  const [failed, setFailed] = useState(false)
  if (!context) return null
  const { labels } = context
  return (
    <div className="comments-panel__reply-composer">
      <UserAvatar user={context.user} labels={labels} small />
      <InlineTextComposer
        placeholder={labels.replyPlaceholder}
        fieldLabel={labels.replyText}
        submitLabel={labels.submitReply}
        cancelLabel={labels.cancel}
        // Cancel visible from the start — an empty composer must still show
        // its way out.
        alwaysShowActions
        errorText={failed ? context.error : null}
        onSubmit={async (text) => {
          const sent = await context.replyToComment(comment.id, text)
          setFailed(!sent)
          if (sent) {
            onClose()
            onReplied()
          }
          return sent
        }}
        onCancel={onClose}
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
 * document to the anchored range and lights it up (`comment--active`, via
 * `activeId`). Actions render from the comment's flags: the ✓ Resolve corner
 * button (`canResolve`, spinner while its mutation is in flight), and the
 * 3-dots with Edit/Archive/Delete (Delete confirms in place). While EDITING
 * the body goes inert (the orphan trick) so a click in the field can't jump,
 * and the corner hides — actions are footguns mid-edit.
 * An ORPHANED comment — its mark no longer exists in the doc (the commented
 * text was deleted) — keeps its content but loses the jump: the body shows
 * the original quote with a hint instead.
 * `frozen` (the resolved/archived tabs) is read-only + Delete: inert body
 * with the quote for context (their marks are gone by design — no anomaly
 * hint), plain reply rows, no Reply/Edit/Resolve/Archive.
 */
function CommentCard({
  comment,
  editor,
  orphan,
  frozen = false,
  announce,
  focusPanel,
  commentMenuItems,
  replyMenuItems,
}: {
  comment: DocumentComment
  editor: Editor | null
  orphan: boolean
  frozen?: boolean
  announce: (message: string) => void
  focusPanel: () => void
  commentMenuItems?: (comment: DocumentComment) => ActionsMenuItem[]
  replyMenuItems?: (reply: CommentReply, comment: DocumentComment) => ActionsMenuItem[]
}) {
  const context = useComments()
  const [editing, setEditing] = useState(false)
  const [replying, setReplying] = useState(false)
  const [editFailed, setEditFailed] = useState(false)
  const cardRef = useRef<HTMLLIElement>(null)
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

  const jump = () => {
    context.setActiveId(comment.id)
    if (!editor || editor.isDestroyed) return
    const anchor = collectCommentAnchors(editor.state.doc).get(comment.id)
    if (!anchor) return
    // A COLLAPSED caret at the mark's start — selecting the whole range would
    // summon the "Add comment" balloon over the very comment being read.
    editor.chain().setTextSelection(anchor.from).run()
    // PM's own scrollIntoView is a NO-OP here: prosemirror-view bails out of
    // scrollToSelection while the DOM focus sits outside the view — and it
    // does, the user just clicked this panel. Scroll the highlight span
    // itself instead (the mark's rendered span carries `data-comment-id`).
    // Optional-chained: jsdom has no scrollIntoView.
    const escaped = globalThis.CSS?.escape?.(comment.id) ?? comment.id
    editor.view.dom
      .querySelector(`[data-comment-id="${escaped}"]`)
      ?.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
  }

  const resolve = async () => {
    if (await context.setCommentStatus(comment.id, 'resolved')) {
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
        void context.setCommentStatus(comment.id, 'archived').then((done) => {
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
 * tab. Mounts {@link useCommentsBridge}, so the doc stays reconciled even if
 * the consumer forgot {@link CommentsLayer}. Renders nothing without a
 * {@link CommentsProvider}, and nothing while there is neither a draft nor
 * any comment of ANY status NOR an error to show.
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
  const [tab, setTab] = useState<CommentStatus>('open')
  const [announcement, setAnnouncement] = useState('')
  const panelRef = useRef<HTMLDivElement>(null)
  const draft = context?.draft ?? null
  const activeId = context?.activeId ?? null
  // Ids anchored in the doc — an OPEN backend comment missing here is
  // ORPHANED. (Doc-derived so edits that delete a mark reflect immediately.)
  const anchoredKey = useFeatureState(editor, (current) =>
    [...collectCommentAnchors(current.state.doc).keys()].sort().join(' '),
  )
  // Composing and the active highlight live on the Comments tab — follow
  // them there. (The composer still renders on ANY tab, see below.)
  useEffect(() => {
    if (draft) setTab('open')
  }, [draft])
  useEffect(() => {
    if (activeId) setTab('open')
  }, [activeId])
  if (!context) return null
  const { comments, error, labels } = context
  // An initial-fetch failure must not be a silent nothing — show the error.
  if (!draft && comments.length === 0 && !error) return null
  const anchoredIds =
    anchoredKey == null ? null : new Set(anchoredKey.split(' ').filter(Boolean))
  const openCount = comments.filter((comment) => comment.status === 'open').length
  const visible = comments.filter((comment) => comment.status === tab)
  const emptyCopy: Record<CommentStatus, string> = {
    open: labels.emptyOpen,
    resolved: labels.emptyResolved,
    archived: labels.emptyArchived,
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
          value="open"
          id="comments-tab-open"
          aria-controls="comments-tabpanel"
          label={`${labels.tabOpen}${openCount > 0 ? ` (${countBadge})` : ''}`}
        />
        <Tab
          value="resolved"
          id="comments-tab-resolved"
          aria-controls="comments-tabpanel"
          label={labels.tabResolved}
        />
        <Tab
          value="archived"
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
                // No editor mounted → positions unknowable; never orphan-style.
                orphan={tab === 'open' && anchoredIds != null && !anchoredIds.has(comment.id)}
                frozen={tab !== 'open'}
                announce={announce}
                focusPanel={focusPanel}
                commentMenuItems={commentMenuItems}
                replyMenuItems={replyMenuItems}
              />
            ))}
          </ul>
        ) : !(tab === 'open' && draft) ? (
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
