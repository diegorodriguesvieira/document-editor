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
export { TableFeature, TableColumnsFeature } from './blocks/table'
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
// Review-mode comments: the decoration kernel (feature), the consumer-fed
// provider (user + endpoint adapter), the "Add comment" balloon layer and the
// panel for the consumer-owned right rail — all read-only-mode only.
export { CommentsFeature } from './custom/comments'
export { CommentsProvider, useComments } from './custom/commentsProvider'
export type {
  CommentDraft,
  CommentsAdapter,
  CommentUser,
  DocumentComment,
} from './custom/commentsProvider'
export { CommentsLayer, commentBalloonShouldShow } from './custom/commentsLayer'
export { CommentsPanel } from './custom/commentsPanel'
export { HeaderFooterFeature } from './custom/headerFooter'
export { DocumentVariablesProvider } from './custom/documentVariables'
export type { DocumentVariable } from './custom/documentVariables'

// Editor tooling
export { HistoryFeature } from './history'
