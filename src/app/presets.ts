import type { FeatureDefinition } from '../editor'
import {
  BoldFeature,
  CalloutFeature,
  ColorFeature,
  CommentsFeature,
  CodeBlockFeature,
  DividerFeature,
  HeadingFeature,
  HeaderFooterFeature,
  HistoryFeature,
  ImageFeature,
  ConditionalBlockFeature,
  ItalicFeature,
  LinkFeature,
  ListsFeature,
  MergeFieldFeature,
  QuoteFeature,
  TableFeature,
  TableColumnsFeature,
} from '../features'
import { AppExtrasFeature } from './appExtras'

/**
 * The demo's feature set — every team feature, opted in. A module-level
 * constant so the array identity is stable (a fresh array each render would
 * recreate the editor). Trimming this list is how a product drops surfaces:
 * the bubble, inserts and commands disappear with their features.
 */
export const fullFeatures: FeatureDefinition[] = [
  HistoryFeature,
  BoldFeature,
  ItalicFeature,
  HeadingFeature,
  ListsFeature,
  // Bubble-only; its POSITION is load-bearing — array order is bar order, so
  // this slots the bubble "Table columns" button next to Lists without moving
  // TableFeature ("Table" in the insert dock) further down the array.
  TableColumnsFeature,
  LinkFeature,
  ColorFeature,
  CalloutFeature,
  TableFeature,
  QuoteFeature,
  CodeBlockFeature,
  DividerFeature,
  ImageFeature,
  // Static feature — its variables come from DocumentVariablesProvider (the app).
  MergeFieldFeature,
  ConditionalBlockFeature,
  HeaderFooterFeature,
  CommentsFeature,
  // APP-level feature (defined in ./appExtras, not in the SDK): new items
  // on the footer dock and in the bubble — zero SDK edits.
  AppExtrasFeature,
]
