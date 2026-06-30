import { defineFeature } from '../../editor'

function AiButton({ onRun }: { onRun: () => void }) {
  return (
    <button
      type="button"
      className="ai-button"
      title="Inserir um rascunho da IA"
      onMouseDown={(event) => event.preventDefault()}
      onClick={onRun}
    >
      ✨ IA
    </button>
  )
}

/**
 * Example "team" feature that ships a *fully custom toolbar control* (a styled
 * button) through `ToolbarItem.render` — no new extension, just a core command.
 * Demonstrates that a team can contribute bespoke toolbar UI via the registry.
 */
export const AiAssistFeature = defineFeature({
  id: 'aiAssist',
  extensions: () => [],
  commands: {
    'ai.insert': (editor) => editor.chain().focus().insertContent(' [rascunho da IA] ').run(),
  },
  toolbar: [
    {
      id: 'aiAssist',
      group: 'actions',
      label: 'IA',
      render: ({ api }) => <AiButton onRun={() => api.exec('ai.insert')} />,
    },
  ],
})
