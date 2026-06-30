# Revisão técnica — `document-editor` (SDK de features sobre TipTap v3)

## 1. Veredito executivo

O design tem um núcleo genuinamente bom: contribuições **declarativas** (dados, não JSX) com `render?` como escape hatch, um `resolveFeatures` que falha rápido em colisões de comando/keymap, e — o ponto mais forte — o seam `EditorApi`/`EditorStateView` + `createMockEditor` que torna toolbars/botões testáveis sem ProseMirror. O problema é que a promessa central ("adicione capacidades sem dar fork no core") tem furos reais: o conjunto de canais de UI é um enum fechado, o kernel sempre-ligado conhece o nome de nó de uma feature (`documentFooter`), a stack de sugestão (`/`, `@`) é copy-paste, e comandos são strings sem segurança de tipo nem checagem de integridade referencial. No eixo de correção, há três buracos sérios que custam **dados do cliente**, não tempo de refactor: `setJSON` apaga o documento inteiro silenciosamente diante de um nó desconhecido, invariantes de header/footer e `conditionalBlock` vivem só em guardas imperativas (não no schema), e `SCHEMA_VERSION` é decorativo. Nada disso é bloqueante hoje (é um SDK pré-produção, opt-in, sem documentos persistidos externos), mas o custo de retrofit cresce a cada feature e a cada documento salvo.

| Pilar | Nota | Justificativa |
|---|---|---|
| **Extensibilidade** | **C+** | Registry/defineFeature/canais declarativos são sólidos, mas canais são um enum fechado, o kernel vaza `documentFooter`, comandos são strings sem checagem referencial e a stack de sugestão é clonada por gatilho. "Sem fork" só vale para os 4 surfaces que o core já enviou. |
| **Customização mínima** | **C+** | Escada de toolbar headless (className→render→useToolbar) é excelente; porém as duas coisas mais básicas — salvar e carregar — não têm API de primeira classe, a prop principal `features` é um footgun de remount silencioso, e não há i18n nem menu de contexto em touch. |
| **Performance (docs grandes)** | **B-** | Decisões certas (chip de merge-field em DOM puro, equality-skip do `useEditorState`), mas não há história de escala documentada: sem virtualização/janela, node views React como padrão, e a maioria dos "achados de hot path" é, na verdade, ruído de baixo impacto. |

**O que o design genuinamente acerta:** o seam `EditorApi`/`EditorStateView` + mock (testabilidade headless real); contribuições como dados com `render?` opcional; `resolveFeatures` que lança erro em colisões de comando/keymap em vez de last-writer-wins; `Link.extend({ inclusive: () => false })`; e o chip de merge-field em DOM puro (`mergeField.tsx`) como contraponto correto às node views React. Preserve isso ao corrigir o resto.

---

## 2. Achados (por pilar)

### Extensibilidade

**1. A stack de sugestão/lista flutuante é copy-paste por gatilho** — **severity: high**
- **Evidência:** `src/editor/hooks/slashCommands.tsx:40-74` e `src/features/custom/mergeFieldSuggestion.tsx:124-158`: o helper `place()` é **idêntico** (`position:'fixed'`, `top = rect.bottom + 6`, `zIndex='1000'`), e `onStart/onUpdate/onKeyDown/onExit` diferem só no objeto de props passado ao `ReactRenderer` (`{items,command}` vs `{query,onPick}`). As listas também são clonadas: `SlashMenu.tsx:26-76` ≈ `MergeFieldMenu` (`mergeFieldSuggestion.tsx:38-88`) — mesma matemática `(i+len-1)%len`, mesma marcação `role="option"`/`data-active`, mesma classe `.slash-menu--empty`.
- **Por que importa:** este é o surface-vitrine de extensibilidade. Uma feature de emoji `:` ou de menção `#` precisa re-clonar plugin PM + placement + navegação de teclado — três chances de divergir em z-index, escape e a11y. Correções (ex.: flip-to-top quando cortado) terão de ser aplicadas N vezes.
- **Correção:** extrair dois primitivos para o SDK: (a) `createSuggestionPopup<T>({ char, pluginKey?, component, items, command })` que detém o ciclo `render()/place()/mount/destroy`; (b) `<FloatingList items onPick renderItem>` + `useListKeyboardNav(items)`. **Importante:** preservar quem filtra — `SlashMenu` filtra via `items()` do plugin, `MergeFieldMenu` ignora `items:()=>[]` e filtra internamente do contexto async; o primitivo precisa deixar o componente possuir os itens. (M)

**2. Canais de UI são um enum fechado de 4 — surface novo exige fork** — **severity: medium**
- **Evidência:** `FeatureDefinition` fixa exatamente `toolbar?/insert?/contextMenu?/pageRegions?` (`types.ts:94-103`); `resolveFeatures` agrega exatamente esses quatro via `flatMap` (`registry.ts:71-74`); `DocumentEditor.tsx:46-85` cabeia um consumidor por canal à mão.
- **Por que importa:** uma equipe que queira um surface não previsto (painel à direita auto-montado, gutter de comentários, status bar, drag-handle de bloco) não consegue enviá-lo como feature; precisa editar `types.ts` + `registry.ts` + `DocumentEditor.tsx`. Mitigante: `renderRightBar`/`renderToolbar`/`ToolbarItem.render` já dão escape no nível do **consumidor** — o gap é o surface **declarado pela feature e auto-montado**.
- **Correção:** manter os 4 canais como slots tipados bem-conhecidos, e adicionar um canal aberto `contributes?: Record<string, unknown[]>` agregado genericamente + `<Slot id>`/`useSlot`. Híbrido preserva a validação de shape por canal. (L)

**3. Comandos são strings sem segurança de tipo, sem integridade referencial, com `payload: unknown` e `can()` falso** — **severity: medium** *(merge de 4 lentes)*
- **Evidência:** `CommandFn = (editor, payload?: unknown) => boolean` (`types.ts:6`); todos os canais carregam `commandId: string` (`types.ts:23,40,73`); `exec` retorna `false` silenciosamente em id inexistente (`EditorApi.ts:50-52`); `can = commandId in resolved.commands` (`EditorApi.ts:54`) reporta **registro**, não aplicabilidade na seleção. `resolveFeatures` valida duplicatas (`registry.ts:49,59`) mas **nunca** cross-checa que `commandId`/valores de keymap referenciados existem em `commands`. Features re-castam payload à mão: `(payload ?? {}) as {...}` (`mergeField.tsx:149`, `link.ts:27`).
- **Por que importa:** um botão apontando para `'callout.tooggle'` ou para um comando barrado de um preset renderiza habilitado e vira no-op no clique — sem erro em dev nem prod. É exatamente a classe de bug que um registry que já lança em conflito deveria pegar. Sem autocomplete cross-pacote, typos falham em runtime.
- **Correção (em ordem de custo/benefício):** (a) **agora, S** — em `resolveFeatures`, após montar `commands`, iterar toolbar/insert/contextMenu `commandId` + `pageRegion.addCommandId` + valores de keymap e `throw` listando ids ausentes; (b) exigir/auto-prefixar namespace `<featureId>.<verb>`; (c) tornar `defineFeature` genérico sobre o mapa de comandos (o choke point **já existe** em `defineFeature.ts`) para derivar união `CommandId` + `PayloadOf<K>` — opt-in, não obrigatório. Remover ou implementar `can()` de verdade (hoje é código morto fora de testes). (S→M)

**4. `dependsOn` só checa presença — sem auto-enable nem ordenação** — **severity: low**
- **Evidência:** `if (!byId.has(dep)) throw` (`registry.ts:38-44`); toda ordem (extensões e botões) é ordem de array do consumidor (`registry.ts:68-74`); não há `order`/`priority` em `ToolbarItem`/`FeatureDefinition` (só `group?`, `types.ts:17`).
- **Por que importa:** o consumidor precisa listar cada dependência transitiva e na ordem certa; botões de duas equipes se intercalam por acidente de array.
- **Correção:** topo-sort em `resolveFeatures` por `dependsOn` + `order?: number` opcional em `ToolbarItem`. Manter o throw para deps faltantes (auto-include silencioso conflita com o pilar opt-in; descartar). (S→M)

### Customização mínima

**5. A prop `features` chaveia a identidade do editor por referência de array — array inline recria o editor a cada render** — **severity: high**
- **Evidência:** `useMemo(() => resolveFeatures(options.features), [options.features])` + `useEditor({...}, [resolved])` (`useDocumentEditor.ts:27,29-39`); a única defesa é um JSDoc (`:11`). `resolveFeatures` retorna objeto novo a cada chamada (`registry.ts:27`). `DocumentEditor` é componente público (`index.ts`) cuja prop `features` é o caminho óbvio.
- **Por que importa:** o uso natural `<DocumentEditor features={[Bold, Italic]} />` (array literal novo a cada render) recria o editor a cada re-render do pai: perde foco, seleção, undo, scroll — **silenciosamente**, sem warning. O uso mínimo é o quebrado. `App.tsx` só sobrevive porque define `presets` em escopo de módulo.
- **Correção:** chavear identidade por assinatura estrutural (ids ordenados — `id` já é a identidade canônica do registry) e memoizar `resolved` nisso; array inline passa a ser seguro. Warning opcional em dev quando a referência muda mas o conjunto de ids não. (S)

**6. Não há forma de primeira classe de tirar o documento nem de carregá-lo** — **severity: medium**
- **Evidência:** `DocumentEditorProps` só tem `renderToolbar/renderInsertBar/renderRightBar/zoom` (`DocumentEditor.tsx:18-29`) — sem `onChange`, `onReady`, `ref`. A `api` só escapa pelo ctx do render-prop; em `App.tsx:108` o export é contrabandeado via `onClick={()=>console.log(ctx.api.getHTML())}` dentro da toolbar. Carregar é igualmente travado: `content` é lido uma vez (`useDocumentEditor.ts:36`, deps `[resolved]`), então mudar a prop após mount é no-op — carregar doc async exige remount via `key` (`App.tsx:82`), destruindo undo/scroll.
- **Por que importa:** "salvar o que o usuário digitou" e "carregar um doc buscado async" são o happy path de qualquer consumidor e não têm API suportada — direto contra o pilar de customização mínima.
- **Correção:** adicionar `onChange(doc)` (debounced sobre `update`), `onReady(api)`/`ref`, e tornar `content` controlado-ish via efeito que chama `api.setJSON` ao mudar a identidade (sem recriar o editor). Cuidado: diferenciar identidade e evitar eco com o próprio `onChange`. (M)

**7. Estado "disabled" é morto: `can()` só checa registro e `EditorStateView` só expõe `isActive`** — **severity: medium**
- **Evidência:** `EditorStateView` expõe só `isActive` (`EditorApi.ts:10-12`); `ToolbarItem.isDisabled?: (state: EditorStateView) => boolean` (`types.ts:27`) não consegue consultar disponibilidade de undo/redo nem seleção. Undo/redo vêm sem `isDisabled` (`history.ts:13-14`).
- **Por que importa:** botões não refletem aplicabilidade real — Undo/Redo nunca esmaecem; Link/Image/wrap não se desabilitam quando a seleção proíbe. Affordances "mentem" sobre o que é acionável.
- **Correção:** ampliar `EditorStateView` com poucos predicados read-only (`canUndo`/`canRedo`, `selectionEmpty`) — TipTap já expõe `editor.can()` nativo, e o mock consegue implementar. Default do `isDisabled` dos itens de history a partir disso. Manter o seam mínimo. (M)

**8. Todas as strings de UI são inglês hardcoded dentro dos dados da feature e das node views** — **severity: medium**
- **Evidência:** labels literais nos `FeatureDefinition`: `table.ts:34-60` (`'Insert row above'`…), `history.ts:13-14`, `headerFooter.tsx:116/123`. E embutidos nas node views: `headerFooter.tsx:38` (`'Header'/'Footer'`), `conditionalBlock.tsx:133` (`'Show if'`), `:102` (`'no condition'`), `mergeField` (`'Loading variables…'`), `image.ts:14` (`window.prompt('Image URL:')`). `grep i18n|locale|translat` = vazio.
- **Por que importa:** o próprio público do repo escreve pt-BR. Localizar exige forkar cada feature ou pós-processar canais por id (canais declarativos têm seam central; as node views **não têm nenhum**).
- **Correção:** seam fino de i18n (mesmo padrão de `DocumentVariablesProvider`): `labelKey` + catálogo `en` default por feature, resolvido em `resolveFeatures`/hooks de toolbar; `t()` injetado nos render contexts e node views. Inglês como default mantém zero-config. (M)

**9. Ações de tabela e menu de contexto só funcionam via `contextmenu` desktop — inacessíveis em touch** — **severity: medium**
- **Evidência:** `EditorContextMenu.tsx` liga exclusivamente a `dom.addEventListener('contextmenu', ...)`; sem long-press/pointer fallback (`grep` por touch/pointer = vazio). `table.ts:25-64` roteia **todas** as ações estruturais (add/del linha+coluna, merge/split, delete table) só pelo canal `contextMenu` — sem equivalente em toolbar/insert.
- **Por que importa:** em tablet/celular dá pra inserir uma tabela 3×3 (insert rail), mas nunca adicionar linha/remover coluna — funcionalidade morta numa classe inteira de dispositivos. (Android Chrome sintetiza `contextmenu` em long-press; iOS Safari não.)
- **Correção:** (a) abrir o mesmo `ContextMenuView` via long-press/pointer; (b) também expor ações de tabela na BubbleToolbar quando `isActive('table')`, reusando os mesmos command ids (a `BubbleToolbar` já renderiza contribuições `toolbar`; a feature de tabela hoje não contribui nenhuma). (M)

### Performance

**10. Documento inteiro renderizado avidamente; node views React como padrão — sem teto de janela/paginação** — **severity: medium**
- **Evidência:** três de quatro nós custom usam `ReactNodeViewRenderer` (`callout.tsx:53`, `conditionalBlock.tsx:203`, `headerFooter.tsx:72`); `EditorContent` renderiza o doc inteiro (`DocumentEditor.tsx:73`); `grep virtual|window|content-visibility|pagination` em `src` = vazio. Contraste: `mergeField.tsx:44-55` usa node view em DOM puro.
- **Por que importa:** PM já renderiza o DOM completo (inerente ao engine, ao qual o projeto se comprometeu) e cada nó React multiplica custo de mount/update. Header/footer são singletons (não escalam), mas callout/conditional podem somar centenas de subárvores React. `CalloutView` (`callout.tsx:16-26`) não tem estado — poderia ser DOM puro.
- **Por que medium e não high:** o teto sem janela é do ProseMirror, não introduzido por este SDK; e os nós afetados são exemplos de "team feature", não o set core.
- **Correção:** decidir e **documentar** a história de escala: orçamento de tamanho máximo; preferir DOM puro para blocos sem estado (converter `Callout`, usando `mergeField` como template); montar UI pesada do `Conditional` sob demanda (só selecionado/hover); avaliar `content-visibility` para blocos fora da viewport. Tornar "node view React" um escape hatch opt-in no SDK, não o padrão. (L)

**11. `PageAffordances` re-renderiza a cada transação e re-escaneia o doc top-level via `hasNode` sem early-exit** — **severity: low** *(merge de 4 lentes)*
- **Evidência:** `PageAffordances.tsx:22-25` assina todo `update` (`useReducer` bump incondicional) e chama `api.hasNode(region.nodeName)` por render; `hasNode` (`EditorApi.ts:35-40`) faz `doc.forEach` sem break; `DocumentEditor.tsx:70-76` monta duas instâncias (top+bottom).
- **Por que importa (calibrado):** `doc.forEach` itera só os filhos **top-level** (não a árvore inteira), e cada instância só escaneia a região da sua posição — ou seja, ~2 scans rasos + 2 re-renders de um componente trivial por tecla. É desperdício real mas microssegundos, não regressão sentida. Inflar para medium contra o pilar de perf é exagero.
- **Correção:** early-exit em `hasNode` (loop `for i<doc.childCount` com `return true`); derivar presença via `useFeatureState`/selector com equality-skip em vez de bump cego. **Não** "desinscrever quando presente" (a affordance precisa reaparecer se o nó for deletado) e **não** atalho `firstChild`/`lastChild` (acopla a uma ordenação não imposta pelo schema). (S)

**12. `setJSON` substitui o documento inteiro via `setContent` — reparse completo** — **severity: low**
- **Evidência:** `setJSON: (doc) => editor.commands.setContent(doc.doc)` (`EditorApi.ts:43-45`), único caminho de carga em runtime.
- **Por que importa:** é O(N) reparse + replace de doc inteiro; um padrão de consumidor que round-trippe por `setJSON` paga o custo total mesmo para mudança pequena. (Nota: em TipTap v3 o `setContent` **não** zera o histórico — esse subitem de findings anteriores está incorreto; e `exec(commandId)` já oferece mutação incremental, então consumidores não são forçados a `setJSON` para edição pequena.)
- **Correção:** documentar `setJSON` como operação pesada de "load", não canal de update. Adiar um `applyPatch`/Step-diff até existir um consumidor de update incremental real (escopo desnecessário hoje). (S doc)

**13. `getHTML`/`getJSON` serializam o doc inteiro sem cache** — **severity: low**
- **Evidência:** `document.ts:23-25,28-30` são passthroughs; `EditorApi.ts:42,46` expõem sem memo. Único call site hoje é um `console.log` on-click (`App.tsx:108`).
- **Correção:** enviar um helper `onChange(serialized)` debounced no SDK (a metade útil) + nota de que são O(N) e não devem rodar em render/por-transação. Tratar cache keyed-por-doc como YAGNI até existir autosave/preview, e só para `getHTML` (string imutável; `getJSON` retorna objeto mutável — cachear arrisca bug de estado compartilhado). (S)

**14. Carga async de variáveis dispara fan-out a todo `ConditionalBlockView`** — **severity: low**
- **Evidência:** `documentVariables.tsx` passa o array direto no value do contexto; `App.tsx:24-36` troca `[]`→lista ~1.5s após mount; cada `ConditionalBlockView` (`conditionalBlock.tsx:112`) consome o contexto e roda dois `find` lineares (`:101-108`).
- **Por que importa (calibrado):** é transição **única** na carga, e o re-render é **semanticamente necessário** (o label muda de id-fallback para label real). O custo dominante é re-renderizar N node views, que um `Map` O(1) não evita.
- **Correção:** indexar variáveis num `Map<id,DocumentVariable>` na fronteira do provider para lookup O(1) (limpeza barata). Pular o redesign de selector/`useVariable(id)` — context React não tem subscrição por chave, e o ganho quase não existe aqui. (S)

### Transversal (correção / dados / segurança)

**15. Posição, unicidade e não-aninhamento de header/footer são impostos só por guardas imperativas — o schema aceita documentos inválidos** — **severity: high** *(merge de 3 lentes)*
- **Evidência:** kernel usa o `Document` stock (`buildExtensions.ts:17`, content default `block+`); `documentHeader`/`documentFooter` são `group:'block', content:'block+', isolating:true` (`headerFooter.tsx:55-78`); unicidade/posição só em comando: `if (docHasNode(...)) return false` + `insertContentAt(0|size,...)` (`:91-108`). `parseHTML` casa `div[data-document-header]` em qualquer lugar (`:63-65`). O kernel ainda **vaza** o nome de nó de uma feature: `TrailingNode.configure({ notAfter: ['documentFooter'] })` (`buildExtensions.ts:17`).
- **Por que importa:** dois headers, footer no meio, conteúdo após o footer, ou header/footer aninhado em callout/conditional/célula de tabela são **documentos válidos**. Qualquer caminho que bypassa o comando — paste de HTML do backend (dois divs de header), `setJSON` de doc fora de ordem, drag-drop, `conditional.toggle`/`callout.toggle` sobre seleção que inclui a região — atinge esse estado. Quebra o contrato `getHTML`→PDF (backend assume exatamente um header no topo, repetido por página) e é hostil a colaboração. `isolating:true` só impede cruzar a fronteira do conteúdo; **não** restringe posição, contagem ou pai. Além disso, header-como-nó-de-corpo não expressa repetição por página / números de página.
- **Correção:** impor no schema, não em comandos. **Cuidado com o mecanismo:** hardcodar `Document.extend({ content: 'documentHeader? block+ documentFooter?' })` no kernel quebra quando a feature está desligada (PM rejeita expressão referenciando nó inexistente) e fere o pilar opt-in. Melhor alinhado: a `HeaderFooterFeature` registra um `appendTransaction`/`filterTransaction` próprio que rejeita segundo header/footer ou posição inválida (compõe com o registry, zero config no consumidor); compor `notAfter` a partir de metadados da feature em vez do literal no kernel; opcionalmente mover regiões para um `group:'region'` fora de `block` para proibir aninhamento estruturalmente. Longo prazo, considerar `regions: Record<name, JSONContent>` ao lado de `doc` em `DocumentJSON`. (M)

**16. `conditionalBlock` carrega `data-*` crítico para o backend mas é `defining` sem `isolating` — o wrapper de condição pode ser silenciosamente fundido** — **severity: high**
- **Evidência:** `Node.create({ name:'conditionalBlock', group:'block', content:'block+', defining:true ... })` (`conditionalBlock.tsx:159-205`) — **sem** `isolating:true` (contraste `headerFooter.tsx:61` que o tem). `renderHTML` emite `data-variable/condition/value` que "o backend lê … e inclui/exclui o bloco" (`:192-200`).
- **Por que importa:** sem `isolating`, o cursor cruza a fronteira: Backspace no início do primeiro bloco interno, ou seleção que começa fora e termina dentro, faz JOIN/lift do conteúdo interno para fora do `conditionalBlock`, **descartando** o wrapper `{variable,condition,value}`. O usuário vê o texto sobreviver enquanto a semântica condicional some — o backend passa a renderizar incondicionalmente conteúdo que deveria ser gated (risco de correção/compliance em contratos). `content:'block+'`+`group:'block'` também permite aninhamento arbitrário de condicionais.
- **Correção:** adicionar `isolating:true` a `conditionalBlock` (igualando header/footer). Decidir e documentar o contrato de aninhamento; se o backend não suporta condicionais aninhados, restringir `content`. Adicionar teste de round-trip que deleta cruzando a fronteira e afirma que os `data-*` sobrevivem. (S)

**17. `setJSON` descarta o documento INTEIRO silenciosamente em qualquer nó desconhecido; `schemaVersion` é decorativo** — **severity: high** *(merge de 2 lentes)*
- **Evidência:** `setJSON: (doc) => editor.commands.setContent(doc.doc)` sem opções (`EditorApi.ts:43-45`); editor criado sem `enableContentCheck` (default `false` no TipTap v3), então `createNodeFromContent` faz `try { schema.nodeFromJSON } catch { console.warn(...); return createNodeFromContent('', ...) }` — **um nó ruim colapsa o doc todo para vazio**. `toDocumentJSON` sempre re-estampa `schemaVersion: SCHEMA_VERSION` (`document.ts:23-25`); `setJSON` nunca lê `doc.schemaVersion`; `grep migrat` só acha o comentário "drives migrations later" (`document.ts:3`). Mesmo wipe vale para o `content` inicial (`useDocumentEditor.ts:36`).
- **Por que importa:** abrir um doc com `mergeField`/`conditionalBlock`/`callout` com a feature desligada (ou de outra equipe) **substitui o documento inteiro** por um parágrafo vazio, e o `getJSON` seguinte re-estampa v1 — um round-trip de save **destrói permanentemente** o conteúdo do usuário com apenas um `console.warn`. Ataca extensibilidade (nós de outras equipes não são forward/backward-safe) e a história de persistência.
- **Correção (priorizar (2)+(3) sobre (1)):** (2) passar `setContent(doc.doc, { errorOnInvalidContent: true })` ou `enableContentCheck: true` + `onContentError`, virando wipe silencioso em erro recuperável/observável; (3) registrar um nó fallback genérico que preserva o JSON de nós desconhecidos (round-trippable), degradando feature desligada para conteúdo inerte em vez de deleção; (1) ler `doc.schemaVersion`, recusar (`throw`) versões futuras desconhecidas em vez de re-estampar v1, e um pipeline de migração `vN→vN+1` — com cada feature contribuindo suas migrações via `FeatureDefinition.migrations?` (mantém o pilar no-fork). Cuidado: `throw` em `setJSON` o torna função parcial; expor resultado tipado/contrato documentado. Adicionar golden tests de round-trip por nó custom. (M)

**18. `getHTML` é o contrato de PDF/backend mas não há camada de sanitização** — **severity: medium**
- **Evidência:** `exportHTML = (editor) => editor.getHTML()` sem pós-processamento (`document.ts:28-30`). `image.ts:9-17` insere `src` cru de payload/`window.prompt` sem checagem de protocolo; `@tiptap/extension-image` não valida o esquema. Link **é** protegido (`isAllowedUri` bloqueia `javascript:`), então o gap é tudo que não é Link. `headerFooter`/`conditionalBlock` serializam `data-*` que o backend parseia para renderizar o PDF.
- **Por que importa:** um documento controlado pelo atacante pode embutir `<img src>` apontando para URLs internas (SSRF / exfiltração cega quando o backend busca imagens para rasterizar). E cada nova feature com atributo passthrough (href cru, style, `data-*`, embed src) entra direto no backend sem guarda — extensibilidade piora isso com o tempo.
- **Correção:** preferir validação de protocolo na fronteira do schema/por-extensão (barato, componível, sem custo no export de docs grandes) — dar a `Image` um check estilo `isAllowedUri` espelhando Link. **Cuidado:** um sanitizer allowlist genérico (DOMPurify) sobre `getHTML` removeria justamente os `data-merge-field`/`data-variable/condition/value` que carregam semântica, quebrando o pipeline de PDF; se for por sanitizer central, precisa ser allowlist custom que preserva `data-*`. Adicionar teste de contrato que carrega HTML/JSON hostil e afirma saída limpa. (M)

**19. Colaboração (Yjs) e comentários/track-changes estão arquiteturalmente bloqueados pelo seam fino** — **severity: medium** *(estratégico)*
- **Evidência:** `setJSON` faz replace destrutivo do doc (`EditorApi.ts:43-44`); `history.ts:7` instala `UndoRedo` local (que o undo colaborativo do y-prosemirror precisa substituir); a superfície `EditorApi` (`:19-30`) expõe só getJSON/setJSON/getHTML/hasNode/focus/exec/can/on('update'|'selection') — `on('selection')` é callback void sem ranges; sem transações/steps/decorations/awareness. `FeatureDefinition` não tem canal para UI ancorada em seleção (threads de comentário) nem metadata de documento.
- **Por que importa:** comentários e track-changes são features de decoration ancoradas em range; um produto estilo Docs precisa delas. Uma feature pode contrabandear um plugin PM via `extensions()`, mas a camada app não consegue ler coordenadas de seleção nem renderizar UI de gutter/thread por nenhum canal.
- **Correção (sem sobre-construir):** capturar a decisão de postura agora como design note; implementar só o barato se/quando uma feature ancorada em range for agendada — `getSelection()` (ranges em coordenadas estáveis) e um canal `decorations`/`comments` em `FeatureDefinition`. **Não** construir o caminho Yjs ainda (escopo prematuro). (L)

**20. A garantia de fronteira de engine repousa em um único regex sobre `src/app`** — **severity: low**
- **Evidência:** `import-boundary.test.ts:6,22` escaneia só o próprio dir; regex `/\bfrom\s+['"]@tiptap\//` (`:25`) perde `import()` dinâmico, `require` e re-exports, e por design nada diz sobre `src/features` (onde features importam `@tiptap/*` livremente — 23 imports).
- **Por que importa:** a promessa de customização ("o app nunca toca `@tiptap`") está a um `await import()` de regredir silenciosamente, e a suíte sem escopo sugere falsamente que o SDK de features também esconde o engine (deliberadamente não esconde).
- **Correção:** regra eslint `no-restricted-imports` sobre `@tiptap/*` escopada a `src/app` (cobre estático+dinâmico, roda no save) + comentário documentando que `src/features` PODE importar `@tiptap`. Preferir a regra lint ao check via AST. (S)

**21. Boilerplate `mountTarget()` + ciclo de vida do editor copiado em 10 arquivos de teste** — **severity: low**
- **Evidência:** `grep -l 'function mountTarget' src` = 10 arquivos, corpos byte-idênticos; o ritual `let created; afterEach(() => created?.editor.destroy())` e um `hasNode(json,type)` recursivo também duplicados (`inserts.test.ts:31-34`).
- **Por que importa:** imposto de manutenção que cresce linearmente com features; qualquer mudança no mount/teardown (ex.: embrulhar com `DocumentVariablesProvider`) precisa ser editada em 10 lugares.
- **Correção:** `src/test/editorHarness.ts` com `renderEditor(features, opts)` (monta, retorna `{editor,api,resolved}`, auto-destrói via `afterEach`/`onTestFinished`) + `jsonHasNode`; converter as 10 suítes. `renderWithVariables` só onde os specs de variáveis precisam. (S)

**22. Framing "engine-agnostic" do `EditorApi` é contornado pelo próprio contrato de feature** — **severity: low** *(nit de documentação)*
- **Evidência:** `CommandFn`/`ToolbarItemContext` entregam o `Editor` cru às features (`types.ts:6,9-12`); o teste de fronteira só cobre `src/app`. Mas o código **já assume** isso: `EditorApi.ts:16-17` declara que o facade é "Light by design (engine-swap is hygiene, not a real requirement)", e o veredito registrado na memória é "comprometer-se com o TipTap".
- **Por que importa:** é um design de dois níveis intencional e auto-documentado (app insulado, features TipTap-native), não uma contradição. O resíduo é só uma ou outra docstring que pode soar como over-claim.
- **Correção:** apertar 1-2 docstrings para deixar explícito o desenho de dois níveis. **Não** envolver features num wrapper rico de capacidades (é exatamente a abstração multi-engine que vocês decidiram não perseguir; encareceria toda feature). (S)

---

## 3. Plano de correção faseado

### Fase 0 — Quick wins (baixo risco/esforço, alto valor)

Objetivo: matar footguns silenciosos e buracos de correção de baixo esforço **antes** de qualquer usuário externo salvar um documento. Sem dependências entre os itens — todos podem ir em paralelo.

- [ ] **`isolating:true` em `conditionalBlock`** (`conditionalBlock.tsx:163`) + teste de round-trip que deleta cruzando a fronteira e afirma `data-*` preservados. **S** — fecha um buraco de correção/compliance (achado 16). *Faça primeiro.*
- [ ] **Integridade referencial de command ids em `resolveFeatures`** (`registry.ts`, após `:54`): um loop que valida toolbar/insert/contextMenu `commandId` + `pageRegion.addCommandId` + valores de keymap contra `commands`, lançando lista de ausentes. **S** — vira no-op silencioso em erro de boot (achado 3a).
- [ ] **Chavear identidade do editor por assinatura de ids** (`useDocumentEditor.ts:27`): memoizar `resolved` sobre ids ordenados em vez da referência do array. **S** — elimina o footgun de remount na prop principal (achado 5).
- [ ] **`onContentError` + `errorOnInvalidContent`/`enableContentCheck`** no setup do editor e em `setJSON` (`EditorApi.ts:43`, `useDocumentEditor.ts:29`). **S→M** — transforma wipe total silencioso em erro recuperável (achado 17, parte 2). *Pré-requisito para a Fase 3 de migrações.*
- [ ] **Early-exit em `hasNode`** (`EditorApi.ts:35-40`, loop `for` com `return true`). **S** — limpeza barata (achado 11).
- [ ] **Check de protocolo em `Image`** espelhando o `isAllowedUri` do Link (`image.ts:9-17`) + teste de contrato com HTML hostil. **S→M** — fecha SSRF via `<img src>` (achado 18).
- [ ] **Regra eslint `no-restricted-imports @tiptap/*` escopada a `src/app`** + comentário liberando `src/features` (achado 20). **S**
- [ ] **Doc strings:** marcar `setJSON` como "load" pesado (achado 12), e apertar o framing de dois níveis do `EditorApi` (achado 22). **S**

### Fase 1 — Estrutural: extensibilidade + API

Objetivo: reduzir proliferação de canais, dar segurança aos command ids, e fechar a API de save/load. Ordem importa: o seam de comandos (e o `defineFeature` genérico) deve vir antes do refactor de sugestão, porque o primitivo de popup vai consumir comandos tipados.

- [ ] **Namespace `<featureId>.<verb>` validado em `resolveFeatures`** + opcionalmente `defineFeature` genérico sobre o mapa de comandos para derivar união `CommandId`/`PayloadOf<K>` (o choke point já existe em `defineFeature.ts`). **M** — autocomplete cross-pacote, payload tipado opt-in (achado 3b/3c). *Depende do quick-win de integridade referencial.*
- [ ] **API de dados de primeira classe em `DocumentEditor`** (`DocumentEditor.tsx:18-29`): `onChange(doc)` debounced sobre `update`, `onReady(api)`/`ref`, e `content` controlado-ish via efeito que chama `api.setJSON` sem recriar o editor (cuidar de diff de identidade e eco). **M** — remove o hack de render-prop e o anti-padrão remount-to-load (achado 6). *Depende do quick-win de identidade por ids.*
- [ ] **Extrair primitivos de sugestão:** `createSuggestionPopup<T>` + `<FloatingList>`/`useListKeyboardNav`, reduzindo `slashCommands.tsx` e `mergeFieldSuggestion.tsx` a ~15 linhas de config, **preservando** quem possui o filtro. **M** — colapsa o surface-vitrine de extensibilidade (achado 1).
- [ ] **`EditorStateView` mais rico** (`canUndo`/`canRedo`, `selectionEmpty`) + `can()` real (ou renomear/remover) + default de `isDisabled` em history. **M** — estado disabled deixa de ser morto (achado 7).
- [ ] **Topo-sort em `resolveFeatures` por `dependsOn` + `order?` opcional em `ToolbarItem`.** **S→M** — ordenação determinística (achado 4). Manter throw para deps faltantes.
- [ ] **(Opcional) canal aberto `contributes?: Record<string, unknown[]>` + `<Slot id>`/`useSlot`**, mantendo os 4 canais tipados. **L** — roadmap, não bloqueante dado os escape hatches existentes (achado 2).

### Fase 2 — Performance para docs grandes

Objetivo: definir e documentar a história de escala; a maioria dos micro-scans é ruído, então o foco é o teto arquitetural e helpers de serialização. Sem dependências fortes da Fase 1.

- [ ] **Decidir e documentar orçamento de tamanho + política de node view:** DOM puro como default, `ReactNodeViewRenderer` como escape hatch opt-in. Converter `Callout` para DOM puro usando `mergeField.tsx` como template; montar UI pesada do `Conditional` sob demanda. **L** — endereça o teto de docs grandes (achado 10).
- [ ] **`PageAffordances` via `useFeatureState`/selector com equality-skip** em vez do bump cego (`PageAffordances.tsx:22-25`). **S** — remove re-renders por tecla (achado 11). *Depende do early-exit da Fase 0.*
- [ ] **Helper `onChange(serialized)` debounced no SDK** + nota de que `getHTML`/`getJSON` são O(N) (achado 13). **S** — pode coincidir com a API de dados da Fase 1.
- [ ] **`Map<id,DocumentVariable>` na fronteira do `DocumentVariablesProvider`** para `conditionText` O(1) (achado 14). **S** — limpeza barata; pular o redesign de selector.

### Fase 3 — Estratégico/futuro

Objetivo: decisões caras de retrofit — esquema de header/footer, migrações, colaboração, i18n, mobile. Capturar postura agora; construir só o que tem consumidor agendado, respeitando o no-scope-creep.

- [ ] **Invariantes de header/footer no schema, não em comandos** (achado 15): `appendTransaction`/`filterTransaction` **owned pela `HeaderFooterFeature`** (não expressão hardcoded no kernel, que quebra com a feature desligada) rejeitando segundo header/footer ou posição inválida; compor `notAfter` de metadados da feature; opcionalmente `group:'region'` fora de `block`. **M** — *deve preceder* qualquer trabalho de paginação real e a postura de colaboração, pois define a forma do doctree.
- [ ] **Pipeline de migração de schema** (achado 17, parte 1+3): ler/validar `doc.schemaVersion`, recusar versões futuras; registry `vN→vN+1` com migrações contribuídas por feature; nó fallback round-trippable para tipos desconhecidos; golden tests por nó custom. **M** — *depende do `onContentError` da Fase 0.* Fazer antes do primeiro save externo.
- [ ] **Postura de colaboração** (achado 19): design note agora; implementar só `getSelection()` (ranges estáveis) + canal `decorations`/`comments` em `FeatureDefinition` quando uma feature ancorada em range for agendada. **Não** construir Yjs ainda. **L**
- [ ] **Seam de i18n** (achado 8): `labelKey` + catálogo `en` default por feature, resolvido em `resolveFeatures`/hooks de toolbar; `t()` injetado em render contexts e node views. Inglês mantém zero-config. **M** — a metade de canais declarativos é barata (seam central já existe); as node views são a parte que precisa do `t()` threaded.
- [ ] **Touch/mobile para tabela** (achado 9): long-press abrindo o mesmo `ContextMenuView` + ações de tabela na BubbleToolbar quando `isActive('table')`, reusando command ids. **M**
- [ ] **Harness de teste compartilhado** `src/test/editorHarness.ts` (achado 21). **S** — pode ir a qualquer momento; reduz atrito para autores de feature.

**Dependências-chave entre fases:** Fase 0 (`onContentError`, identidade por ids, integridade referencial) destrava com segurança a API de dados e o seam de comandos da Fase 1; o seam de comandos tipados deve preceder o refactor de sugestão; o esquema de header/footer (Fase 3) deve preceder paginação e a postura de colaboração; o `onContentError` (Fase 0) é pré-requisito do pipeline de migração (Fase 3).