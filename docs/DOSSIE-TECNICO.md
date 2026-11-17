# Dossiê técnico — carta mensal de investimentos XP

**Felipe Bissoli Gualberto** · setembro de 2026

> **Este não é o relatório pedido no enunciado.** O relatório de duas páginas é
> [`RELATORIO.docx`](../delivery/RELATORIO.docx). Este documento é o material de apoio: cada decisão de projeto,
> cada defeito encontrado e como foi corrigido, com os números que sustentam as afirmações. Está
> aqui para ser consultado, não para ser lido inteiro.

---

## 1. Os problemas da primeira versão

A v1 pede a um único modelo que **extraia** os dados e **escreva** o texto. Extração é justamente
o que um LLM faz pior e, pior ainda, falha em silêncio: em vez de erro, ele produz um número
plausível. Todos os defeitos abaixo saem dessa causa única.

**Alucinação factual.** A carta afirma Selic em 9%, câmbio a R$ 4,70 e IPCA de 4,0% para 2025.
O relatório da própria XP, que estava no contexto do modelo, projeta **15,50%**, **6,20** e **6,1%**.
Nenhum dos três números existe no arquivo de origem.

Fui atrás da origem deles na API de Expectativas do Banco Central, e o resultado é conclusivo:

| A v1 publicou | Documento XP (fev/2025) | Mediana Focus na época |
|---|---|---|
| Selic 9% | 15,50% | **9,00% em maio/2024** |
| IPCA 4,0% | 6,1% | **4,00% em outubro/2024** |

O modelo não inventou ao acaso — **recitou o consenso de mercado da própria janela de treinamento**
enquanto um documento de fevereiro de 2025 estava na frente dele. Isso está no gráfico
`out/charts/consensus-selic.svg`, e é a razão pela qual o problema não se resolve com um prompt melhor.

**Números de performance sem fonte.** "Retorno total de 3,5%", "benchmark superior em 0,2 p.p." e
"fundos com 17,4%" não derivam de nenhum input. Além disso, a coluna "Rentabilidade" do extrato é
retorno **desde a compra** — LREN3: `16,94 ÷ 29,05 − 1 = −41,7%`, exatamente o que está lá. A v1 leu
quatro anos de acumulado e narrou como se fosse o mês.

**"Prezado João".** O cliente é Albert. O prompt final da v1 continha o exemplo
`"Prezado João, segue o relatório mensal..."`, e o modelo copiou o **conteúdo** do exemplo em vez do
**formato**. Vazamento clássico de few-shot.

**Escopo.** O CSV de preços — único arquivo com preço atual *e* do mês anterior, ou seja, a única
fonte de onde um retorno mensal poderia sair — nunca é lido. Não há recomendação de compra ou venda,
não há verificação de adequação ao perfil, e a saída morre como markdown dentro de um nó de chat.

---

## 2. O raciocínio da solução

> **Código determinístico calcula todo número. O modelo só escreve frases.**

Tudo decorre disso. O modelo recebe `letter-plan.json` com os valores prontos e rotulados; ele não
calcula, não escolhe o que cortar e não alcança nenhuma fonte de dados.

**Parsers com reconciliação.** O extrato vira JSON validado por seis identidades que ele mesmo tem
que satisfazer — `investido + caixa = patrimônio`, `Σ posições = investido`, `qtd × preço = posição`,
`posição ÷ aplicado − 1 = rentabilidade`. As duas metades do PDF não têm chave que as ligue; junto por
ordem e **provo o join pela aritmética**. Todas fecham.

**Quatro APIs públicas, nenhuma decorativa.** BCB SGS (CDI, IPCA, Selic, câmbio), BCB Focus (consenso
de 140 instituições), Yahoo (IBOV, cotações, dividendos) e **CVM** (cota diária de fundos). A CVM é o
que transforma 67,71% da carteira de "não mensurável" em medido: a cota mais recente do extrato é de
04/04/2024, 398 dias antes do próprio extrato.

E a CVM rende mais do que eu tinha extraído dela na primeira passada. O mesmo `cad_fi_hist.zip` que
eu já baixava para resolver nomes carrega também **as taxas de administração e de performance**, e o
`registro_classe.csv` carrega **o benchmark que cada fundo declarou perseguir**. Três informações
novas na carta, nenhuma requisição nova — só arquivos que já estavam em memória e que eu não estava
lendo até o fim.

**Identidade resolvida na data do extrato, não na de hoje.** ARZZ3 e MRFG3 não existem mais — viraram
AZZA3 e MBRF3. "Brave I" foi renomeado duas vezes e convertido em FIDC; só apareceu no histórico de
**nome comercial** da CVM, e seus dados vivem em outro dataset. Um extrato é uma foto de um momento.

**Toda decisão numérica é regra, não julgamento do modelo.** O que cabe em duas páginas é escolhido
por `config/suitability-policy.json` **antes** da narração. Se eu entregasse o payload inteiro com
"mantenha em duas páginas", o modelo decidiria quais achados o cliente nunca ouve — de forma diferente
a cada execução e sem teste possível. O que foi cortado é contado e declarado.

**Suposições declaradas.** O perfil assinado do Albert não contém **um único número** — só prosa.
Então todo limiar que uso é suposição minha, e mora num arquivo versionado marcado
`assumption: true`. A exceção é o R$ 1 milhão de investidor qualificado, que é definição da CVM e está
marcado `assumption: false`.

**Um validador, não uma promessa.** Um nó `Code` no Rivet extrai todo número da carta e confere
contra uma lista construída do payload. Ele é o mesmo módulo testado em `src/validate/letter-numbers.js`.
Contra a carta da v1 ele rejeita 17,4%, 19,32% e R$ 4,70 — **três de sete**. Não rejeita "9%", "4,0%",
"3,5%" e "2%" porque esses coincidem com números reais da carteira (LREN3 pesa 8,9977%, Truxt 4,0111%,
ARZZ3 3,4991%). É teto do método, não bug: validação por valor não separa uma taxa alucinada de um peso
verdadeiro que arredonda igual. Por isso o validador é **backstop**, e a defesa está a montante — o
compositor recebe seções pré-escritas e pré-rotuladas, nunca um saco de números soltos.

**Erros param o build.** Renomear um cabeçalho de classe no extrato produzia 24 flags de erro, um
retorno **fabricado** de +3,30% e `exit 0`. Agora `src/lib/guard.js` aborta.

### O que a carta diz porque o pipeline descobriu

- Cobertura medida: **86,94%** do investido. Retorno **+2,621%**, contra CDI de 1,056% e IPCA de 0,43%.
- **O patrimônio rendeu 1,825%.** O arrasto de **0,797 p.p.** é o custo de R$ 74.672,62 parados somados
  a um CDB vencido há 244 dias. A recomendação nº 1 se justifica sozinha.
- **30,38% da carteira** está em fundos declarados para investidor qualificado (R$ 1M pela CVM) contra
  R$ 386.858,82 visíveis. Sai como **revisão de enquadramento com três ressalvas**, nunca como violação.
- **35,77% do bolso de ações** não passa na mesma peneira de dividendos que a carta cita para justificar
  uma compra.
- A visão da casa vira viés operacional por derivação: XP no **percentil 89** de 140 projeções de Selic
  ⇒ juro alto por mais tempo ⇒ favorecer pós-fixado. Se a XP estivesse abaixo do consenso, o viés
  sumiria sozinho.
- **Os fundos custam R$ 1.980,67 por ano** — 0,94% a.a. de taxa de administração. Está no painel da
  carta, ao lado da rentabilidade.
- **4 de 6 fundos superaram o benchmark que eles próprios declararam à CVM.** Dois não declararam
  nenhum, e a carta não inventa um para eles.
- **13 posições, concentração equivalente a 6,4.** Três delas somam metade do patrimônio.
- **R$ 209.224,91 — 67% do investido — está sob uma cláusula do perfil que nenhuma fonte disponível
  permite verificar.** A carta diz isso em vez de fingir que checou.

### O custo, que a carta anterior não mencionava

Uma carta mensal reporta o que a carteira **rendeu** e nunca o que ela **cobrou**. A taxa é o único
número certo da relação inteira: o retorno é uma aposta que deu certo ou não, e a taxa de
administração sai da conta de qualquer jeito.

A CVM publica as duas tabelas de taxas dentro de `cad_fi_hist.zip` — **o mesmo arquivo que este
projeto já baixava** para resolver nomes históricos de fundos. Custo em requisições novas: zero.

E aqui apareceu a melhor demonstração da tese do projeto inteiro. **Taxas são versionadas.** O Truxt
Long Bias tem duas linhas:

| Taxa | Em vigor desde |
|---|---|
| 1,90% | 29/12/2022 |
| 2,00% | **16/06/2025** |

O extrato é de **07/05/2025**. A implementação óbvia — pegar a linha mais recente — imprime 2,00%:
uma taxa que **ainda não existia** no mês relatado, inflando em R$ 12,52 o custo declarado ao cliente.
E seria indetectável, porque 2,00% é perfeitamente plausível para esse fundo.

A regra aplicada é a mesma que resolve a identidade dos fundos: **a linha em vigor na data de
referência, nunca a mais nova.** A linha descartada não some — vira a flag
`fee_version_not_yet_in_force`, que aparece no anexo dizendo exatamente o que foi ignorado e por quê.

A taxa de **performance** é reportada como taxa declarada e **não** convertida em reais: depende de
linha d'água e do calendário de apuração do fundo, que nenhuma base pública carrega. Converter mesmo
assim produziria um número com aparência de medido.

### Cada fundo contra o benchmark que ele declarou

O campo `Indicador_Desempenho` do `registro_classe.csv` diz o que cada fundo prometeu ao regulador
perseguir. Comparar tudo ao CDI erra nas duas direções ao mesmo tempo:

| | Retorno | Contra o CDI | Contra o que declarou |
|---|---|---|---|
| Constellation Institucional | +11,13% | parece triunfo | Ibovespa, **+7,44 p.p.** |
| Riza Lotus Plus | +1,21% | parece irrelevante | CDI, **115% do índice** |

Dois dos seis fundos não declararam indicador nenhum. Eles saem como *"não declarou"* — **não** como
CDI por omissão. Inferir o benchmark pelo nome ou pela classe ANBIMA seria exatamente o tipo de
chute plausível que o projeto existe para evitar.

### Concentração: 13 posições que se comportam como 6,4

Contar posições não mede diversificação. Albert tem treze coisas, e duas delas são 43,6% do
patrimônio; "treze posições" e "seis posições" descrevem essa carteira igualmente mal, porque uma
contagem trata R$ 96.178 e R$ 305 como o mesmo objeto.

O índice de Herfindahl e seu recíproco — o **número efetivo de posições** — respondem o que a
contagem não responde. Uma carteira de N posições iguais tem número efetivo exatamente N; qualquer
desigualdade o derruba. Resultado: **6,41**, com três posições somando metade do patrimônio.

O denominador é o patrimônio, não o investido: medir só sobre o investido trataria os 19,3% parados
como se não existissem e reportaria uma carteira **mais** concentrada do que a real.

A frase fica embaixo do anel, junto com a ressalva que a torna honesta: o índice mede concentração
de **tamanho**, não de risco. Dois fundos que carregam as mesmas vinte ações aparecem ali como duas
posições distintas.

### O que seis execuções reais ensinaram

Rodei o workflow seis vezes contra a API. Cada carta expôs um defeito, e **nenhum deles foi
falha do modelo** — todos foram coisas que eu havia deixado sob responsabilidade dele:

| # | Sintoma na carta | O que eu deixei o modelo fazer | Correção |
|---|---|---|---|
| 1 | "Prezado cliente", "cobrindo **100%** do portfólio" | **lembrar** um fato que não entreguei | nome e cobertura entram no payload |
| 2 | carta **sem número nenhum** | **converter** `0.0105588` em "1,06%" — o que é aritmética, que eu proibi | motor formata, modelo posiciona |
| 3 | disclosures repetidas | *(Rivet rodando o grafo em memória)* | reabrir o projeto |
| 4 | `no valor de "R$ 35.986,74"`, `"2024-09-05"` | **interpretar** minha instrução ambígua ("*Quote* every valor") | reescrita: "reproduza os caracteres, não a sintaxe JSON" |
| 5 | "juros altos prejudicam a renda fixa" — dois parágrafos antes de propor **comprar** pós-fixado | **inferir** uma implicação causal | a conclusão já derivada (`house_stance.tilt`) entra no payload |
| 6 | "a conclusão para a carteira é clara" | vazar o nome da minha própria chave | chave renomeada para ler como prosa se vazar |

O defeito nº 2 é o mais instrutivo: o modelo **estava certo em não escrever o número**. Meus
prompts diziam "não faça aritmética de nenhum tipo", e transformar uma fração em percentual é
aritmética. Proibido de converter e sem querer inventar, ele fez a única coisa honesta que
restava — falou em volta do número. A contradição era do meu desenho, não dele.

O nº 5 mostra que eu tinha entendido a tese pela metade: sabia não delegar **cálculo**, mas ainda
delegava **inferência**. São a mesma coisa. Se o motor consegue derivar, o motor deve derivar.

Isso responde à pergunta que importa — *"como você sabe que não vai alucinar de novo?"*. A
resposta não é "o prompt está bom". É que **a cada erro, a superfície de decisão do modelo
encolheu**. Hoje ele recebe nome, período, números formatados, conclusões derivadas e uma
estrutura de cinco parágrafos. O que sobrou para ele é redação — e redação é a única coisa em
que ele é melhor que código.

### A cláusula que eu citava e nunca aplicava

O perfil assinado do Albert tem **uma única cláusula com limiar verificável**: renda fixa com
classificação **BB+ ou superior**. O motor de recomendação **cita essa cláusula** para justificar uma
compra nova — e até agora nada a aplicava ao que o cliente já tem. Invocar uma regra onde ela ajuda e
nunca cobrá-la é pior do que não ter a regra.

Fui atrás de quanto dinheiro ela governa. **R$ 209.224,91 — 67,02% do investido:**

| Posição | Valor | Por que entra |
|---|---|---|
| Riza Lotus Plus FIRF REF DI **CP** | R$ 96.178,73 | sufixo "CP" = crédito privado |
| Brave I FIC FIM **CP** | R$ 72.567,43 | sufixo "CP" = crédito privado |
| CDB Banco C6 Consignado | R$ 40.478,75 | título de emissor bancário |

Nenhuma base pública gratuita publica rating de emissor. Então o achado honesto **não é** "estas
posições estão desenquadradas" — é **"esta cláusula não pode ser verificada com as fontes disponíveis,
e são estes R$ 209 mil que ela governa"**. Sai como `review`, com três ressalvas explícitas, e o
encaminhamento é obter os ratings na mesa de crédito.

O silêncio era a pior opção: deixaria o leitor supor que a checagem rodou e passou.

> A identificação é **lida, não chutada**: o sufixo "CP" é a abreviação regulada de "crédito privado"
> em denominação de fundo, e a classificação ANBIMA da CVM também o nomeia. Não inferi nada do nome
> comercial.

### O que o modelo parou de escrever

Duas coisas saíram da prosa nesta rodada, pela mesma razão.

**1. Os avisos sobre o que não coube.** O plano já calculava as frases (`omissions[].disclosure_pt`) e
elas eram entregues ao compositor para "encaixar no texto". Funcionou tão bem quanto pedir a um
redator que lembre de uma nota de rodapé: a execução manteve uma, parafraseou para um vago *"vale
também revisar outras propostas"*, e **descartou inteiramente** a que dizia que existiam outros cinco
pontos de atenção. Ou seja: o cliente nunca soube deles.

Cortar por regra só é honesto se o leitor souber o que foi cortado. Uma ressalva que sobrevive apenas
se o modelo lembrar dela não é uma ressalva. Agora o **renderizador** imprime, direto do plano.

**2. As propostas.** O parágrafo 4 carregava todas as propostas, valores e justificativas como texto
corrido. Era o parágrafo mais denso da carta e **o que o modelo mais errava** — foi nele que uma
execução escreveu "juros altos prejudicam a renda fixa" dois parágrafos antes de propor comprar
pós-fixado.

As ações são a parte que o cliente precisa executar, e são feitas inteiramente de números que o plano
já formatou: um valor, uma data, uma taxa. Então o compositor agora escreve **uma frase de entrada** e
o bloco **Próximos passos** é impresso do plano — numerado, com etiqueta (`PROPOSTA` / `PENDÊNCIA`),
valor à direita e a nota de que nada é executado sem confirmação. Nada ali pode ser reordenado,
reformulado ou silenciosamente omitido.

> **Compatibilidade:** prosa gerada antes dessa mudança ainda traz os valores. O renderizador detecta
> isso — compara os valores formatados — **suprime o bloco** para não imprimir tudo duas vezes, e o
> build avisa que o grafo precisa ser reexecutado. A carta continua válida em qualquer um dos dois
> estados.

O bloco carrega, por item: número, etiqueta (`PROPOSTA` / `PENDÊNCIA`), título, classe do
instrumento, o valor em reais, **uma barra da fatia que o passo representa no patrimônio**, as duas
linhas de evidência, e a linha `Resolve:` nomeando o achado que aquele passo fecha.

A barra existe porque "R$ 35.986,74" não diz nada sozinho a quem não carrega o próprio saldo de
cabeça. "9,3% do seu patrimônio" é o mesmo fato na unidade em que o cliente raciocina, e põe as duas
propostas na mesma escala visual. A linha `Resolve:` é o que transforma sugestão em consequência: o
cliente vê que cada passo existe porque algo específico foi medido, não porque a carta precisava de
conteúdo.

### O modelo é travado por teste

O v1 rodava em **gpt-4o-mini** e o v2 roda no mesmo modelo de propósito: se a carta v2 é melhor, a
melhora veio da arquitetura e não de um modelo maior. Rodar em um modelo mais forte sem dizer
tornaria toda afirmação deste relatório infalsificável.

O risco é banal e real: o Rivet é uma interface gráfica. Basta abrir o projeto, encostar num nó de
chat, salvar — e o modelo que o aplicativo tem selecionado é gravado no arquivo. Ninguém percebe: o
grafo roda, a carta sai, e a comparação está silenciosamente anulada.

Então `test/graph.test.js` lê o `.rivet-project` e afirma que **todos os cinco nós de chat** rodam em
`gpt-4o-mini`, que nenhum ficou sem modelo (o que herdaria o padrão do aplicativo), que nenhum usa
`useModelInput`, e que a string `claude|anthropic|sonnet|gemini|llama` não aparece em lugar nenhum do
arquivo.

### A maior classe da carteira era a única sem nome

O gráfico de atribuição escolhia as duas maiores contribuições e as duas maiores detrações. Resultado:
**HAPV3, LREN3 e MRFG3 — três ações.** Ações são 22% da carteira apurada e oscilam mais, então ranquear
por magnitude escolhe ações toda vez. Os **fundos, 78% da carteira apurada e +1,89 dos +2,62 p.p. que
o cliente de fato ganhou**, iam inteiros para uma barra anônima chamada "demais posições".

A maior classe do cliente não pode ser a sem nome. As linhas agora são as **classes**, cada uma
seguida das posições que mais a moveram.

E a primeira tentativa de consertar ainda estava errada: eu mantive os maiores contribuidores globais
e só pus um cabeçalho de classe em cima. Deu **quatro linhas de ações contra uma de fundos** — o
ranking que escolhia continuava rodando sobre a carteira inteira. O que torna a comparação justa é
tirar **o mesmo número de cada classe**: dois nomes para os 78%, dois nomes para os 22%.

| | Antes | Agora |
|---|---|---|
| Fundos | escondidos em "demais posições" | **+1,89 p.p.**, 6 posições, 2,43% no mês — com Truxt e Riza nomeados |
| Ações | 3 das 4 linhas | **+0,73 p.p.**, 4 posições, 3,30% no mês — com MRFG3 e HAPV3 nomeados |

### Comprar e revisar: o mesmo critério nas duas direções

A carta agora nomeia ações. Não só "aplicar o saldo em pós-fixado", mas **quais papéis avaliar
comprar e quais revisar** — num bloco separado do "Próximos passos", porque são coisas de natureza
diferente. Os dois passos numerados são problemas: caixa parado acima do limite, título vencido há
244 dias. Têm dono e prazo. Uma ação que vale considerar é ideia para conversa, não tem prazo, e nada
quebra se o cliente disser não. Numerar juntos faria "avaliar PETR4" parecer tão atrasado quanto "o
título não liquidou".

O que sustenta o bloco é **uma única regra rodando nos dois sentidos**. A cláusula do perfil — *"ações
de empresas consolidadas que historicamente pagam dividendos anuais"* — é o que a carta cita para
justificar uma compra. Citá-la só onde ela ajuda a comprar, e nunca aplicá-la ao que o cliente já
tem, é exatamente a assimetria que o achado de rating denuncia.

| Para avaliar a compra | Dividendos 12m | Pagamentos | Volatilidade |
|---|---|---|---|
| PETR4 | 25,1% | 6 | 26,0% |
| BBAS3 | 9,1% | 7 | 19,2% |
| VALE3 | 9,0% | 3 | 25,7% |

| Para revisar | Por quê | Valor |
|---|---|---|
| MRFG3 | 1 pagamento em 12 meses, mínimo 2 | R$ 15.432,89 |
| HAPV3 | nenhum pagamento · DY 0,0% · −74,6% desde a compra | R$ 6.143,14 |

**35,8% do que o Albert tem em ações — R$ 21.576,03 — não passa no critério que justifica as compras
acima.** Essa frase fecha o bloco.

Três decisões que valem defender:

- **"Revisar", nunca "vender".** O motor mediu um histórico de dividendos. Ele não tem opinião sobre
  vender, e transformar uma peneira reprovada em ordem de venda seria inventar conselho que a
  evidência não sustenta. Há teste que falha se a palavra aparecer como instrução.
- **Nenhum preço ao lado de uma ideia de compra.** O arquivo de preços da XP e o fechamento de mercado
  discordam nesses mesmos papéis em até 56% — PETR4 em 23,8%. Imprimir um preço contestado seria
  escolher um lado dessa divergência sem dizer. O caso de cada candidato está no histórico de
  dividendos, não na cotação de hoje.
- **O motivo curto é construído da medição, não recortado da frase.** A carta tem uma linha por
  posição e o anexo imprime a razão inteira; a versão curta é montada a partir de `measured`, para
  não poder divergir do que foi medido.

### A carteira antes e depois das propostas

O cliente lê "alocar R$ 35.986,74 em renda fixa pós-fixada" e tem que segurar duas imagens na cabeça
e subtrair uma da outra. Então a carta desenha as duas: **dois anéis lado a lado**, hoje e como
ficaria se as propostas fossem seguidas, com uma seta entre eles.

O que o anel da direita **é**: o mesmo dinheiro, na mesma data, rearranjado. Nenhuma rentabilidade é
projetada sobre a posição nova e nenhum movimento de mercado é aplicado às antigas — os dois anéis
somam o **mesmo patrimônio**, e [`proposed-allocation.js`](../solution/src/engine/proposed-allocation.js)
**afirma isso em vez de supor**: se os dois lados não fecharem, ele se recusa a produzir um resultado
desenhável.

Três decisões que valem citar:

- **Só propostas de alocação movem dinheiro.** "Confirmar a liquidação de um título vencido" não muda
  a alocação: transforma em caixa uma posição que o custodiante ainda lista, e o que se faz com esse
  caixa é uma decisão que ninguém tomou. Desenhar como reinvestido seria inventar uma segunda
  recomendação e atribuí-la ao cliente.
- **A parcela proposta é uma fatia própria, tracejada.** Fundi-la na classe que ela integra mostraria
  "renda fixa 19,8%" e esconderia que metade disso é um passo ainda não dado. O tracejado existe
  porque cor sozinha faria um passo não tomado parecer idêntico a uma posição já detida.
- **O caixa cai para exatamente 10,00%** — o limite da política. Não é coincidência: é de onde o valor
  de R$ 35.986,74 saiu. Um teste trava esse encontro entre o gráfico e o motor que o dimensionou.

O anel detalhado de 13 posições foi para o anexo. Os dois não cabem, e o par antes/depois é o que as
propostas precisam.

### Quinze regras de CSS que o navegador estava jogando fora

A carta estourou para três páginas depois que o bloco de propostas entrou. Antes de cortar conteúdo,
fui medir onde estava o espaço — abri o HTML no navegador na largura exata de uma página A4 e li a
altura de cada elemento. O bloco de informações obrigatórias ocupava **263 px**, muito mais do que
seis frases curtas deveriam custar, e não encolhia por mais que eu reduzisse a fonte.

O motivo: eu tinha escrito quinze regras assim.

```css
font: 400 7pt/1.32 inherit;   /* INVÁLIDO — descartado inteiro */
```

O atalho `font` exige uma família tipográfica, e `inherit` não é uma família válida dentro dele. **O
navegador descarta a declaração inteira** — não só a família, mas o tamanho e a entrelinha junto. O
cabeçalho, o bloco de conformidade, o rodapé de assinatura e os dois `h2` estavam renderizando em
tamanho padrão de navegador, e os títulos em 20 px negrito.

Nada disso aparecia como erro. Não quebra o build, não quebra o PDF, e a página parecia apenas "um
pouco solta". Só apareceu porque eu medi em vez de olhar.

Corrigido para longhand (`font-weight` / `font-size` / `line-height`), a sobra de página saltou de
**49 px para 207 px** — o bloco de conformidade sozinho caiu de 263 px para 147 px. Foi essa folga
que pagou pelo bloco de propostas mais completo, sem cortar uma linha de conteúdo.

> A lição que levo: **layout também precisa de medição, não de inspeção visual.** Eu tinha olhado
> essa carta dezenas de vezes em screenshot e nunca vi. Uma consulta de 20 linhas ao DOM viu na hora.

### O painel, antes de qualquer frase

A carta abre com quatro números: rentabilidade do mês (com o resultado em reais), CDI, patrimônio e
**custo anual dos fundos**. Todos já estavam na carta — enterrados no segundo parágrafo. Fazer o
cliente garimpar prosa atrás de "+2,62%" é uma pequena grosseria repetida doze vezes por ano.

O painel é montado pelo **renderizador**, a partir de `plan.letter.headline`, já formatado e já
reconciliado. **O modelo nunca o vê e não pode alterá-lo** — é a tese do projeto em miniatura: os
números que mais importam são justamente os que ficam mais longe do modelo.

### Os gráficos

Três, intercalados com o texto — cada um logo depois do parágrafo que ele explica, não empilhados
no fim. A colocação é regra em `config/`, por índice de parágrafo, porque a estrutura de cinco
parágrafos é imposta ao compositor.

| Gráfico | Onde | O que mostra que o texto não mostra |
|---|---|---|
| Atribuição por classe | após a performance | que os fundos, 78% da carteira apurada, entregaram +1,89 dos +2,62 p.p. — o que a versão anterior escondia em "demais posições" |
| Ideias de compra/revisão | após as propostas | os papéis a avaliar e os que já estão na carteira e falham no mesmo critério |
| Antes e depois | após as propostas | os dois anéis lado a lado: o saldo parado de 19,3% caindo para exatamente 10%, ao lado do bloco que propõe a mudança |

Escrevi os SVGs à mão, sem biblioteca: toda figura já foi calculada e reconciliada a montante, e
uma lib seria um segundo lugar onde um número poderia ser reamostrado ou arredondado sem ninguém
notar.

**Um gráfico estava órfão.** Auditando quais figuras apareciam em qual documento, descobri que
`benchmarks.svg` — justamente o que mostra o arrasto do saldo parado como imagem — era gerado a cada
build e **não era exibido em lugar nenhum**. Foi para a seção 1 do anexo, ao lado do número que ele
ilustra. Há agora um teste que casa o título de cada SVG gerado com os três documentos e falha se
algum ficar sem casa: um gráfico que ninguém vê é peso morto no build e um argumento faltando no
documento que precisava dele.

### Quando um anel é a forma certa — e quando não é

A versão anterior deste relatório dizia, sobre a barra de cobertura: *"não usei pizza; comprimento
se compara melhor que ângulo"*. Isso continua verdadeiro **para aquela pergunta**. Comparar três
magnitudes é tarefa de barra.

Mas "como meu dinheiro está distribuído" é outra pergunta. Composição — um todo, repartido — é a
única forma que um anel lê melhor que um gráfico de barras, porque o todo é desenhado como um todo.
Treze barras respondem "qual é a maior" com precisão e deixam o cliente contando linhas para
perceber que **dois fundos são mais da metade de tudo**.

Então há os dois, cada um respondendo o que sabe responder:

- **O anel de posições vai na carta**, com dois anéis: o interno é a classe de ativo, o externo é
  cada posição dentro dela. O aninhamento amarra posição e classe por **geometria**, não por cor —
  é isso que permite a figura inteira rodar com três cinzas e um amarelo em vez de treze matizes
  que ninguém distinguiria. O anel não tenta ser legível na casa decimal e não precisa: os números
  exatos estão na legenda ao lado, na mesma ordem.
- **A barra de cobertura foi para o anexo**, ao lado da tabela de sensibilidade. Ela carrega uma
  mensagem diferente — quanto da carteira a rentabilidade reportada conseguiu *medir* — e esse é um
  argumento do anexo, não da carta.

O denominador do anel é o **patrimônio**, não o investido. Os pesos do próprio extrato são sobre o
total investido, o que descarta silenciosamente os 19,3% em conta — e um gráfico de composição que
omite um quinto do dinheiro não é um gráfico de composição. As fatias somam exatamente o valor
impresso no centro. Há teste para isso.

### A identidade da XP, e por que a paleta é medida e não escolhida

A carta e o anexo saem com a identidade da casa: tarja preta no cabeçalho, filete amarelo, marca no
topo, mesma tipografia sans do gráfico ao corpo do texto. Os tokens vivem em um arquivo só
([`brand.js`](../solution/src/render/brand.js)) que a carta, os gráficos e o anexo importam — não há
como os três divergirem.

**A logo é a da XP, tirada de um documento da própria XP.** Havia três caminhos para ter a marca:
desenhar uma parecida, baixar um arquivo da internet, ou usar a que já estava no material do case. O
terceiro é o único com procedência limpa — e `Input/XP - Albert_s risk profile.pdf` é um documento que
a XP produziu e entregou para este exercício, com a logo embutida no cabeçalho.

[`tools/extract-brand-mark.js`](../solution/tools/extract-brand-mark.js) abre o PDF, localiza o objeto de
imagem, valida que ele é o esperado (563×222; se mudar, ele **falha em vez de recortar errado**),
recorta nos limites da arte e remove o fundo preto por *keying*: `alpha = max(r,g,b)`, cor
despremultiplicada. Um limiar simples de "preto vira transparente" abriria buracos na parte escura do
degradê; assim o degradê sobrevive inteiro.

Resultado: `assets/xp-logo.png`, 480×100 com fundo transparente, embutido como data URI. Nada é
baixado, nada é redesenhado de memória, e a carta continua sendo **um arquivo só** — um `src` relativo
resolveria na hora da impressão e quebraria assim que o HTML mudasse de pasta. Sem o asset, um
marcador desenhado assume, e ele parece um marcador, não um quase-acerto da marca real.

**A paleta é validada por um script, não pelo meu olho.** `npm run palette` roda simulação de
daltonismo (matrizes de Machado et al., 2009) e CIEDE2000 sobre cada par de cores, e o teste do
build chama esse mesmo script — paleta que não passa quebra o build.

Ele já pegou dois erros meus:

1. **Verde/vermelho para ganho e perda.** O óbvio, e errado: **ΔE 4,6** em protanopia. Cerca de um
   homem em doze não distinguiria a melhor da pior posição da carteira, num gráfico cuja mensagem
   inteira é uma barra para cada lado.
2. **O amarelo da XP sobre branco.** Adotar a cor da casa foi a segunda chance de errar: amarelo é
   claro, e mede **1,56:1** contra o branco. Como texto ou linha fina, simplesmente não se lê.

A regra que saiu da medição: **preto carrega ganho, vermelho profundo carrega perda** (ΔE **25,0**
no pior caso, protanopia), e **o amarelo é reservado às marcas da casa** — preenchimento com
contorno escuro sobre branco, ou livre sobre a tarja preta, onde mede 13,43:1. Onde o amarelo
precisa ser fino, entra um âmbar mais escuro (5,07:1). Isso não é uma brecha: a WCAG 1.4.11 admite
preenchimento de baixo contraste quando **a borda** carrega o contraste — então o script passa a
testar a borda, e há um teste garantindo que nenhum `<text>` ou `<line>` do SVG saia em amarelo puro.

Mesmo assim o sinal é codificado duas vezes — direção da barra e rótulo com sinal — para que cor
nunca seja a única informação.

### O anexo do assessor

O enunciado limita a carta a duas páginas. O motor produz **9 pontos de atenção, 6 candidatos, 10
linhas de atribuição, 16 flags de qualidade** e a trilha de procedência inteira. Alguma coisa tem
que sair.

A tentação é mandar tudo ao modelo com "resuma em duas páginas" no prompt — o que entrega ao modelo
a decisão mais consequente do pipeline: **qual problema do cliente ele nunca vai ouvir.** Quem corta
é regra, em `config/suitability-policy.json`. E o que é cortado vai para
[`solution/out/annex.pdf`](../solution/out/annex.pdf), 7 páginas, não para o lixo. A carta diz ao
cliente "outros 4 pontos foram identificados e serão tratados por seu assessor"; o anexo é o
documento que torna essa frase verdadeira.

Ele tem oito seções: painel de apuração (os seis números que auditam a manchete), atribuição
completa, sensibilidade da cobertura, a lista integral de achados com **limite medido ao lado do
limite aplicado**, as sugestões preparadas e não enviadas, as divergências de preço, a postura de
casa, e a qualidade dos dados de origem.

Duas decisões que valem citar:

- **Nenhuma palavra dele vem de LLM.** Cliente merece prosa; assessor merece evidência, e evidência
  se serve melhor em tabela. Isso torna o anexo incapaz de alucinar por construção, e deixa visível
  o que o resto do sistema faz sem modelo nenhum.
- **O gráfico forense mora aqui, não na carta.** É o Focus plotado no tempo com a marca `carta v1`
  em Selic 9,00% — a prova de que a v1 recitava a janela de treino. Uma nota sobre erro nosso; o
  cliente não é o público dela.

Cada achado imprime se o limite é **parâmetro da casa** ou **regra externa**. É a diferença entre
"você está acima do limite" e "nós escolhemos um limite e você está acima dele" — e é o que permite
ao assessor discordar do parâmetro em vez de discordar do motor.

### O console do assessor

Todo o resto deste repositório pressupõe alguém digitando `npm run build`. Isso serve para quem
desenvolve e não serve para o Antonio Bicudo, que tem 300 clientes e nenhum motivo para aprender um
terminal. **Um pipeline que só pode ser acessado por linha de comando não está entregue.**

Então o build termina escrevendo [`solution/out/console.html`](../solution/out/console.html) — uma
página que abre com **duplo clique**, sem servidor, sem instalação, sem dependência. Nela:

- a **fila de clientes**, ordenada pelo patrimônio parado em itens que exigem ação — R$ 115.151,37
  neste caso, o saldo em conta mais o CDB vencido;
- a **fila de trabalho**, 15 itens decidíveis, cada um com sua evidência, e Aprovar / Adiar /
  Recusar;
- a carta e o anexo a um clique, em PDF e HTML;
- **exportar decisões** em JSON, com ids estáveis que remetem aos códigos do motor.

Uma lista de 300 clientes ordenada por nome é uma lista. Ordenada por dinheiro esperando decisão,
é uma fila de trabalho — e essa diferença é o que separa um assessor lendo 300 cartas de um
assessor agindo sobre as seis contas que precisam dele nesta semana.

Para regenerar tudo a partir de um extrato novo há um
[`ABRIR-CONSOLE.cmd`](../ABRIR-CONSOLE.cmd) na raiz: duplo clique, ele roda o build e abre o console.
Se o Node não estiver instalado, ele diz isso em português e explica que o `console.html` já
existente abre sozinho.

**O que construir isso me obrigou a consertar.** A fila mostrava dois itens de R$ 40.478,75 em
sequência — "título vencido ainda consta na posição" e "confirmar a liquidação" — o mesmo problema
contado duas vezes por quem passasse o olho na coluna. A causa não era de tela: **o motor nunca
registrava qual achado uma recomendação resolve**. Adicionei `addresses_finding`, e a correção
agora aninha sob o problema. Os dois seguem decidíveis em separado, porque concordar que um título
venceu não é o mesmo ato que aprovar o que fazer a respeito.

Também apareceu um **furo de segurança meu**: eu embutia `JSON.stringify(cliente)` dentro de um
`<script>`. Um nome contendo `</script>` fecha o bloco e o resto executa. Os nomes vêm de um
extrato *parseado* — exatamente o tipo de entrada em que um renderizador não pode confiar. O teste
que escrevi para isso falhou de primeira; hoje o JSON embutido escapa `<`, `>`, `&` e os
separadores U+2028/29.

**Honestidade sobre o que é demonstração:** as decisões ficam no `localStorage` do navegador — por
máquina, e não é trilha de auditoria. Verifiquei que funciona em `file://`, e a página degrada com
aviso visível onde não funcionar. O artefato honesto é o JSON exportado. Numa implantação real esta
página seria servida, com autenticação e persistência do lado do servidor. Isso está escrito no
rodapé da própria página, não só aqui.

### Duas coisas que decidi **não** fazer

**Não rolo as posições dos fundos de 04/04/2024 para a data de referência.** O "Valor aplicado" do
próprio extrato implica quantidades de cotas 22–31% diferentes. A reconstrução é contraditada por
outro dado do mesmo documento e imprimiria valores que o app do cliente não mostra. Declaro a
inconsistência; não a conserto.

**Não troco a manchete pelo retorno de mercado.** O arquivo de preços da XP diverge do mercado em até
71 p.p. e MRFG3 inverte de sinal. Mas ambas as fontes são sintéticas, e o extrato é o livro-razão do
custodiante. Reconcilio, revelo a divergência e mantenho o número.

---

## 3. O que eu faria com um mês

**Primeiro, tirar as duas premissas frágeis.** Numa implantação real o CNPJ do fundo vem junto da
posição, e todo o problema de casamento por nome desaparece. Com cotas atualizadas, o retorno passa a
ser TWR encadeado com fluxos, não a aproximação de mês único sem aportes que uso hoje.

**Camada de risco, com os dados que já estão baixados.** O `INF_DIARIO` traz a série diária completa de
cada fundo do Albert e eu uso só dois pontos. Com o resto: volatilidade, drawdown, e **percentil do
fundo dentro do peer group da CVM** — "entre 254 fundos da mesma classe, o seu ficou no percentil 75".
Zero download adicional.

**Fechar o vão de crédito.** O perfil do Albert traz **uma única regra dura e verificável** —
renda fixa com rating BB+ ou superior — e hoje eu cito essa cláusula para justificar uma compra sem
nunca aplicá-la aos R$ 168.746 já investidos em veículos com risco de crédito privado. Precisa de
fonte de rating; sem ela, o achado correto é "não verificável", não "em desacordo".

**Instrumento em vez de categoria.** Transformar "alocar em pós-fixado" num título datado, e
precificar o CDB morto (IPCA+5,45%) contra o Tesouro IPCA+ da data. **Tentei fazer isso agora e
parei:** o endpoint público do Tesouro Direto responde `410 Gone` — foi descontinuado. Existem
alternativas, mas escolher uma na véspera da entrega significa acoplar o pipeline a um endereço que
eu não consegui verificar direito. A recomendação continua nomeando a classe e quantificando o CDI;
o instrumento fica para quando a fonte puder ser escolhida com calma.

**Validação semântica.** O validador de hoje confere que todo número **existe** no payload; não confere
que foi usado para dizer a coisa certa. Uma carta que chamasse o CDI de retorno da carteira passaria.
Resolver isso exige carimbar cada número com seu papel e verificar o par número-rótulo.

**Avaliação contínua.** 300 cartas por mês precisam de um conjunto de casos adversariais — extratos
truncados, fundos incorporados, meses sem IPCA publicado — rodando a cada mudança de prompt. Hoje eu
testo o motor; não testo a prosa.

**E o óbvio de produto:** o console já é a fila ordenada por dinheiro esperando decisão, com
aprovação em um clique. O que falta para virar produto é o que um arquivo local não pode dar —
servidor, autenticação, persistência compartilhada e trilha de auditoria real — mais o processamento
em lote: hoje o build roda uma conta, e 300 contas pedem paralelismo, cache por CNPJ (os mesmos
fundos aparecem em centenas de carteiras) e uma fila que reprocessa só quem mudou.

---

## Entregáveis

| | |
|---|---|
| Workflow revisado | [`letter_workflow_v2.rivet-project`](../letter_workflow_v2.rivet-project) — 33 nós, gerado por código |
| Carta (PT-BR, 2 páginas) | [`solution/out/letter.pdf`](../solution/out/letter.pdf) · [`.html`](../solution/out/letter.html) |
| Anexo do assessor (7 páginas) | [`solution/out/annex.pdf`](../solution/out/annex.pdf) · [`.html`](../solution/out/annex.html) — sem LLM |
| Console do assessor | [`solution/out/console.html`](../solution/out/console.html) — abre com duplo clique |
| Sem terminal | [`ABRIR-CONSOLE.cmd`](../ABRIR-CONSOLE.cmd) — regenera tudo e abre o console |
| Motor + testes | [`solution/`](../solution/) — `npm run build`, `npm test` (213) |
| Checagem de paleta | `npm run palette` — contraste WCAG e separação sob 3 tipos de daltonismo |
| Logo da XP | `npm run brand-mark` — extrai a marca do PDF que a XP entregou no case |
| Como e por quê | [`solution/README.md`](../solution/README.md) |

O limite de duas páginas da carta é **verificado**, não estimado: o build conta os objetos de página
no PDF gerado e falha se passar de duas.
