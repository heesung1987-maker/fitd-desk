// Monetary views of the collector's causal gross PnL and executed turnover.
// DV01 is a fixed display multiplier, not account capital or a return denominator.

export function calculatePerformance(
  performance,
  costBp = 0.2,
  baseDV01 = 1000,
  year = 'ALL',
  customRange = null
) {
  if (!Number.isFinite(costBp) || costBp < 0 || costBp > 5 || !Number.isFinite(baseDV01) || baseDV01 <= 0) {
    throw Error('성과 비용·DV01 환산 기준을 확인하세요.');
  }
  const codes = performance?.codes || [];
  const raw = performance?.available ? performance.daily || [] : [];

  const all = raw.map((row) => {
    let gross = 0,
      cost = 0,
      turnover = 0;
    const assets = {};
    codes.forEach((code, i) => {
      const g = row[1 + 2 * i] * baseDV01;
      const t = row[2 + 2 * i] * baseDV01;
      const c = t * costBp;
      assets[code] = { gross: g, turnover: t, cost: c, net: g - c };
      gross += g;
      cost += c;
      turnover += t;
    });
    return { date: row[0], gross, cost, turnover, net: gross - cost, assets };
  });

  const years = [...new Set(all.map((r) => r.date.slice(0, 4)))].sort();
  const annual = years.map((y) => {
    const rows = all.filter((r) => r.date.startsWith(y));
    const gross = rows.reduce((a, r) => a + r.gross, 0);
    const cost = rows.reduce((a, r) => a + r.cost, 0);
    return {
      year: y,
      gross,
      cost,
      net: gross - cost,
      assets: Object.fromEntries(
        codes.map((code) => [code, rows.reduce((a, r) => a + r.assets[code].net, 0)])
      ),
    };
  });

  let rows = all.filter((r) => year === 'ALL' || r.date.startsWith(String(year)));
  if (customRange && Array.isArray(customRange) && customRange.length) {
    const allowedDates = new Set(customRange.map((d) => (typeof d === 'string' ? d : d.date)));
    const filtered = rows.filter((r) => allowedDates.has(r.date));
    if (filtered.length) rows = filtered;
  }

  let cumulative = 0,
    cumulativeGross = 0,
    peak = 0,
    mdd = 0,
    paid = 0;

  const daily = rows.map((r) => {
    cumulative += r.net;
    cumulativeGross += r.gross;
    paid += r.cost;
    peak = Math.max(peak, cumulative);
    const drawdown = cumulative - peak;
    mdd = Math.min(mdd, drawdown);
    return {
      ...r,
      cumulative,
      cumulative_gross: cumulativeGross,
      cumulative_cost: paid,
      drawdown,
    };
  });

  const first = rows.length ? all.findIndex((r) => r.date === rows[0].date) : -1;
  const baselineDate = first > 0 ? all[first - 1].date : performance?.baseline_date;

  return {
    codes,
    years,
    year,
    baseDV01,
    costBp,
    annual,
    daily,
    baselineDate,
    summary: {
      net: daily.length ? cumulative : null,
      gross: daily.length ? cumulativeGross : null,
      cost: daily.length ? paid : null,
      mdd: daily.length ? mdd : null,
      last: daily.at(-1)?.net ?? null,
      observations: daily.length,
      start: daily[0]?.date ?? null,
      end: daily.at(-1)?.date ?? null,
    },
  };
}
