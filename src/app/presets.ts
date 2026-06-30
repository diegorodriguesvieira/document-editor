import type { FeatureDefinition } from '../editor'
import {
  AiAssistFeature,
  BoldFeature,
  CalloutFeature,
  CodeBlockFeature,
  DividerFeature,
  HeadingFeature,
  HistoryFeature,
  ImageFeature,
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
 */
export const presets: Preset[] = [
  {
    id: 'basic',
    label: 'Básico — negrito, itálico, títulos, desfazer',
    features: [HistoryFeature, BoldFeature, ItalicFeature, HeadingFeature],
  },
  {
    id: 'full',
    label: 'Completo — + listas, inserts (tabela/citação/código/divisor/imagem), link, destaque e IA',
    features: [
      HistoryFeature,
      BoldFeature,
      ItalicFeature,
      HeadingFeature,
      ListsFeature,
      LinkFeature,
      CalloutFeature,
      AiAssistFeature,
      TableFeature,
      QuoteFeature,
      CodeBlockFeature,
      DividerFeature,
      ImageFeature,
      // Static feature — its variables come from MergeFieldVariablesProvider (the app).
      MergeFieldFeature,
    ],
  },
]
