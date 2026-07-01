import type { FeatureDefinition } from '../editor'
import {
  AiAssistFeature,
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

export interface Preset {
  id: string
  label: string
  features: FeatureDefinition[]
}

/**
 * Two products, two opt-in feature sets. Switching between them shows the
 * toolbar, inserts and commands appearing/disappearing — the whole point of
 * the SDK. Module-level constants so each `features` array is stable.
 * `basic` keeps it minimal; `full` enables every team feature.
 */
export const presets: Preset[] = [
  {
    id: 'basic',
    label: 'Basic — bold, italic, headings, undo',
    features: [HistoryFeature, BoldFeature, ItalicFeature, HeadingFeature],
  },
  {
    id: 'full',
    label: 'Full — + lists, inserts (table/quote/code/divider/image), link, callout and AI',
    features: [
      HistoryFeature,
      BoldFeature,
      ItalicFeature,
      HeadingFeature,
      ListsFeature,
      LinkFeature,
      ColorFeature,
      CalloutFeature,
      AiAssistFeature,
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
    ],
  },
]
