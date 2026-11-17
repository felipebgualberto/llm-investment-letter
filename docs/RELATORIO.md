# Carta mensal de investimentos — revisão do workflow

**Felipe Bissoli Gualberto** · setembro de 2026
Detalhamento completo em [`DOSSIE-TECNICO.docx`](../delivery/DOSSIE-TECNICO.docx) · código em [`solution/`](../solution/)

---

## 1. O que estava errado

A v1 pede a **um único modelo** que extraia os dados *e* escreva o texto. Extração é o que um LLM faz
pior e, pior ainda, falha em silêncio: em vez de erro, produz um número plausível. Todos os defeitos
saem dessa causa única.

**Alucinação factual.** A carta afirma Selic 9%, IPCA 4,0% e câmbio R$ 4,70. O relatório da própria XP,
que estava no contexto, projeta **15,50%**, **6,1%** e **6,20**. Fui atrás da origem na API de
Expectativas do Banco Central: a mediana Focus para a Selic de 2025 foi **exatamente 9,00% em maio/2024**,
e o IPCA **4,00% em outubro/2024**. O modelo não inventou ao acaso — **recitou o consenso da própria
janela de treinamento** enquanto o documento certo estava na frente dele. É por isso que o problema não
se resolve com um prompt melhor.

**Números de performance sem fonte.** "Retorno total de 3,5%" e "fundos com 17,4%" não derivam de nenhum
input. E a coluna "Rentabilidade" do extrato é retorno **desde a compra** — LREN3: `16,94 ÷ 29,05 − 1 =
−41,7%`. A v1 leu quatro anos de acumulado e narrou como se fosse o mês.

**"Prezado João".** O cliente é Albert. O prompt continha o exemplo *"Prezado João, segue o relatório..."*
e o modelo copiou o **conteúdo** em vez do **formato**. Vazamento clássico de few-shot.

**Escopo.** O CSV de preços — único arquivo com preço atual *e* anterior, a única fonte de onde um retorno
mensal poderia sair — nunca é lido. Não há recomendação de compra ou venda, nem verificação de adequação
ao perfil, e a saída morre como markdown dentro de um nó de chat.

## 2. O que fiz, e por quê

> **Código determinístico calcula todo número. O modelo só escreve frases.**

Tudo decorre disso. O modelo recebe um plano com os valores prontos e rotulados; não calcula, não escolhe
o que cortar e não alcança nenhuma fonte de dados. Ataquei **as três áreas** do enunciado.

**Rentabilidade.** O extrato vira JSON validado por seis identidades que ele mesmo tem que satisfazer
(`investido + caixa = patrimônio`, `qtd × preço = posição`…). As duas metades do PDF não têm chave que as
ligue: junto por ordem e **provo o join pela aritmética**. Quatro APIs públicas entram — BCB SGS, Focus,
Yahoo e **CVM**. A CVM é o que transforma **67,71% da carteira de "não mensurável" em medido**: a cota mais
recente do extrato é de 04/04/2024, 398 dias antes do próprio extrato. Resultado: **+2,62%** apurados sobre
**86,94%** do investido, contra CDI de 1,06% — com a cobertura declarada, nunca arredondada para "100%".

**Recomendação.** Universo fechado, critério do próprio perfil do cliente, e a mesma peneira rodando **nos
dois sentidos**: três ações para avaliar a compra (PETR4, BBAS3, VALE3, todas aprovadas no critério de
dividendos) e duas que o Albert **já tem** e reprovam nele (MRFG3, HAPV3). **35,8% do que ele tem em ações
não passa no critério que a carta usa para justificar compras.** Citar a cláusula só onde ela ajuda a
comprar seria desonesto.

**Formatação.** A carta sai em PDF de duas páginas com a identidade da XP, painel de resumo, três gráficos
intercalados com o texto, bloco de próximos passos e as informações obrigatórias. **O limite de duas páginas
é verificado**, não estimado: o build conta os objetos de página no PDF e falha se passar.

Três decisões que sustentam o resto:

- **Quem corta é regra, não o modelo.** O que cabe em duas páginas é escolhido em `config/` **antes** da
  narração. Se eu entregasse tudo com "mantenha em duas páginas", o modelo decidiria quais achados o cliente
  nunca ouve — diferente a cada execução e sem teste possível. O que foi cortado é **contado e declarado**.
- **Toda suposição é declarada.** O perfil assinado do Albert não contém **um único número**. Todo limiar que
  uso é suposição minha e mora em arquivo versionado marcado `assumption: true`. A exceção é o R$ 1 milhão de
  investidor qualificado, que é definição da CVM.
- **Erro para o build.** Renomear um cabeçalho no extrato produzia 24 flags de erro, um retorno **fabricado**
  de +3,30% e `exit 0`. Hoje aborta.

**O que o pipeline descobriu que nenhum input contém:** o patrimônio rendeu 1,825% contra 2,62% da parcela
investida — os **0,80 p.p.** de diferença são o custo de R$ 74.672,62 parados mais um CDB vencido há 244
dias; os fundos custam **R$ 1.980,67/ano** em taxa de administração; 4 de 6 superaram o benchmark que
**eles próprios declararam à CVM**; e R$ 209.224,91 estão sob uma cláusula do perfil que **nenhuma fonte
disponível permite verificar** — a carta diz isso em vez de fingir que checou.

## 3. O que eu faria com um mês

**Tirar as duas premissas frágeis.** Numa implantação real o CNPJ do fundo vem junto da posição e todo o
casamento por nome desaparece. Com cotas atualizadas, o retorno passa a ser TWR encadeado com fluxos, não a
aproximação de mês único sem aportes que uso hoje.

**Camada de risco com dados já baixados.** O `INF_DIARIO` traz a série diária completa de cada fundo e eu uso
dois pontos. Com o resto: volatilidade, drawdown e **percentil do fundo dentro do peer group da CVM**. Zero
download adicional.

**Fechar o vão de crédito.** Hoje reporto que a cláusula de rating BB+ não é verificável. Com uma fonte de
rating ela vira verificação de verdade — é a diferença entre "não checado" e "conforme".

**Validação semântica.** O validador confere que todo número **existe** no payload; não confere que foi usado
para dizer a coisa certa. Uma carta que chamasse o CDI de retorno da carteira passaria. Resolver exige
carimbar cada número com seu papel e verificar o par número-rótulo.

**Avaliação contínua.** 300 cartas/mês precisam de um conjunto adversarial — extratos truncados, fundos
incorporados, meses sem IPCA publicado — rodando a cada mudança de prompt. Hoje testo o motor; não testo a prosa.

**Escala.** O console já é a fila ordenada por dinheiro esperando decisão. Falta o que um arquivo local não dá:
servidor, autenticação, trilha de auditoria real — e processamento em lote com cache por CNPJ, já que os mesmos
fundos aparecem em centenas de carteiras.

---

## Entregáveis

| | |
|---|---|
| Workflow revisado | [`letter_workflow_v2.rivet-project`](../letter_workflow_v2.rivet-project) — 33 nós, gerado por código |
| **Carta** (PT-BR, 2 páginas) | [`solution/out/letter.pdf`](../solution/out/letter.pdf) |
| Anexo do assessor (7 páginas) | [`solution/out/annex.pdf`](../solution/out/annex.pdf) — sem LLM |
| Console do assessor | [`solution/out/console.html`](../solution/out/console.html) · [`ABRIR-CONSOLE.cmd`](../ABRIR-CONSOLE.cmd) |
| Motor + testes | [`solution/`](../solution/) — `npm run build`, `npm test` (213) |
| Detalhamento | [`DOSSIE-TECNICO.docx`](../delivery/DOSSIE-TECNICO.docx) |

Prompts, código e grafo em inglês; toda saída ao cliente em português.
