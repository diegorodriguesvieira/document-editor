import { useEffect, useState } from 'react'
import { BubbleToolbar, DocumentEditor, EditorToolbar } from '../editor'
import { DocumentVariablesProvider, type DocumentVariable } from '../features'
import { PillToolbar } from './PillToolbar'
import { ZoomRail } from './ZoomRail'
import { presets } from './presets'
import './styles.css'

type ToolbarStyle = 'default' | 'pill' | 'bubble'

const clampZoom = (z: number) => Math.min(Math.max(Math.round(z * 10) / 10, 0.5), 2)

export default function App() {
  const [presetId, setPresetId] = useState(
    presets.find((p) => p.id === 'full')?.id ?? presets[0].id,
  )
  const [toolbarStyle, setToolbarStyle] = useState<ToolbarStyle>('bubble')
  const [zoom, setZoom] = useState(1)
  const preset = presets.find((p) => p.id === presetId) ?? presets[0]

  // Fake API: @-variables arrive ~1.5s after mount. Because they flow through
  // context (not the `features` list), the editor mounts immediately and does
  // NOT remount when they arrive — only the @ modal fills in.
  const [mergeVariables, setMergeVariables] = useState<DocumentVariable[]>([])
  useEffect(() => {
    const timer = setTimeout(() => {
      setMergeVariables([
        { id: 'cliente.nome', label: 'Client name' },
        { id: 'cliente.cnpj', label: 'Tax ID' },
        { id: 'contrato.numero', label: 'Contract number' },
        { id: 'contrato.vigencia', label: 'Term' },
        { id: 'valor.mensal', label: 'Monthly amount' },
      ])
    }, 1500)
    return () => clearTimeout(timer)
  }, [])

  return (
    <div className="app">
      <header className="app__bar">
        <span className="app__title">Untitled document</span>
        <div className="app__controls">
          <span className="app__hint">
            @ variables: {mergeVariables.length ? `${mergeVariables.length} loaded` : 'loading…'}
          </span>
          <label className="app__preset">
            Features:{' '}
            <select
              aria-label="Features"
              value={presetId}
              onChange={(event) => setPresetId(event.target.value)}
            >
              {presets.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="app__preset">
            Toolbar:{' '}
            <select
              aria-label="Toolbar"
              value={toolbarStyle}
              onChange={(event) => setToolbarStyle(event.target.value as ToolbarStyle)}
            >
              <option value="default">Default (+ custom button)</option>
              <option value="pill">Pill (custom via useToolbar)</option>
              <option value="bubble">Bubble (on selection)</option>
            </select>
          </label>
        </div>
      </header>

      <main className="app__canvas">
        {/* Document variables come from here (consumer), via context — shared by
            merge fields and conditional blocks. */}
        <DocumentVariablesProvider variables={mergeVariables}>
          {/* Same features, three different toolbar presentations — chosen by the app. */}
          <DocumentEditor
            // Remount only when the feature set changes; toolbar style just re-renders.
            key={preset.id}
            features={preset.features}
            zoom={zoom}
            // `onChange` is debounced (~250ms after edits stop) — i.e. the exact
            // moment an autosave would fire. Here we just log the generated JSON.
            onChange={(doc) => {
              console.log(`[autosave ${new Date().toLocaleTimeString()}] would persist now`)
              console.log('document JSON:', doc)
            }}
            renderRightBar={() => (
              <ZoomRail
                zoom={zoom}
                onZoomIn={() => setZoom((z) => clampZoom(z + 0.1))}
                onZoomOut={() => setZoom((z) => clampZoom(z - 0.1))}
              />
            )}
            renderToolbar={(ctx) => {
              if (toolbarStyle === 'bubble') {
                // Formatting on selection; skip undo/redo (not selection-scoped).
                return <BubbleToolbar {...ctx} filter={(item) => item.group !== 'history'} />
              }
              if (toolbarStyle === 'pill') {
                return <PillToolbar {...ctx} />
              }
              return (
                <EditorToolbar {...ctx}>
                  {/* Level 2: an app-level custom button dropped into the default toolbar */}
                  <button
                    type="button"
                    className="editor-toolbar__btn"
                    title="Exportar HTML (console)"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => console.log(ctx.api.getHTML())}
                  >
                    ⤓ HTML
                  </button>
                </EditorToolbar>
              )
            }}
          />
        </DocumentVariablesProvider>
      </main>
    </div>
  )
}
