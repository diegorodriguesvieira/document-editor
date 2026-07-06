import { describe, expect, it } from 'vitest'
import { baseStyles } from './base.styles'

describe('the skin token cascade contract', () => {
  it('declares every default token at ZERO specificity — a consumer :root override must always win', () => {
    // The Emotion <Global> injects its <style> at RENDER time, AFTER any
    // consumer stylesheet loaded via import. With a plain ':root' the SDK
    // defaults would re-win the equal-specificity cascade and silently revert
    // every consumer token override (page min-height, sticky offset — both
    // shipped as real bugs once). ':where(:root)' has specificity 0, so a
    // consumer's ':root { --editor-*: … }' beats it in ANY injection order.
    expect(baseStyles.styles).toContain(':where(:root)')
    // No bare ':root' selector may sneak back in (a well-meaning
    // "simplification" of :where would reintroduce the bug).
    expect(baseStyles.styles.replace(/:where\(:root\)/g, '')).not.toMatch(/:root\s*\{/)
  })
})
