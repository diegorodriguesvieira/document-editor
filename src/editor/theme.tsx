import type { ReactNode } from 'react'
import { ThemeProvider, createTheme, type Theme, type ThemeOptions } from '@mui/material/styles'

/**
 * The MUI theme bridge. MUI renders the editor CHROME (buttons, menus,
 * popovers, panels, forms); the `--editor-*` tokens keep owning the document
 * CONTENT skin and the layout metrics (base.styles.ts).
 *
 * Two rules keep the systems coherent:
 * - The PALETTE uses LITERALS (MUI's color math — alpha/augmentColor — throws
 *   on `var()` strings). The literals mirror the token defaults 1:1, pinned
 *   by theme.contract.test.ts so they cannot drift.
 * - Every visible knob — in `components.*.styleOverrides` AND in per-surface
 *   `sx` — reads the live token through {@link tokenVar}, so a consumer's
 *   `:root { --editor-accent: … }` keeps restyling MUI chrome too. Only
 *   MUI-internal derivations (focus ring alphas etc.) stay literal-based.
 */
export const TOKEN_DEFAULTS = {
  '--editor-font': "'Roboto', system-ui, -apple-system, 'Segoe UI', Arial, sans-serif",
  '--editor-text': '#202124',
  '--editor-text-muted': '#5f6368',
  '--editor-text-subtle': '#80868b',
  '--editor-control-fg': '#444746',
  '--editor-surface': '#fff',
  '--editor-border': '#e0e0e0',
  '--editor-border-muted': '#dadce0',
  '--editor-subtle-bg': '#f1f3f4',
  '--editor-accent': '#1a73e8',
  '--editor-accent-ink': '#0b57d0',
  '--editor-accent-bg': '#d3e3fd',
  '--editor-menu-active-bg': '#edf2fa',
  '--editor-control-hover-bg': '#e2e7ef',
  '--editor-danger': '#d93025',
  '--editor-danger-bg': '#fce8e6',
  '--editor-inverse-bg': '#1b1b1b',
  '--editor-inverse-fg': '#e3e3e3',
  '--editor-inverse-accent': '#8ab4f8',
  '--editor-shadow-pop': '0 6px 24px rgba(0, 0, 0, 0.2)',
} as const

/** `var(--editor-x, <its default>)` — fallback always in sync with the map,
 *  for theme styleOverrides and per-surface `sx` alike. */
export const tokenVar = (name: keyof typeof TOKEN_DEFAULTS) =>
  `var(${name}, ${TOKEN_DEFAULTS[name]})`

const FONT = tokenVar('--editor-font')

/** Bar metrics (the .bubble-bar__btn skin): squarish,
 *  text-capable (some icons are strings like 'H1'). ONE copy — the bubble's
 *  dark controls must never diverge from the main chrome's. */
const CONTROL_METRICS = {
  borderRadius: 6,
  minWidth: 32,
  height: 32,
  padding: '0 8px',
  fontFamily: FONT,
  fontSize: 14,
  fontWeight: 600,
} as const

/** Everything the light and dark themes share about CONTROLS, parameterized
 *  by the color slots that differ. */
function controlComponents(colors: {
  fg: string
  hoverBg: string
  selectedBg: string
  selectedFg: string
  focusRing: string
}): NonNullable<ThemeOptions['components']> {
  return {
    MuiButtonBase: {
      // Flat look + no async ripple timers in tests. With the ripple gone,
      // the focus INDICATOR must come back explicitly — ButtonBase resets
      // the outline, so keyboard users would get nothing at all.
      defaultProps: { disableRipple: true },
      styleOverrides: {
        root: {
          '&.Mui-focusVisible': {
            outline: `2px solid ${colors.focusRing}`,
            outlineOffset: 1,
          },
        },
      },
    },
    MuiSvgIcon: {
      defaultProps: { fontSize: 'small' },
    },
    MuiIconButton: {
      styleOverrides: {
        root: {
          ...CONTROL_METRICS,
          color: colors.fg,
          '&:hover': { backgroundColor: colors.hoverBg },
        },
      },
    },
    MuiToggleButton: {
      styleOverrides: {
        root: {
          border: 'none',
          textTransform: 'none',
          ...CONTROL_METRICS,
          color: colors.fg,
          '&:hover': { backgroundColor: colors.hoverBg },
          '&.Mui-selected': {
            backgroundColor: colors.selectedBg,
            color: colors.selectedFg,
            '&:hover': { backgroundColor: colors.selectedBg },
          },
        },
      },
    },
  }
}

/** Shape + typography both themes share (the flat product look). */
const SHARED_BASE = {
  shape: { borderRadius: 6 },
  typography: {
    fontFamily: FONT,
    button: { textTransform: 'none', fontWeight: 600 },
  },
} satisfies ThemeOptions

const baseOptions: ThemeOptions = {
  palette: {
    primary: { main: TOKEN_DEFAULTS['--editor-accent'] },
    error: { main: TOKEN_DEFAULTS['--editor-danger'] },
    text: {
      primary: TOKEN_DEFAULTS['--editor-text'],
      secondary: TOKEN_DEFAULTS['--editor-text-muted'],
    },
    divider: TOKEN_DEFAULTS['--editor-border-muted'],
    background: {
      paper: TOKEN_DEFAULTS['--editor-surface'],
      default: TOKEN_DEFAULTS['--editor-surface'],
    },
  },
  ...SHARED_BASE,
  components: {
    ...controlComponents({
      fg: tokenVar('--editor-control-fg'),
      hoverBg: tokenVar('--editor-control-hover-bg'),
      selectedBg: tokenVar('--editor-accent-bg'),
      selectedFg: tokenVar('--editor-accent-ink'),
      focusRing: tokenVar('--editor-accent'),
    }),
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: { textTransform: 'none' },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundColor: tokenVar('--editor-surface'),
          color: tokenVar('--editor-text'),
        },
      },
    },
    MuiMenuItem: {
      styleOverrides: {
        root: {
          fontSize: 14,
          '&:hover': { backgroundColor: tokenVar('--editor-menu-active-bg') },
          '&.Mui-selected': { backgroundColor: tokenVar('--editor-menu-active-bg') },
          '&.Mui-selected:hover': { backgroundColor: tokenVar('--editor-menu-active-bg') },
        },
      },
    },
    MuiListSubheader: {
      styleOverrides: {
        root: {
          fontFamily: FONT,
          fontSize: 11,
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.4px',
          lineHeight: '28px',
          color: tokenVar('--editor-text-subtle'),
          backgroundColor: 'transparent',
        },
      },
    },
    MuiDivider: {
      styleOverrides: {
        root: { borderColor: tokenVar('--editor-border') },
      },
    },
    MuiTextField: {
      defaultProps: { size: 'small' },
    },
  },
}

/** Build the editor chrome theme; pass `overrides` to customize on top. */
export function createEditorTheme(overrides?: ThemeOptions): Theme {
  // createTheme deep-merges every extra argument into the built theme.
  return overrides ? createTheme(baseOptions, overrides) : createTheme(baseOptions)
}

const INVERSE_HOVER = `color-mix(in srgb, ${tokenVar('--editor-inverse-fg')} 12%, ${tokenVar('--editor-inverse-bg')})`

/**
 * Dark variant for the bubble pill (the one inverse surface). Palette is
 * literal (MUI math); visible knobs read the `--editor-inverse-*` tokens.
 */
export const editorDarkTheme: Theme = createTheme({
  palette: {
    mode: 'dark',
    primary: { main: TOKEN_DEFAULTS['--editor-inverse-accent'] },
    text: { primary: TOKEN_DEFAULTS['--editor-inverse-fg'] },
    background: { paper: TOKEN_DEFAULTS['--editor-inverse-bg'] },
  },
  ...SHARED_BASE,
  components: {
    ...controlComponents({
      fg: tokenVar('--editor-inverse-fg'),
      hoverBg: INVERSE_HOVER,
      selectedBg: tokenVar('--editor-inverse-accent'),
      selectedFg: tokenVar('--editor-inverse-bg'),
      focusRing: tokenVar('--editor-inverse-accent'),
    }),
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundColor: tokenVar('--editor-inverse-bg'),
          color: tokenVar('--editor-inverse-fg'),
        },
      },
    },
  },
})

const defaultEditorTheme = createEditorTheme()

/**
 * One mount inside DocumentEditor covers EVERY surface: React context crosses
 * `createPortal` AND TipTap's ReactRenderer portals, so the body-portaled
 * menus/popovers/panels inherit it. Custom shells that skip DocumentEditor
 * wrap themselves (next to EditorSkin). No CssBaseline on purpose — the SDK
 * must not reset the consumer's page.
 */
export function EditorThemeProvider({
  theme,
  children,
}: {
  theme?: Theme
  children: ReactNode
}) {
  return <ThemeProvider theme={theme ?? defaultEditorTheme}>{children}</ThemeProvider>
}
