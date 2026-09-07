// Čista statistika za Pattern Finder — bez zavisnosti od mreže, lako se testira.

export interface PriceRow {
  date: Date;
  open: number;
  close: number;
  adjclose: number;
  volume: number | null;
}

export interface DailyReturn {
  date: Date;
  ret: number;
  idx: number;
}

export const MONTH_NAMES = [
  "Januar", "Februar", "Mart", "April", "Maj", "Jun",
  "Jul", "Avgust", "Septembar", "Oktobar", "Novembar", "Decembar",
];

export const DAY_NAMES = ["Ponedeljak", "Utorak", "Sreda", "Četvrtak", "Petak"];

// Zvanični kalendar Federalnih rezervi (objavljen unapred) — dan objave odluke o kamatnoj stopi.
export const FOMC_DATES = [
  "2019-01-30", "2019-03-20", "2019-05-01", "2019-06-19", "2019-07-31", "2019-09-18", "2019-10-30", "2019-12-11",
  "2020-01-29", "2020-03-03", "2020-03-15", "2020-04-29", "2020-06-10", "2020-07-29", "2020-09-16", "2020-11-05", "2020-12-16",
  "2021-01-27", "2021-03-17", "2021-04-28", "2021-06-16", "2021-07-28", "2021-09-22", "2021-11-03", "2021-12-15",
  "2022-01-26", "2022-03-16", "2022-05-04", "2022-06-15", "2022-07-27", "2022-09-21", "2022-11-02", "2022-12-14",
  "2023-02-01", "2023-03-22", "2023-05-03", "2023-06-14", "2023-07-26", "2023-09-20", "2023-11-01", "2023-12-13",
  "2024-01-31", "2024-03-20", "2024-05-01", "2024-06-12", "2024-07-31", "2024-09-18", "2024-11-07", "2024-12-18",
  "2025-01-29", "2025-03-19", "2025-05-07", "2025-06-18", "2025-07-30", "2025-09-17", "2025-10-29", "2025-12-10",
  "2026-01-28", "2026-03-18", "2026-04-29", "2026-06-17", "2026-07-29", "2026-09-16", "2026-10-28", "2026-12-09",
];

export const SECTOR_ETF: Record<string, string> = {
  Technology: "XLK",
  "Financial Services": "XLF",
  Financial: "XLF",
  Healthcare: "XLV",
  "Consumer Cyclical": "XLY",
  "Consumer Defensive": "XLP",
  Energy: "XLE",
  Industrials: "XLI",
  "Basic Materials": "XLB",
  Utilities: "XLU",
  "Real Estate": "XLRE",
  "Communication Services": "XLC",
};

export function parseChartRows(chartResult: {
  timestamp: number[];
  indicators: {
    quote: Array<{ open: (number | null)[]; close: (number | null)[]; volume: (number | null)[] }>;
    adjclose?: Array<{ adjclose: (number | null)[] }>;
  };
}): PriceRow[] {
  const ts = chartResult.timestamp;
  const q = chartResult.indicators.quote[0];
  const adj = chartResult.indicators.adjclose ? chartResult.indicators.adjclose[0].adjclose : q.close;
  const rows: PriceRow[] = [];
  for (let i = 0; i < ts.length; i++) {
    if (q.close[i] == null || q.open[i] == null) continue;
    rows.push({
      date: new Date(ts[i] * 1000),
      open: q.open[i] as number,
      close: q.close[i] as number,
      adjclose: (adj[i] != null ? adj[i] : q.close[i]) as number,
      volume: q.volume[i],
    });
  }
  return rows;
}

export function dailyReturns(rows: PriceRow[]): DailyReturn[] {
  const out: DailyReturn[] = [];
  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1].adjclose;
    const cur = rows[i].adjclose;
    const ret = prev ? cur / prev - 1 : null;
    if (ret !== null && Number.isFinite(ret)) out.push({ date: rows[i].date, ret, idx: i });
  }
  return out;
}

export interface MonthStat { month: number; avg: number | null; winRate: number | null; n: number }

export function seasonality(rows: PriceRow[]): MonthStat[] {
  const byYearMonth = new Map<string, { month: number; startClose: number; endClose: number }>();
  for (let i = 1; i < rows.length; i++) {
    const d = rows[i].date;
    const key = `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
    const existing = byYearMonth.get(key);
    if (!existing) {
      byYearMonth.set(key, { month: d.getUTCMonth(), startClose: rows[i - 1].adjclose, endClose: rows[i].adjclose });
    } else {
      existing.endClose = rows[i].adjclose;
    }
  }
  const perMonth: number[][] = Array.from({ length: 12 }, () => []);
  byYearMonth.forEach((v) => {
    const ret = v.startClose ? v.endClose / v.startClose - 1 : null;
    if (ret !== null && Number.isFinite(ret)) perMonth[v.month].push(ret);
  });
  return perMonth.map((arr, m) => {
    if (!arr.length) return { month: m, avg: null, winRate: null, n: 0 };
    const avg = arr.reduce((a, b) => a + b, 0) / arr.length;
    const winRate = arr.filter((r) => r > 0).length / arr.length;
    return { month: m, avg, winRate, n: arr.length };
  });
}

export interface DayStat { day: number; avg: number | null; winRate: number | null; n: number }

export function dayOfWeek(rets: DailyReturn[]): DayStat[] {
  const perDay: number[][] = Array.from({ length: 5 }, () => []);
  rets.forEach((r) => {
    const dow = r.date.getUTCDay();
    if (dow >= 1 && dow <= 5) perDay[dow - 1].push(r.ret);
  });
  return perDay.map((arr, i) => {
    if (!arr.length) return { day: i, avg: null, winRate: null, n: 0 };
    const avg = arr.reduce((a, b) => a + b, 0) / arr.length;
    const winRate = arr.filter((r) => r > 0).length / arr.length;
    return { day: i, avg, winRate, n: arr.length };
  });
}

export interface FomcStat { n: number; avg: number | null; winRate: number | null; baseline: number }

export function fomcCorrelation(rets: DailyReturn[]): FomcStat {
  const baseline = rets.reduce((a, b) => a + b.ret, 0) / rets.length;
  const byDate = new Map(rets.map((r) => [r.date.toISOString().slice(0, 10), r.ret]));
  const matched: number[] = [];
  FOMC_DATES.forEach((d) => {
    const v = byDate.get(d);
    if (v !== undefined) matched.push(v);
  });
  if (!matched.length) return { n: 0, avg: null, winRate: null, baseline };
  const avg = matched.reduce((a, b) => a + b, 0) / matched.length;
  const winRate = matched.filter((r) => r > 0).length / matched.length;
  return { n: matched.length, avg, winRate, baseline };
}

export interface GapStat {
  n: number;
  avgAbsGap?: number;
  avgPre5d?: number | null;
  avgPostGap?: number | null;
  avgPost5d?: number | null;
}

export function volatilityGapEvents(rows: PriceRow[]): GapStat {
  const gaps: Array<{ i: number; gap: number }> = [];
  for (let i = 1; i < rows.length; i++) {
    const prevClose = rows[i - 1].close;
    if (!prevClose) continue;
    gaps.push({ i, gap: rows[i].open / prevClose - 1 });
  }
  if (gaps.length < 30) return { n: 0 };
  const mean = gaps.reduce((a, b) => a + Math.abs(b.gap), 0) / gaps.length;
  const variance = gaps.reduce((a, b) => a + Math.pow(Math.abs(b.gap) - mean, 2), 0) / gaps.length;
  const std = Math.sqrt(variance);
  const threshold = mean + 2 * std;
  const events = gaps.filter((g) => Math.abs(g.gap) > threshold && Math.abs(g.gap) > 0.02);

  const pre: number[] = [], post1: number[] = [], post5: number[] = [];
  events.forEach((e) => {
    const i = e.i;
    if (i >= 5) pre.push(rows[i - 1].close / rows[i - 5].close - 1);
    post1.push(e.gap);
    if (i + 4 < rows.length) post5.push(rows[i + 4].close / rows[i].close - 1);
  });
  const avg = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
  return {
    n: events.length,
    avgAbsGap: mean,
    avgPre5d: avg(pre),
    avgPostGap: avg(post1),
    avgPost5d: avg(post5),
  };
}

export function totalReturn(rows: PriceRow[]): number | null {
  if (rows.length < 2) return null;
  const first = rows[0].adjclose;
  const last = rows[rows.length - 1].adjclose;
  return first ? last / first - 1 : null;
}
