// Marks (inline formatting)
export { BoldFeature } from './marks/bold'
export { ItalicFeature } from './marks/italic'
export { LinkFeature } from './marks/link'
export { ColorFeature, createColorFeature } from './custom/color'
export type { ColorFeatureOptions } from './custom/color'

// Blocks / nodes
export { HeadingFeature } from './blocks/heading'
export { ListsFeature } from './blocks/lists'
export { QuoteFeature } from './blocks/blockquote'
export { CodeBlockFeature } from './blocks/codeBlock'
export { DividerFeature } from './blocks/divider'
export { TableFeature, TableColumnsFeature, createTableFeature } from './blocks/table'
export type { TableFeatureOptions } from './blocks/table'
export { ImageFeature } from './blocks/image'

// Example "team" features
export { CalloutFeature } from './custom/callout'
export { VariableFeature } from './custom/variable'
export {
  CONDITION_SIGNATURES,
  ConditionalBlockFeature,
  isCompleteCondition,
  MAX_CONDITIONAL_DEPTH,
} from './custom/conditionalBlock'
export type { Condition, ConditionId, ConditionLeaf, ConditionOperand } from './custom/conditionalBlock'
// Anchor-based comments: the decoration/segments kernel (feature), the
// consumer-fed provider (user + endpoint adapter), the "Add comment" balloon
// layer and the panel for the consumer-owned right rail. Anchors are external
// `nodes[]` rows — nothing about a comment is ever written to the document.
export { CommentsFeature, getCommentAnchorState, getCommentPosition } from './custom/comments'
export {
  CommentsProvider,
  PARENT_DELETED,
  STALE_CONTENT,
  isParentDeletedError,
  isStaleContentError,
  useComments,
} from './custom/commentsProvider'
export type {
  CommentAnchorBridge,
  CommentAnchorSync,
  CommentSaveCreate,
  CommentSavePayload,
  CommentDraft,
  CommentReply,
  CommentsAdapter,
  CommentStatus,
  CommentUser,
  DocumentComment,
} from './custom/commentsProvider'
// The anchor write contract an adapter implements against: the
// segment/payload shapes `add` and the save envelope carry, and the sync
// state the panel renders.
export type { CommentAnchorPayload, CommentNodeSegment } from './custom/commentAnchor'
export type { CommentSyncState } from './custom/commentsProvider'
// The migration valve for documents saved by the RETIRED mark model: sheds
// legacy `comment` marks from raw JSON before load (the mark is gone from the
// schema, so an unstripped legacy doc throws instead of loading).
export { stripCommentMarks } from './custom/commentAnchor'
export { CommentsLayer, commentBalloonShouldShow, useCommentsBridge } from './custom/commentsLayer'
export { CommentsPanel } from './custom/commentsPanel'
export type { ActionsMenuItem } from './custom/commentsPanel'
export { DEFAULT_COMMENTS_LABELS } from './custom/commentsProvider'
export type { CommentsLabels } from './custom/commentsProvider'
export { HeaderFooterFeature } from './custom/headerFooter'
export { DocumentVariablesProvider } from './custom/documentVariables'
export type { ConditionFlag, DocumentVariable } from './custom/documentVariables'

// Editor tooling
export { HistoryFeature } from './history'
