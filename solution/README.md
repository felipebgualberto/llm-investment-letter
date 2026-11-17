# XP Monthly Advisor — v2

Deterministic engine + LLM narration pipeline that produces the monthly investment
letter for a middle-market XP client.

```bash
npm run build     # parse → fetch → measure → compute → advise → plan → render
npm test          # 213 tests, offline
npm run palette   # WCAG contrast + colour-vision separation, build-blocking
```

No dependencies. Node ≥ 20. Everything below runs from the checked-in HTTP cache,
so a second run reproduces the first byte for byte.

---

## The one idea

> **Code computes every number. The language model only writes sentences.**

The v1 workflow asked one model to do both, and it:

| v1 published | The source document says |
|---|---|
| Selic "se estabilizar em 9%" | **15,50%** |
| IPCA 4,0% para 2025 | **6,1%** |
| Câmbio R$4,70 | **6,20** |
| "retorno total de 3,5%" | no return exists in any input |
| "Prezado João" | the client is **Albert** |

None of those figures appear in the files the model was given. Two of them match
the Focus market consensus of **mid-2024** almost exactly — the model recited its
training window instead of reading the document in front of it. `test/macro.test.js`
asserts that none of them is derivable from the source.

Everything in this repository follows from that: extraction, arithmetic and
selection are code; only language is a prompt.

---

## Data flow

```
Input/*.txt, *.csv ──► src/parse/    portfolio · macro · prices · risk-profile
                                        │  structured JSON + data_quality_flags
                                        ▼
        4 public APIs ──► src/data/   bcb · quotes · cvm · fundamentals · market
                                        │  benchmarks, consensus, fund quotas
                                        ▼
                          src/engine/ returns · suitability · recommend
                                      fund-benchmark · concentration
                                        │  metrics · findings · proposals
                                        ▼
                          src/engine/letter-plan     what fits in two pages
                                        │
                                        ▼
                             out/letter-plan.json ──► [Rivet: narration]
```

### `out/` — every file is an auditable contract

| File | What it is |
|---|---|
| `portfolio.json` | the statement, parsed and reconciled against six identities |
| `macro.json` | XP's projection table, extracted — never asked of a model |
| `market.json` | CDI, IPCA, Selic, FX, IBOV, Focus consensus, ticker validation |
| `funds.json` | each fund resolved to a CVM CNPJ, its measured monthly return, and its fee in force on the reference date |
| `metrics.json` | return, attribution, coverage, sensitivity, per-fund declared-benchmark comparison, cost, concentration |
| `suitability.json` | findings against the profile and house policy |
| `recommendations.json` | proposals, each carrying its evidence and disclosures |
| `letter-plan.json` | what goes in the letter, what goes to the advisor annex |
| `letter.pdf` / `.html` | the client letter, two pages, page count verified at build time |
| `annex.pdf` / `.html` | the advisor annex — every deferred finding, no LLM involved |
| `console.html` | the advisor console: opens by double-click, no server, no terminal |
| `charts/*.svg` | hand-written SVG, no chart library |
| `cache/` | every HTTP response, keyed by URL |

---

## The four data sources

| Source | Used for | Key |
|---|---|---|
| **BCB SGS** | CDI, IPCA, Selic, USD/BRL | none |
| **BCB Focus** | market consensus, ~140 institutions | none |
| **Yahoo Finance** | IBOV, held-ticker returns, dividend history | none |
| **CVM open data** | daily fund quotas, fund identity, investor eligibility, administration and performance fees, each fund's declared benchmark | none |

CVM is what turns **67,71% of the portfolio** from unmeasurable into measured.
The statement's most recent fund quota is dated 2024-04-04 — 398 days before the
statement itself — so from the challenge inputs alone, no monthly return exists
for two thirds of the account. The v1 filled that hole with an invented "17,4%".

The same archive answers two further questions the letter used to leave open.
`cad_fi_hist_taxa_adm.csv` gives what each fund charges — **R$ 1.980,67 a year**,
0,94% a.a., now printed in the letter's summary panel. `Indicador_Desempenho` in
`registro_classe.csv` gives the benchmark each fund declared to the regulator, so
an Ibovespa fund is measured against the Ibovespa instead of against the CDI.
Neither costs a request: both files were already being downloaded and only
partly read.

Fees are versioned, and that matters more than it sounds. Truxt publishes 1,90%
from 2022-12-29 and 2,00% from **2025-06-16**; the statement is dated 2025-05-07,
so the correct answer is 1,90%. Taking the newest row would print a fee that did
not exist in the month being reported — plausible, wrong, and invisible. The
discarded row becomes a data-quality flag rather than disappearing.

---

## Why the cache is a correctness feature

A letter is a document an advisor defends in a meeting weeks later. If a re-run
hits the live API, the same reference month can yield different numbers: IBGE
revises IPCA, BCB restates series, providers re-adjust closes after corporate
actions. **An unreproducible number is an indefensible number.** Refreshing is an
explicit act (`--refresh`), never a side effect. It also makes the test suite
offline and byte-stable.

---

## Reference date and data vintage

**This is the ambiguity a reviewer should ask about, so it is documented first.**

The supplied statement contradicts itself about its own date:

```
header line          2025-05-07   →  reference month April 2025
fund quota dates     2024-04-04   →  would imply March 2024
CDB maturity         2024-09-05   →  already past under either reading
```

`src/lib/reference.js` takes **the header**: it is the document's own statement
of when it was issued, and the only date that covers every sleeve. The rule is
*last calendar day of the month preceding the statement date*, derived in code —
nothing anywhere calls `Date.now()` for this, so output is identical today and in
a year.

**What changes under the other reading:** the CDB would not yet have matured, so
the priority-1 finding and R$40.478,75 of the narrative move. That is disclosed,
not hidden.

Fund positions are **not** rolled forward from the 2024-04-04 quota to the
reference date. The statement's own "Valor aplicado" implies quota counts 22–31%
different from `Posição / quota(04/04/2024)`, so the reconstruction is
contradicted by a second anchor in the same document, would print figures the
client's own app does not show, and is structurally impossible for the FIDC
holding. The date inconsistency is disclosed; it is not repaired.

---

## Two sources of truth, and which one wins

The statement and the price file XP supplied are the **system of record**.
Market data is a **reconciliation reference**. Where they disagree, the letter
discloses the gap and keeps the custodian's number.

That posture matters here because they disagree a lot:

```
LREN3   price file   +8,94%   market  +19,46%   gap -10,5 pp
MRFG3   price file  -16,38%   MBRF3   +18,94%   gap -35,3 pp, OPPOSITE SIGN
ARZZ3   price file   +0,05%   AZZA3   +29,96%   gap -29,9 pp
HAPV3   price file  +76,44%   market   +4,98%   gap +71,5 pp
```

The whole input set is synthetic — the statement's marks match no real B3 history
— so market data is not "the truth" here, it is a second opinion. Restating the
headline from it would replace one fabricated number with another. Reconcile,
disclose, keep.

---

## What the pipeline found that no input file contains

- **ARZZ3 → AZZA3** and **MRFG3 → MBRF3**: two of four held codes no longer trade.
- **Brave I → Brave 90**: renamed twice, then converted to a FIDC. Found only in
  CVM's *commercial* name history, and its data lives in a different dataset.
- **30,38% of the portfolio** sits in funds whose declared audience is
  *investidor qualificado* (CVM: R$1M) against R$386.858,82 visible. Raised as an
  eligibility **review** with three caveats — never as a breach.
- **XP is at the 89th percentile** of the Focus distribution on Selic. Not "above
  consensus" — near the top of 140 forecasts. That derives the post-fixed tilt.
- **35,77% of the equity sleeve** fails the very dividend screen the letter cites
  to justify a purchase.

---

## Layout

```
config/     suitability-policy.json   thresholds, each marked assumption true/false
src/lib/    numbers · dates · unzip · guard · reference
src/parse/  portfolio · macro · prices · risk-profile
src/data/   http · bcb · quotes · cvm-registry · cvm-quotas · cvm-fees · cvm · fundamentals · market
src/engine/ returns · suitability · recommend · fund-benchmark · concentration
            proposed-allocation · letter-plan
scripts/    one entry point per stage; `npm run build` chains them
test/       213 tests
```

**Every threshold is in `config/`, and each is marked `assumption: true|false`.**
The client's signed profile contains no numbers at all — only prose — so every
limit is a house parameter, except the R$1M qualified-investor line, which is
CVM's. Findings cite which they used.

**Errors stop the build.** `src/lib/guard.js` exits non-zero on any
`severity: "error"` flag. Rename one sleeve header in the statement and the
pipeline refuses to produce a letter instead of publishing a fabricated return.
`--allow-errors` overrides, and says so loudly.
