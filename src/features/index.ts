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
export { MergeFieldFeature } from './custom/mergeField'
export {
  CONDITION_SIGNATURES,
  ConditionalBlockFeature,
  isCompleteCondition,
  MAX_CONDITIONAL_DEPTH,
} from './custom/conditionalBlock'
export type { Condition, ConditionId, ConditionLeaf, ConditionOperand } from './custom/conditionalBlock'
export { CommentsFeature } from './custom/comments'
export type { CommentThread } from './custom/comments'
// The comments SURFACE for the consumer-owned right rail: the default panel,
// or rebuild your own UI on the same reactive hook (click-to-scroll included —
// see CommentsPanel as the reference implementation).
export { CommentsPanel, useDocumentComments } from './custom/commentsPanel'
export type { AnchoredComment } from './custom/commentsPanel'
export { HeaderFooterFeature } from './custom/headerFooter'
export { DocumentVariablesProvider } from './custom/documentVariables'
export type { DocumentVariable } from './custom/documentVariables'

// Editor tooling
export { HistoryFeature } from './history'
