/**
 * Each fund against the benchmark it declared to the regulator.
 *
 * WHY THIS IS NOT THE SAME AS "FUND VS CDI"
 * -----------------------------------------
 * The obvious comparison is to hold every position to one yardstick. It is also
 * wrong in both directions at once. In this portfolio:
 *
 *   Constellation Institucional  +11,13%   declared benchmark: Ibovespa
 *   Riza Lotus Plus               +1,21%   declared benchmark: DI de um dia
 *
 * Against the CDI's 1,06% the Constellation looks like a triumph and the Riza
 * looks like a rounding error. Against what each fund actually promised, the
 * Constellation beat the Ibovespa by 7,44 p.p. and the Riza delivered 115% of
 * the CDI it exists to track - which is the sentence an advisor can defend.
 *
 * WHERE THE BENCHMARK COMES FROM
 * ------------------------------
 * `Indicador_Desempenho` in the CVM's registro_classe.csv: the fund's own
 * declaration to the regulator, not a label this project assigned. That matters
 * because the alternative - inferring a benchmark from the fund's name or its
 * ANBIMA class - is exactly the kind of plausible guess this whole project
 * exists to avoid. A fund that declared nothing is reported as declaring
 * nothing.
 *
 * WHAT IS DELIBERATELY NOT DONE
 * -----------------------------
 * No alpha, no tracking error, no information ratio. All three need a series of
 * returns and this engine has one month. A single month's excess is reported as
 * a single month's excess, and the annex says so beside it.
 */

/**
 * How a declared benchmark maps onto a series this project actually measured.
 *
 * The mapping is explicit and small on purpose. An unrecognised declaration
 * produces "declarado, sem série correspondente" rather than a silent fallback
 * to the CDI, because falling back to the CDI is precisely the error the module
 * exists to prevent.
 */
const BENCHMARK_SERIES = [
  { match: /^di de um dia$|^cdi$|^di$/i, key: 'cdi', label_pt: 'CDI' },
  { match: /^ibovespa$|^ibov$/i, key: 'ibovespa', label_pt: 'Ibovespa' },
  { match: /^ipca$/i, key: 'ipca', label_pt: 'IPCA' },
];

function seriesFor(declared) {
  if (!declared) return null;
  return BENCHMARK_SERIES.find((b) => b.match.test(declared.trim())) ?? null;
}

/**
 * @param {object[]} funds     funds.json results
 * @param {object} market      market.json, for the benchmark returns
 * @returns {{rows: object[], summary: object}}
 */
export function fundsVsDeclaredBenchmark(funds, market) {
  const value = (key) => {
    const b = market?.benchmarks?.[key];
    if (typeof b === 'number') return b;
    return Number.isFinite(b?.value) ? b.value : null;
  };

  const rows = [];
  for (const f of funds) {
    if (f.status !== 'measured' || !Number.isFinite(f.value)) continue;

    const spec = seriesFor(f.declared_benchmark);
    const benchmarkReturn = spec ? value(spec.key) : null;

    const row = {
      label: f.statement_name,
      cnpj: f.cnpj ?? null,
      fund_return: f.value,
      declared_benchmark: f.declared_benchmark ?? null,
      anbima_class: f.anbima_class ?? null,
      benchmark_key: spec?.key ?? null,
      benchmark_label_pt: spec?.label_pt ?? null,
      benchmark_return: benchmarkReturn,
      excess_pp: null,
      pct_of_benchmark: null,
      status: 'compared',
    };

    if (!f.declared_benchmark) {
      row.status = 'no_declared_benchmark';
      row.reason =
        'O fundo não declarou indicador de desempenho no registro da CVM. ' +
        'Nenhum benchmark foi atribuído por inferência.';
    } else if (!spec) {
      row.status = 'series_unavailable';
      row.reason = `Indicador declarado "${f.declared_benchmark}" não tem série medida por este motor.`;
    } else if (benchmarkReturn === null) {
      row.status = 'series_unavailable';
      row.reason = `A série ${spec.label_pt} não foi apurada para o mês de referência.`;
    } else {
      row.excess_pp = Math.round((f.value - benchmarkReturn) * 100 * 10000) / 10000;
      // "% do benchmark" only means something when the benchmark rose. Against a
      // benchmark that fell, 200% of it is a loss twice as large, which reads
      // as praise. Reported only for a positive benchmark.
      row.pct_of_benchmark =
        benchmarkReturn > 0 ? Math.round((f.value / benchmarkReturn) * 100 * 100) / 100 : null;
    }

    rows.push(row);
  }

  rows.sort((a, b) => (b.excess_pp ?? -Infinity) - (a.excess_pp ?? -Infinity));

  const compared = rows.filter((r) => r.status === 'compared');
  return {
    rows,
    summary: {
      compared: compared.length,
      total: rows.length,
      beat: compared.filter((r) => r.excess_pp > 0).length,
      trailed: compared.filter((r) => r.excess_pp <= 0).length,
      basis:
        'Cada fundo comparado ao indicador que ele próprio declarou à CVM ' +
        '(Indicador_Desempenho, registro_classe.csv). Um mês isolado; não é alfa.',
    },
  };
}
