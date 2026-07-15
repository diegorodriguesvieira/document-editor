# Especificação — Novo formato de condição do `conditionalBlock`

> **Audiência:** agente/dev de backend responsável pelo renderizador de PDF.
> **Status:** contrato decidido em 2026-07-02 (Diego + João). O editor ainda vai migrar para este formato; este documento é a fonte de verdade para os dois lados.
> **Migração de dados:** NÃO é necessária compatibilidade com o formato antigo — o produto é um protótipo sem documentos em produção. O backend pode cortar direto para o formato novo (basta atualizar fixtures/templates de teste junto).

---

## 1. Contexto

O documento contém blocos condicionais (`conditionalBlock`). O backend avalia a condição de cada bloco no momento de renderizar o PDF e **inclui ou exclui o conteúdo do bloco** conforme o resultado. Blocos podem estar aninhados: se o bloco externo é excluído, todo o conteúdo interno (incluindo blocos aninhados) desaparece junto — **aninhamento = AND por contenção**, e isso NÃO muda com este spec. Cada bloco continua sendo avaliado de forma independente, olhando apenas a própria condição.

### O que muda

| | Formato ANTIGO (remover) | Formato NOVO |
|---|---|---|
| Doc JSON (attrs) | `{ "variable": "...", "condition": "EQUALS", "value": "..." }` | `{ "condition": { "all": [ ... ] } }` — objeto único, recursivo |
| HTML | 3 atributos: `data-variable`, `data-condition` (string do operador), `data-value` | 1 atributo: `data-condition` (JSON serializado) |
| Operandos | `value` sempre literal string; impossível comparar variável com variável | operandos tipados `{type: "variable"}` \| `{type: "literal"}`; literais com tipo JSON nativo (`18`, não `"18"`) |
| Multi-condição | só por aninhamento de blocos | `all` (AND) / `any` (OR) dentro de um mesmo bloco, recursivos |

---

## 2. O formato

### 2.1 Tipos

```ts
type Condition =
  | { all: Condition[] }   // AND — verdadeiro se TODAS as filhas forem verdadeiras
  | { any: Condition[] }   // OR  — verdadeiro se ALGUMA filha for verdadeira
  | Leaf

interface Leaf {
  op: ConditionOp | null            // null = rascunho (condição incompleta)
  params: (Operand | null)[]        // posicional; aridade definida por SIGNATURES[op]
}

type Operand =
  | { type: 'variable'; ref: string }                       // referência a uma variável do documento
  | { type: 'literal';  value: string | number | boolean }  // valor bruto, tipado

type ConditionOp =
  | 'EXISTS' | 'NOT_EXISTS'
  | 'EQUALS' | 'NOT_EQUALS'
  | 'GREATER_THAN' | 'LESS_THAN'
```

> **Nomes no SDK do editor** (para quem importar os tipos de lá): `ConditionOp` é exportado
> como `ConditionId` (nome histórico, estável); os demais exports são `Condition`,
> `ConditionLeaf`, `ConditionOperand`, `CONDITION_SIGNATURES` e `isCompleteCondition`.

Regras estruturais:

- Um nó da condição tem **exatamente uma** das chaves `all`, `any`, ou o par `op`/`params`. Presença de `all` ou `any` identifica um combinador; caso contrário é folha.
- `all`/`any` são recursivos: uma filha pode ser outra `all`/`any` (agrupamento, ex.: `(a OU b) E c`). A UI do editor emite profundidade 1 por enquanto, mas **o backend DEVE suportar recursão** — o formato permite.
- `params` é **posicional**: o significado de cada posição é definido pelo operador (tabela abaixo). O tamanho do array deve ser exatamente a aridade do operador.
- Campos `null` (`op: null` ou algum elemento de `params` null) representam **rascunho** — condição que o autor ainda não terminou de preencher. Ver §5 (política de erro).
- A **raiz** aceita qualquer `Condition` (inclusive uma folha solta), mas o editor emite canonicamente `{ "all": [...] }` — mesmo com uma única condição.
- Valor **default** de um bloco recém-inserido (contrato do editor): `{ "all": [ { "op": null, "params": [null, null] } ] }` — rascunho, que falha validação até o autor completar (intencional; ver §5).

### 2.2 Tabela de operadores (`SIGNATURES`)

O vocabulário de operadores é contrato estável (mesmos ids do formato antigo — não renomear).

| `op` | Aridade | Semântica (posições de `params`) |
|---|---|---|
| `EXISTS` | 1 | `params[0]` resolve para valor presente (não `undefined`, não `null`, não `""`) |
| `NOT_EXISTS` | 1 | negação de `EXISTS` |
| `EQUALS` | 2 | `resolve(params[0]) == resolve(params[1])` — comparação como **string** (§2.4) |
| `NOT_EQUALS` | 2 | negação de `EQUALS` |
| `GREATER_THAN` | 2 | `Number(resolve(params[0])) > Number(resolve(params[1]))` |
| `LESS_THAN` | 2 | `Number(resolve(params[0])) < Number(resolve(params[1]))` |

```js
const SIGNATURES = {
  EXISTS: 1,
  NOT_EXISTS: 1,
  EQUALS: 2,
  NOT_EQUALS: 2,
  GREATER_THAN: 2,
  LESS_THAN: 2,
}
```

Operador desconhecido ou aridade errada = **erro de validação** (§5), nunca ignorar silenciosamente.

`EXISTS`/`NOT_EXISTS` com operando **literal** é estruturalmente válido e avaliado normalmente pelo teste de presença (literal `""` → `EXISTS` false; literal `0` ou `false` → `EXISTS` true, pois estão presentes). É degenerado (resultado constante) — o validador PODE emitir warning, mas não rejeita.

### 2.3 Resolução de operandos

- `{type: 'variable', ref}`: lookup de `ref` no mapa **flat** de variáveis que o backend já usa para variables (mesmos ids — ex.: `client.name`, `valor.mensal`). **`ref` é chave opaca**: o `.` faz parte do id, NÃO é traversal de objeto aninhado — não fazer split. Usar lookup de chave própria (`Object.hasOwn` ou equivalente): refs vindas do documento não podem alcançar herança/prototype chain (`"toString"`, `"constructor"`, ...). Variável fora do mapa (ou com valor `null`) resolve para **ausente** — não é erro; avalia pelas regras do §2.4.
- `{type: 'literal', value}`: o próprio `value`, já com tipo JSON (string, number ou boolean).

### 2.4 Coerção e valores ausentes — regras normativas

Tipagem de variáveis está **adiada** (decisão de 2026-07-02). Até lá, as regras abaixo são o contrato — definidas de forma **independente de linguagem** (não dependa de peculiaridades do `Number()`/`String()` de JS):

**Valor ausente** (variável fora do mapa de dados, ou com valor `null`):

- `EXISTS` → `false`; `NOT_EXISTS` → `true` (são exatamente o teste de presença).
- **Qualquer comparação (`EQUALS`, `NOT_EQUALS`, `GREATER_THAN`, `LESS_THAN`) com operando ausente → `false`** (semântica estilo SQL NULL). Atenção à assimetria intencional: com variável ausente, `NOT_EQUALS` também dá `false` — `NOT_EQUALS` **não** é a negação de `EQUALS` nesse caso.

**Comparação como string** (`EQUALS`/`NOT_EQUALS`) — cada operando resolvido vira string assim:

| Tipo do valor resolvido | Vira |
|---|---|
| string | ela mesma (sem trim — `"joao "` ≠ `"joao"`) |
| number | representação decimal (`18` → `"18"`, `10.5` → `"10.5"`) |
| boolean | `"true"` / `"false"` (minúsculas — atenção, Python daria `"True"`) |

**Comparação numérica** (`GREATER_THAN`/`LESS_THAN`) — cada operando resolvido vira número assim:

| Tipo do valor resolvido | Vira |
|---|---|
| number | ele mesmo |
| string | após trim, se for um número JSON válido (`"18"`, `"10.5"`, `"-3"`, `"1e3"`) → esse número; senão **inválido** (string vazia inclusive) |
| boolean | **inválido** |

Operando **inválido** em comparação numérica → a folha avalia `false` (opcionalmente logar warning).

Quando o registry de variáveis ganhar tipos declarados, esta seção será revisada.

---

## 3. Serialização — mudanças no parse

### 3.1 Se o backend consome o **JSON do documento** (ProseMirror JSON)

Nenhum parsing extra: `attrs.condition` já é o objeto nativo.

```jsonc
{
  "type": "conditionalBlock",
  "attrs": {
    "condition": {
      "all": [
        { "op": "EQUALS", "params": [ { "type": "variable", "ref": "client.name" }, { "type": "literal", "value": "joao" } ] }
      ]
    }
  },
  "content": [ { "type": "paragraph", "content": [ { "type": "text", "text": "hello 1" } ] } ]
}
```

### 3.2 Se o backend consome o **HTML** (`editor.getHTML()`)

O editor passa a emitir **um único atributo** `data-condition` contendo o JSON `JSON.stringify`-ado. Como vai dentro de atributo HTML, as aspas saem escapadas (`&quot;`):

```html
<!-- ANTES (remover suporte): -->
<div data-conditional-block class="conditional-block"
     data-variable="client.name" data-condition="EQUALS" data-value="joao">
  <p>hello 1</p>
</div>

<!-- DEPOIS: -->
<div data-conditional-block class="conditional-block"
     data-condition="{&quot;all&quot;:[{&quot;op&quot;:&quot;EQUALS&quot;,&quot;params&quot;:[{&quot;type&quot;:&quot;variable&quot;,&quot;ref&quot;:&quot;client.name&quot;},{&quot;type&quot;:&quot;literal&quot;,&quot;value&quot;:&quot;joao&quot;}]}]}">
  <p>hello 1</p>
</div>
```

Identificação do bloco: o marcador canônico é o **atributo** `data-conditional-block` (valor vazio) — selecionar por `[data-conditional-block]`. A classe `conditional-block` é só estilo e pode mudar sem aviso.

Ajustes no parser do backend:

1. **Ler apenas `data-condition`**; `data-variable` e `data-value` deixam de existir.
2. Usar um parser HTML de verdade (cheerio/jsdom/lxml/nokogiri/...): `getAttribute` devolve o valor **já des-escapado** (`&quot;` → `"`). Extração por regex teria que des-escapar entidades manualmente — não fazer.
3. `JSON.parse` do valor do atributo, **com try/catch**. JSON malformado ou ausente = erro de validação (§5), nunca "incluir o bloco por padrão".
4. Validar o objeto contra o schema (§4) antes de avaliar.

---

## 4. Validação (obrigatória antes de avaliar)

```js
// Caps recomendados (configuráveis) — proteção contra payload profundo/gigante:
const MAX_CONDITION_DEPTH = 10
const MAX_CONDITION_LEAVES = 50

/** Lança erro com o caminho do problema. Rascunhos (nulls) NÃO passam. */
function validateCondition(cond, path = 'condition', depth = 0, state = { leaves: 0 }) {
  if (depth > MAX_CONDITION_DEPTH) throw new Error(`${path}: depth > ${MAX_CONDITION_DEPTH}`)
  if (cond == null || typeof cond !== 'object') throw new Error(`${path}: not an object`)

  // Exclusividade (§2.1): um nó é EXATAMENTE uma das três formas — nunca `all`+`any`,
  // nunca combinador com `op`/`params` sobrando. Rejeitar, não escolher uma.
  const forms = ('all' in cond ? 1 : 0) + ('any' in cond ? 1 : 0) + ('op' in cond || 'params' in cond ? 1 : 0)
  if (forms !== 1) throw new Error(`${path}: node must be exactly one of all | any | {op, params}`)

  if ('all' in cond || 'any' in cond) {
    const key = 'all' in cond ? 'all' : 'any'
    const children = cond[key]
    if (!Array.isArray(children) || children.length === 0)
      throw new Error(`${path}: empty/invalid ${key}`)
    children.forEach((c, i) => validateCondition(c, `${path}.${key}[${i}]`, depth + 1, state))
    return
  }

  // Folha
  if (++state.leaves > MAX_CONDITION_LEAVES)
    throw new Error(`${path}: more than ${MAX_CONDITION_LEAVES} leaves`)
  const arity = SIGNATURES[cond.op]
  if (arity == null) throw new Error(`${path}: unknown op ${JSON.stringify(cond.op)}`)
  if (!Array.isArray(cond.params) || cond.params.length !== arity)
    throw new Error(`${path}: op ${cond.op} expects ${arity} params, got ${cond.params?.length}`)
  cond.params.forEach((p, i) => {
    if (p == null) throw new Error(`${path}.params[${i}]: incomplete (null) — draft condition`)
    if (p.type === 'variable') {
      if (typeof p.ref !== 'string' || p.ref === '') throw new Error(`${path}.params[${i}]: invalid variable ref`)
    } else if (p.type === 'literal') {
      if (!['string', 'number', 'boolean'].includes(typeof p.value))
        throw new Error(`${path}.params[${i}]: invalid literal type`)
    } else {
      throw new Error(`${path}.params[${i}]: unknown type ${JSON.stringify(p?.type)}`)
    }
  })
}
```

Ambos os caps são **obrigatórios** (o cap de folhas é imposto pelo contador `state.leaves` acima).

O editor exporta `isCompleteCondition()` e valida no **publish** — em teoria o backend nunca recebe rascunho. Mas o backend valida de novo (defense in depth): documento pode chegar por caminhos que não passaram pelo publish.

---

## 5. Política de erro — IMPORTANTE (compliance)

Condição **inválida, malformada ou incompleta** (nulls de rascunho) = **falhar a renderização com erro explícito**, apontando o bloco problemático.

- **Nunca** fail-open (incluir o bloco na dúvida): cláusula contratual aparece para quem não devia.
- **Nunca** fail-closed silencioso (excluir na dúvida): cláusula que devia aparecer some sem ninguém perceber.

A única exceção que NÃO é erro: variável referenciada ausente do mapa de dados — resolve para **ausente** e a condição avalia normalmente pelas regras do §2.4 (`EXISTS` → false, comparações → false, `NOT_EXISTS` → true).

Consequência intencional do default do editor (§2.1): um bloco inserido e nunca configurado é rascunho e **derruba o render com erro**. Rascunho chegando ao backend significa que o documento não passou pelo publish (`isCompleteCondition()` bloqueia lá) — falhar alto é o comportamento correto, não um bug.

---

## 6. Avaliador de referência

```js
function resolveOperand(operand, variables) {
  if (operand.type === 'variable') {
    // hasOwn: refs vindas do documento não podem alcançar a prototype chain
    // ("toString", "constructor", ...). `ref` é chave OPACA — sem split em ".".
    return Object.hasOwn(variables, operand.ref) ? variables[operand.ref] : undefined
  }
  return operand.value
}

const missing = (v) => v === undefined || v === null
const present = (v) => !missing(v) && v !== ''

// §2.4 — coerções normativas:
const toStr = (v) => (typeof v === 'boolean' ? (v ? 'true' : 'false') : String(v))
const toNum = (v) => {
  if (typeof v === 'number') return v
  if (typeof v !== 'string') return null // ausente/boolean → inválido
  const s = v.trim()
  return /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/.test(s) ? Number(s) : null
}

/** Pré-condição: validateCondition(cond) passou. */
function evaluateCondition(cond, variables) {
  if ('all' in cond) return cond.all.every((c) => evaluateCondition(c, variables))
  if ('any' in cond) return cond.any.some((c) => evaluateCondition(c, variables))

  const v = cond.params.map((p) => resolveOperand(p, variables))
  switch (cond.op) {
    case 'EXISTS':      return present(v[0])
    case 'NOT_EXISTS':  return !present(v[0])
    // §2.4: operando ausente em comparação → false (inclusive NOT_EQUALS).
    case 'EQUALS':      return !missing(v[0]) && !missing(v[1]) && toStr(v[0]) === toStr(v[1])
    case 'NOT_EQUALS':  return !missing(v[0]) && !missing(v[1]) && toStr(v[0]) !== toStr(v[1])
    case 'GREATER_THAN': {
      const [a, b] = [toNum(v[0]), toNum(v[1])]
      return a !== null && b !== null && a > b
    }
    case 'LESS_THAN': {
      const [a, b] = [toNum(v[0]), toNum(v[1])]
      return a !== null && b !== null && a < b
    }
    // Inalcançável após validateCondition — cinto de segurança contra
    // fail-closed silencioso (§5) se alguém avaliar sem validar.
    default: throw new Error(`unvalidated op: ${JSON.stringify(cond.op)}`)
  }
}
```

Uso no render: para cada `conditionalBlock`, `validateCondition` → `evaluateCondition` → incluir o conteúdo se `true`, descartar (com todo o subtree) se `false`.

---

## 7. Exemplos

**Condição única — `client.name === 'joao'`:**

```json
{ "all": [
  { "op": "EQUALS", "params": [
    { "type": "variable", "ref": "client.name" },
    { "type": "literal", "value": "joao" }
  ] }
] }
```

**Variável × variável** (impossível no formato antigo):

```json
{ "all": [
  { "op": "EQUALS", "params": [
    { "type": "variable", "ref": "client.age" },
    { "type": "variable", "ref": "brazilianLegalAge" }
  ] }
] }
```

**Unário:**

```json
{ "all": [
  { "op": "EXISTS", "params": [ { "type": "variable", "ref": "client.cnpj" } ] }
] }
```

**Multi-condição (AND) com literal numérico tipado:**

```json
{ "all": [
  { "op": "GREATER_THAN", "params": [ { "type": "variable", "ref": "valor.mensal" }, { "type": "literal", "value": 10000 } ] },
  { "op": "EQUALS",       "params": [ { "type": "variable", "ref": "prazo.meses" },  { "type": "literal", "value": 12 } ] }
] }
```

**OR:**

```json
{ "any": [
  { "op": "EQUALS", "params": [ { "type": "variable", "ref": "client.country" }, { "type": "literal", "value": "Brazil" } ] },
  { "op": "EQUALS", "params": [ { "type": "variable", "ref": "client.country" }, { "type": "literal", "value": "Portugal" } ] }
] }
```

**Agrupamento — `(PJ E Simples) OU PF` (backend deve suportar; UI ainda não emite):**

```json
{ "any": [
  { "all": [
    { "op": "EQUALS", "params": [ { "type": "variable", "ref": "client.type" },       { "type": "literal", "value": "PJ" } ] },
    { "op": "EQUALS", "params": [ { "type": "variable", "ref": "client.taxRegime" },  { "type": "literal", "value": "simples" } ] }
  ] },
  { "op": "EQUALS", "params": [ { "type": "variable", "ref": "client.type" }, { "type": "literal", "value": "PF" } ] }
] }
```

**Rascunho (deve ser REJEITADO pela validação):**

```json
{ "all": [ { "op": null, "params": [ { "type": "variable", "ref": "client.name" }, null ] } ] }
```

**Mapeamento formato antigo → novo** (para atualizar fixtures/templates):

```jsonc
// antigo:
{ "variable": "valor.mensal", "condition": "GREATER_THAN", "value": "10000" }
// novo (note o literal virando número — operador de comparação numérica):
{ "all": [ { "op": "GREATER_THAN", "params": [
  { "type": "variable", "ref": "valor.mensal" },
  { "type": "literal", "value": 10000 }
] } ] }

// antigo (unário — value era null/ignorado):
{ "variable": "client.cnpj", "condition": "EXISTS", "value": null }
// novo:
{ "all": [ { "op": "EXISTS", "params": [ { "type": "variable", "ref": "client.cnpj" } ] } ] }
```

**Aninhamento de blocos (inalterado — AND por contenção):**

```html
<div data-conditional-block data-condition="...condição A...">
  <p>Visível se A.</p>
  <div data-conditional-block data-condition="...condição B...">
    <p>Visível se A E B.</p>
  </div>
</div>
```

---

## 8. Checklist de ajustes no backend

- [ ] Parser HTML: ler `data-condition` (JSON, entidades des-escapadas pelo parser), remover leitura de `data-variable`/`data-value`.
- [ ] `JSON.parse` com try/catch; malformado → erro explícito (§5).
- [ ] Implementar `SIGNATURES` + `validateCondition` (aridade, kinds, nulls, exclusividade `all`/`any`/folha, caps de profundidade E de folhas).
- [ ] Implementar `evaluateCondition` recursivo (`all`/`any` + switch de operadores) com as regras normativas do §2.4 (coerção + valor ausente).
- [ ] Política de erro do §5: render falha com erro apontando o bloco; nunca incluir/excluir silenciosamente.
- [ ] Manter avaliação independente por bloco (aninhamento = AND por contenção, sem código novo).
- [ ] Atualizar fixtures/templates internos para o formato novo (sem dual-read — protótipo).
- [ ] Testes: cada operador; variável × variável; literal tipado (`18` vs `"18"` no EQUALS); variável ausente (EXISTS false, EQUALS **e** NOT_EQUALS false, sem erro); duas variáveis ausentes NÃO são iguais; ref de prototype chain (`"toString"`) resolve como ausente; `any` recursivo/agrupamento; nó com `all`+`any` rejeitado; rascunho rejeitado; JSON malformado rejeitado; profundidade > cap e folhas > cap rejeitadas; HTML com `&quot;` parseado corretamente.

---

## 9. Extensões previstas — NÃO implementar agora

Documentadas apenas para que ninguém "invente" um formato diferente quando chegarem:

- **`BETWEEN`** (aridade 3: `[valor, min, max]`) — entra como nova linha em `SIGNATURES`, sem mudança de forma.
- **Operando computado** `{ "type": "conditional", "if": <Condition>, "then": <Operand>, "else": <Operand> }` — novo `type`, avaliado como `evaluate(if) ? resolve(then) : resolve(else)`.
- **ELSE de bloco** (`condição ? conteúdo A : conteúdo B`) — extensão do **nó** `conditionalBlock`, não deste formato de condição.
- **Combinador `not`** — se necessário; hoje os operadores negados (`NOT_EQUALS`, `NOT_EXISTS`) cobrem os casos.

Validadores devem **rejeitar** esses shapes até que sejam oficialmente adicionados ao contrato.
