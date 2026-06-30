import { useState } from 'react'
import { BubbleToolbar, DocumentEditor, EditorToolbar } from '../editor'
import { PillToolbar } from './PillToolbar'
import { presets } from './presets'
import './styles.css'

type ToolbarStyle = 'default' | 'pill' | 'bubble'

export default function App() {
  const [presetId, setPresetId] = useState(presets[0].id)
  const [toolbarStyle, setToolbarStyle] = useState<ToolbarStyle>('default')
  const preset = presets.find((p) => p.id === presetId) ?? presets[0]

  return (
    <div className="app">
      <header className="app__bar">
        <span className="app__title">Documento sem título</span>
        <div className="app__controls">
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
              <option value="default">Padrão (+ botão custom)</option>
              <option value="pill">Pill (custom via useToolbar)</option>
              <option value="bubble">Bubble (na seleção)</option>
            </select>
          </label>
        </div>
      </header>

      <main className="app__canvas">
        {/* Same features, three different toolbar presentations — chosen by the app. */}
        <DocumentEditor
          // Remount only when the feature set changes; toolbar style just re-renders.
          key={preset.id}
          features={preset.features}
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
      </main>
    </div>
  )
}
