import type { FeatureDefinition } from './types'

/**
 * Identity helper that gives feature authors type-checking and inference.
 * A feature is just data — opt a product into it by including it in the
 * `features` list passed to the editor.
 */
export function defineFeature(definition: FeatureDefinition): FeatureDefinition {
  return definition
}
