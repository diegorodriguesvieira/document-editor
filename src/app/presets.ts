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
  // on the left rail and in the bubble — zero SDK edits.
  AppExtrasFeature,
]
