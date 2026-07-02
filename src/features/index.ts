// Marks (inline formatting)
export { BoldFeature } from './marks/bold'
export { ItalicFeature } from './marks/italic'
export { LinkFeature } from './marks/link'
export { ColorFeature } from './custom/color'

// Blocks / nodes
export { HeadingFeature } from './blocks/heading'
export { ListsFeature } from './blocks/lists'
export { QuoteFeature } from './blocks/blockquote'
export { CodeBlockFeature } from './blocks/codeBlock'
export { DividerFeature } from './blocks/divider'
export { TableFeature } from './blocks/table'
export { ImageFeature } from './blocks/image'

// Example "team" features
export { CalloutFeature } from './custom/callout'
export { MergeFieldFeature } from './custom/mergeField'
export { ConditionalBlockFeature, MAX_CONDITIONAL_DEPTH } from './custom/conditionalBlock'
export type { ConditionId, ConditionValue } from './custom/conditionalBlock'
export { CommentsFeature } from './custom/comments'
export type { CommentThread } from './custom/comments'
export type { AnchoredComment } from './custom/commentsPanel'
export { HeaderFooterFeature } from './custom/headerFooter'
export { DocumentVariablesProvider } from './custom/documentVariables'
export type { DocumentVariable } from './custom/documentVariables'

// Editor tooling
export { HistoryFeature } from './history'
