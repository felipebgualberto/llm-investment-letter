# Case técnico — carta mensal de investimentos

**Felipe Bissoli Gualberto** · setembro de 2026

---

## Por onde começar

| Ordem | Arquivo | O que é |
|---|---|---|
| **1** | [`RELATORIO.docx`](../delivery/RELATORIO.docx) | **O relatório pedido no enunciado** — 2 páginas: o que estava errado, o que fiz e por quê, o que faria com um mês |
| **2** | [`solution/out/letter.pdf`](../solution/out/letter.pdf) | **A carta** — PT-BR, 2 páginas, com identidade da XP |
| **3** | [`letter_workflow_v2.rivet-project`](../letter_workflow_v2.rivet-project) | **O workflow revisado** — 33 nós, gerado por código |

Se quiser ir mais fundo, nesta ordem:

- [`solution/out/annex.pdf`](../solution/out/annex.pdf) — anexo do assessor, 7 páginas. Tudo o que não coube
  nas duas páginas da carta. **Nenhuma palavra dele vem de LLM.**
- [`solution/out/console.html`](../solution/out/console.html) — o console do assessor. Abre com duplo clique,
  sem servidor e sem instalar nada.
- [`solution/README.md`](../solution/README.md) — como o motor funciona, fonte por fonte.
- [`DOSSIE-TECNICO.docx`](../delivery/DOSSIE-TECNICO.docx) — o detalhamento completo. **Não é o relatório**: é material de
  consulta, com cada decisão e cada defeito encontrado.

---

## A ideia, em uma linha

> **Código determinístico calcula todo número. O modelo só escreve frases.**

A v1 pedia a um único modelo que extraísse os dados *e* escrevesse o texto. Extração é o que um LLM faz
pior, e falha em silêncio: em vez de erro, produz um número plausível. Foi assim que a carta original
publicou "Selic em 9%" — que era **exatamente a mediana do Focus em maio/2024**, a janela de treinamento
do modelo — enquanto o relatório da XP no contexto dizia 15,50%.

---

## Rodar

Precisa de **Node.js 20+**. Sem dependências de runtime.

```bash
cd solution
npm test          # 213 testes, offline
npm run build     # regenera carta, anexo e console
```

Ou, **sem terminal**: duplo clique em [`ABRIR-CONSOLE.cmd`](../ABRIR-CONSOLE.cmd) — ele roda o build e abre o
console. Se o Node não estiver instalado, ele explica isso em português e lembra que os documentos já
gerados abrem sozinhos.

Verificações que o build faz e que valem rodar isoladas:

```bash
npm run palette       # contraste WCAG + daltonismo (protan/deuteran/tritan)
npm run report-pages  # conta as páginas impressas do RELATORIO.md
```

> `npm run build` consulta Banco Central, CVM e provedor de cotações. Se o pacote veio com
> `solution/out/cache/`, tudo roda **offline** e reproduz os mesmos números byte a byte. Sem o cache,
> é preciso internet na primeira execução.

---

## O que está em cada pasta

```
RELATORIO.docx            o relatório (2 páginas) — fonte em .md ao lado
DOSSIE-TECNICO.docx       detalhamento completo, para consulta
letter_workflow_v2.rivet-project    workflow revisado
letter_workflow_v1.rivet-project       o original, para comparação
ABRIR-CONSOLE.cmd         atalho sem terminal

Input/                    os arquivos do case, intocados
Output/                   a carta da v1, para comparação

solution/
  src/parse/              extrato, macro, preços, perfil -> JSON reconciliado
  src/data/               BCB SGS · Focus · Yahoo · CVM
  src/engine/             rentabilidade · adequação · recomendação · plano da carta
  src/render/             carta · anexo · console · gráficos · identidade
  src/validate/           o validador de números, também embutido no grafo
  config/                 todo limiar, marcado assumption: true|false
  tools/                  gerador do grafo · paleta · logo · páginas do relatório
  test/                   213 testes
  out/                    tudo o que o build produz
```

---

## Uma nota sobre a logo

A marca no cabeçalho é a da XP, **extraída do PDF que a própria XP entregou neste case**
(`Input/XP - Albert_s risk profile.pdf`) por [`solution/tools/extract-brand-mark.js`](../solution/tools/extract-brand-mark.js).
Nada foi baixado da internet nem redesenhado de memória.
