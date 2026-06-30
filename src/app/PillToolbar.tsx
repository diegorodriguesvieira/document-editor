import { useToolbar, type DocumentEditorRenderContext } from '../editor'

/**
 * A team's *own* toolbar — totally different markup and style (a dark pill,
 * bubble-menu vibe), built only on the headless `useToolbar` hook. It never
 * imports `@tiptap/*`, and still honors features' custom `render` controls.
 */
export function PillToolbar({ editor, api, resolved }: DocumentEditorRenderContext) {
  const buttons = useToolbar(editor, api, resolved)

  return (
    <div className="pill-toolbar" role="toolbar" aria-label="Formatting">
      {buttons.map((button) =>
        button.item.render ? (
          <span key={button.item.id} className="pill-toolbar__custom">
            {button.item.render({ editor, api })}
          </span>
        ) : (
          <button
            key={button.item.id}
            type="button"
            className="pill-toolbar__btn"
            data-on={button.active}
            disabled={button.disabled}
            title={button.item.label}
            aria-label={button.item.label}
            aria-pressed={button.active}
            onMouseDown={(event) => event.preventDefault()}
            onClick={button.run}
          >
            {button.item.icon ?? button.item.label}
          </button>
        ),
      )}
    </div>
  )
}
