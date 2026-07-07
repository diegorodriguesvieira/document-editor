import { describe, expect, it } from 'vitest'
import { baseStyles } from './base.styles'
import { TOKEN_DEFAULTS, createEditorTheme, editorDarkTheme } from './theme'

describe('MUI theme ↔ token contract', () => {
  it('every theme literal matches its token default in base.styles — the two sources cannot drift', () => {
    // The palette must be literal (MUI color math rejects var() strings), so
    // the literals mirror the tokens. If a token default changes in
    // base.styles.ts, this fails until theme.tsx follows.
    for (const [token, value] of Object.entries(TOKEN_DEFAULTS)) {
      expect(baseStyles.styles, token).toContain(`${token}: ${value};`)
    }
  })

  it('keeps the flat product look: no ripple, no uppercase buttons', () => {
    const theme = createEditorTheme()
    expect(theme.components?.MuiButtonBase?.defaultProps?.disableRipple).toBe(true)
    expect(theme.typography.button.textTransform).toBe('none')
  })

  it('ripple OFF requires a focus indicator ON — both themes ship a .Mui-focusVisible ring', () => {
    // disableRipple removes MUI's only keyboard focus feedback and ButtonBase
    // resets the outline; without this override keyboard users get nothing.
    for (const theme of [createEditorTheme(), editorDarkTheme]) {
      const root = theme.components?.MuiButtonBase?.styleOverrides?.root as Record<string, unknown>
      expect(theme.components?.MuiButtonBase?.defaultProps?.disableRipple).toBe(true)
      expect(root['&.Mui-focusVisible']).toMatchObject({
        outline: expect.stringContaining('2px solid'),
      })
    }
  })

  it('consumer overrides deep-merge over the base options', () => {
    const theme = createEditorTheme({ palette: { primary: { main: '#7c3aed' } } })
    expect(theme.palette.primary.main).toBe('#7c3aed')
    // Base pieces survive the merge.
    expect(theme.components?.MuiButtonBase?.defaultProps?.disableRipple).toBe(true)
  })
})
