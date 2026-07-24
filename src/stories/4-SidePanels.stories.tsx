import { useEffect, useRef, useState } from 'react'
import Close from '@mui/icons-material/Close'
import KeyboardArrowDown from '@mui/icons-material/KeyboardArrowDown'
import KeyboardArrowUp from '@mui/icons-material/KeyboardArrowUp'
import IconButton from '@mui/material/IconButton'
import type { Meta, StoryObj } from '@storybook/react-vite'
import {
  DocumentEditor,
  InsertToolbar,
  useDismissable,
  useFeatureState,
  type DocumentEditorRenderContext,
  type EditorApi,
} from '../editor'
import { ALL_FEATURES, Shell, STARTER_DOC, VARIABLES_DOC } from './storyShell'


const meta = {
  title: 'Editor/4. Side panels',
  component: DocumentEditor,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Both gutters are CONSUMER-owned: `renderLeftPanel` / `renderRightPanel` render anything, ' +
          'pinned to the viewport edges (`--editor-rail-gutter`). They receive the same context as ' +
          'every render prop — so even the insert actions can move into a panel. (The comments ' +
          'panel — the flagship right-panel tenant — has its own story group: "9. Comments".)',
      },
    },
  },
} satisfies Meta<typeof DocumentEditor>

export default meta
type Story = StoryObj

export const ActionsInTheLeftPanel: Story = {
  name: 'Insert actions in the LEFT panel',
  render: () => (
    <Shell>
      <style>{`
        .sb-side-actions {
          position: sticky;
          top: 16px;
          display: flex;
          flex-direction: column;
          gap: 4px;
          padding: 6px;
          background: #fff;
          border: 1px solid #e0e0e0;
          border-radius: 12px;
          box-shadow: 0 1px 3px rgba(60, 64, 67, 0.15);
        }
      `}</style>
      <DocumentEditor
        features={ALL_FEATURES}
        content={STARTER_DOC}
        renderFooter={() => null}
        renderLeftPanel={(ctx) => <InsertToolbar {...ctx} className="sb-side-actions" />}
      />
    </Shell>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'The recipe: suppress the footer (`renderFooter={() => null}`) and drop the headless ' +
          '`InsertToolbar` into `renderLeftPanel` with your own class — here styled as a vertical ' +
          'sticky card. Same live actions, different surface; the `/` menu keeps mirroring them.',
      },
    },
  },
}

// Plain consumer code: `findNodes` hands every chip with its LIVE position;
// grouping by id keeps EVERY occurrence in document order, so the navigator
// can step through them (positions[0] is where a plain click lands).
function usedVariables(api: EditorApi) {
  const byId = new Map<string, { label: string; positions: number[] }>()
  for (const { pos, attrs } of api.findNodes('variable')) {
    const id = String(attrs.id ?? '')
    const entry = byId.get(id)
    if (entry) entry.positions.push(pos)
    else byId.set(id, { label: String(attrs.label ?? id), positions: [pos] })
  }
  return [...byId.entries()].map(([id, entry]) => ({ id, ...entry }))
}

// The Docs-style "1 of N" pill. `position: fixed` pins it over the top of the
// page (the WINDOW is the scroller, so it stays put while the chevrons scroll
// the document). Esc closes via the shared dismiss contract; outside clicks
// keep it open on purpose — constant-false `isOutsideClick`, like Docs' find
// bar.
function OccurrenceNavigator({
  index,
  count,
  onStep,
  onClose,
}: {
  index: number
  count: number
  onStep: (delta: 1 | -1) => void
  onClose: () => void
}) {
  const pillRef = useRef<HTMLDivElement>(null)
  useDismissable([pillRef], onClose, { isOutsideClick: () => false })
  // Keep the chip's node selection while clicking the pill.
  const keepSelection = (event: React.MouseEvent) => event.preventDefault()
  return (
    <div ref={pillRef} className="sb-var-nav" role="toolbar" aria-label="Variable occurrences">
      <span className="sb-var-nav__count">
        {index + 1} of {count}
      </span>
      <IconButton
        size="small"
        aria-label="Previous occurrence"
        onMouseDown={keepSelection}
        onClick={() => onStep(-1)}
      >
        <KeyboardArrowUp fontSize="small" />
      </IconButton>
      <IconButton
        size="small"
        aria-label="Next occurrence"
        onMouseDown={keepSelection}
        onClick={() => onStep(1)}
      >
        <KeyboardArrowDown fontSize="small" />
      </IconButton>
      <span className="sb-var-nav__divider" />
      <IconButton size="small" aria-label="Close" onMouseDown={keepSelection} onClick={onClose}>
        <Close fontSize="small" />
      </IconButton>
    </div>
  )
}

function UsedVariablesPanel({ editor, api }: DocumentEditorRenderContext) {
  // Re-derived on every transaction, so a click always scrolls to a CURRENT
  // position; deep-equal keeps re-renders away while the list is stable.
  const used = useFeatureState(editor, () => usedVariables(api))
  // The navigator stores id + index, NEVER a position — positions shift on
  // every edit, so each jump re-reads them from the live list above.
  const [active, setActive] = useState<{ id: string; index: number } | null>(null)

  const entry = active ? used?.find((variable) => variable.id === active.id) : undefined
  const openFor = entry && entry.positions.length > 1 ? entry : undefined
  const activeIndex = active && openFor ? Math.min(active.index, openFor.positions.length - 1) : 0

  // Editing can delete chips out from under the navigator — close it once its
  // variable stops being a multi-occurrence one.
  useEffect(() => {
    if (active && !openFor) setActive(null)
  }, [active, openFor])

  if (!used || used.length === 0) return null

  const goTo = (positions: number[], index: number) => {
    const wrapped = (index + positions.length) % positions.length
    editor.commands.setNodeSelection(positions[wrapped])
    api.scrollTo(positions[wrapped])
    return wrapped
  }

  return (
    <>
      <nav className="sb-var-outline" aria-label="Variables in use">
        <div className="sb-var-outline__title">In this document</div>
        {used.map((variable) => (
          <button
            key={variable.id}
            type="button"
            className="sb-var-outline__item"
            onClick={() => {
              if (variable.positions.length > 1) {
                setActive({ id: variable.id, index: goTo(variable.positions, 0) })
              } else {
                // Single occurrence: nothing to step through — dismiss an open
                // pill first (collapsing its node-selection outline, same as
                // the × button), then plain-jump without selecting.
                if (openFor) editor.commands.setTextSelection(openFor.positions[activeIndex])
                setActive(null)
                api.scrollTo(variable.positions[0])
              }
            }}
          >
            <span className="sb-var-outline__chip">{variable.label}</span>
            {variable.positions.length > 1 ? (
              <span className="sb-var-outline__count">×{variable.positions.length}</span>
            ) : null}
          </button>
        ))}
      </nav>
      {openFor ? (
        <OccurrenceNavigator
          index={activeIndex}
          count={openFor.positions.length}
          onStep={(delta) => {
            setActive({ id: openFor.id, index: goTo(openFor.positions, activeIndex + delta) })
          }}
          onClose={() => {
            // Collapse the node selection to a caret so the outline clears.
            editor.commands.setTextSelection(openFor.positions[activeIndex])
            setActive(null)
          }}
        />
      ) : null}
    </>
  )
}

export const UsedVariablesInTheLeftPanel: Story = {
  name: 'Used variables in the LEFT panel',
  render: () => (
    <Shell>
      <style>{`
        .sb-var-outline {
          position: sticky;
          top: 16px;
          width: 200px;
          padding: 12px;
          background: #fff;
          border: 1px solid #e0e0e0;
          border-radius: 12px;
          box-shadow: 0 1px 3px rgba(60, 64, 67, 0.15);
        }
        .sb-var-outline__title {
          font-size: 12px;
          font-weight: 600;
          color: #5f6368;
          margin-bottom: 8px;
        }
        .sb-var-outline__item {
          display: flex;
          align-items: center;
          gap: 6px;
          width: 100%;
          padding: 6px 8px;
          border: 0;
          border-radius: 8px;
          background: none;
          font: inherit;
          cursor: pointer;
          text-align: left;
        }
        .sb-var-outline__item:hover { background: #f1f3f4; }
        .sb-var-outline__chip {
          padding: 0 6px;
          border-radius: 4px;
          font-size: 13px;
          background: var(--editor-variable-bg);
          border: 1px solid var(--editor-variable-border);
          color: var(--editor-variable-fg);
          white-space: nowrap;
        }
        .sb-var-outline__count { font-size: 12px; color: #5f6368; }
        .sb-var-nav {
          position: fixed;
          top: 76px;
          left: 50%;
          transform: translateX(-50%);
          z-index: var(--editor-z-popup);
          display: flex;
          align-items: center;
          gap: 2px;
          padding: 4px 6px 4px 14px;
          background: #fff;
          border: 1px solid #e0e0e0;
          border-radius: 999px;
          box-shadow: 0 1px 3px rgba(60, 64, 67, 0.3);
        }
        .sb-var-nav__count { font-size: 13px; color: #3c4043; margin-right: 6px; white-space: nowrap; }
        .sb-var-nav__divider { width: 1px; height: 18px; background: #e0e0e0; margin: 0 4px; }
        .variable-chip.ProseMirror-selectednode {
          outline: 2px solid #1a73e8;
          outline-offset: 1px;
        }
      `}</style>
      <DocumentEditor
        features={ALL_FEATURES}
        content={VARIABLES_DOC}
        renderLeftPanel={(ctx) => <UsedVariablesPanel {...ctx} />}
      />
    </Shell>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'An outline panel over the document itself: `api.findNodes("variable")` returns every chip ' +
          'with its live position and attrs, `useFeatureState` re-derives the list on each edit, and ' +
          'clicking an entry calls `api.scrollTo(pos)` — DOM-based scrolling, so it works even though ' +
          'the click keeps focus in the panel. Note the subset: the @ menu offers five variables, but ' +
          'the panel lists only the three the DOCUMENT uses (insert another to watch it appear). ' +
          'Clicking a REPEATED variable (×count) opens a Docs-style "1 of N" pill over the page: the ' +
          'chevrons wrap around the occurrences, each jump is consumer code composing the seams — ' +
          '`editor.commands.setNodeSelection(pos)` for the highlight (`scrollTo` never touches ' +
          'selection) plus `api.scrollTo(pos)` — and Esc/× close it via the shared dismiss contract ' +
          '(`useDismissable`), while outside clicks keep it open, like Docs. Clicking a ' +
          'SINGLE-occurrence variable plain-jumps and dismisses an open pill (nothing to step ' +
          'through). Delete chips while it is open: the count shrinks live and the pill closes ' +
          'itself below two occurrences.',
      },
    },
  },
}
