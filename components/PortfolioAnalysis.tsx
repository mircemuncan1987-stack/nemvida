"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  computeModel,
  computeReturnSince,
  computeTotalReturn,
  extractModelData,
  resolveFcfForYield,
  type ComputedModel,
  type HistoricalPricePoint,
} from "@/lib/buildModel";
import { fetchPriceHistory, fetchSpyHistory } from "@/lib/clientData";
import { computeFcfYield } from "@/lib/valuation";
import {
  analyzeConcentration,
  DEFAULT_HOLDINGS,
  stressTestPortfolio,
  totalValueNok,
  computeTechnicalSnapshot,
  type PortfolioHolding,
} from "@/lib/portfolio";

const STORAGE_KEY = "nemvida_portfolio_v1";
const CONCURRENCY = 4;
const BENCHMARK_YEARS = [1, 3, 5];

const fmtNok = (x: number) => `${x.toLocaleString("nb-NO", { maximumFractionDigits: 0 })} NOK`;
const fmtPct = (x: number | null, digits = 1) =>
  x === null || Number.isNaN(x) ? "—" : `${x >= 0 ? "+" : ""}${(x * 100).toFixed(digits)}%`;

interface HoldingResult {
  computed: ComputedModel | null;
  priceHistory: HistoricalPricePoint[];
  error?: string;
}

function loadHoldings(): PortfolioHolding[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_HOLDINGS;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    return DEFAULT_HOLDINGS;
  } catch {
    return DEFAULT_HOLDINGS;
  }
}

export default function PortfolioAnalysis() {
  const [holdings, setHoldings] = useState<PortfolioHolding[]>(DEFAULT_HOLDINGS);
  const [loaded, setLoaded] = useState(false);
  const [results, setResults] = useState<Map<string, HoldingResult>>(new Map());
  const [spyHistory, setSpyHistory] = useState<HistoricalPricePoint[]>([]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [startDate, setStartDate] = useState("2024-01-01");
  const [reportedReturn, setReportedReturn] = useState("49.32");
  const [nowSeconds] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- jednokratno učitavanje iz localStorage pri montiranju
    setHoldings(loadHoldings());
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(holdings));
    } catch {
      /* nije kritično ako localStorage nije dostupan */
    }
  }, [holdings, loaded]);

  function updateHolding(id: string, patch: Partial<PortfolioHolding>) {
    setHoldings((prev) => prev.map((h) => (h.id === id ? { ...h, ...patch } : h)));
  }

  function removeHolding(id: string) {
    setHoldings((prev) => prev.filter((h) => h.id !== id));
  }

  function addHolding() {
    setHoldings((prev) => [
      ...prev,
      { id: `custom-${Date.now()}`, ticker: "", name: "Nova pozicija", category: "akcija", shares: 0, currency: "USD", marketValueNok: 0 },
    ]);
  }

  function resetToReport() {
    setHoldings(DEFAULT_HOLDINGS);
  }

  async function runAnalysis() {
    setRunning(true);
    setProgress(0);
    const tickers = Array.from(new Set(holdings.map((h) => h.ticker).filter((t): t is string => !!t)));
    const newResults = new Map<string, HoldingResult>();

    const spy = await fetchSpyHistory();
    setSpyHistory(spy);

    for (let i = 0; i < tickers.length; i += CONCURRENCY) {
      const batch = tickers.slice(i, i + CONCURRENCY);
      const settled = await Promise.allSettled(
        batch.map(async (ticker) => {
          const res = await fetch(`/api/stock?symbol=${encodeURIComponent(ticker)}&type=valuation&full=1`, { cache: "no-store" });
          const data = await res.json();
          if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
          const modelData = extractModelData(data, ticker);
          const computed = computeModel(modelData);
          const priceHistory = await fetchPriceHistory(ticker);
          return { ticker, computed, priceHistory };
        })
      );
      settled.forEach((s, idx) => {
        const ticker = batch[idx];
        if (s.status === "fulfilled") {
          newResults.set(ticker, { computed: s.value.computed, priceHistory: s.value.priceHistory });
        } else {
          newResults.set(ticker, { computed: null, priceHistory: [], error: s.reason instanceof Error ? s.reason.message : "Greška" });
        }
      });
      setResults(new Map(newResults));
      setProgress(Math.min(100, Math.round(((i + batch.length) / Math.max(1, tickers.length)) * 100)));
    }

    setRunning(false);
  }

  const total = totalValueNok(holdings);

  const sectorByTicker = useMemo(() => {
    const m = new Map<string, string | null>();
    results.forEach((r, ticker) => m.set(ticker, r.computed?.data.sector ?? null));
    return m;
  }, [results]);

  const betaByTicker = useMemo(() => {
    const m = new Map<string, number | null>();
    results.forEach((r, ticker) => m.set(ticker, r.computed?.data.beta ?? null));
    return m;
  }, [results]);

  const concentration = useMemo(() => analyzeConcentration(holdings, sectorByTicker), [holdings, sectorByTicker]);
  const stressTest = useMemo(() => stressTestPortfolio(holdings, betaByTicker), [holdings, betaByTicker]);

  const hasResults = results.size > 0;

  const portfolioVsSpySinceStart = useMemo(() => {
    if (!hasResults || spyHistory.length === 0) return null;
    const startTs = Math.floor(new Date(startDate + "T00:00:00Z").getTime() / 1000);
    let weightedReturn = 0;
    let coveredWeight = 0;
    for (const h of holdings) {
      if (!h.ticker) continue;
      const r = results.get(h.ticker);
      if (!r?.priceHistory.length) continue;
      const ret = computeReturnSince(r.priceHistory, startTs, nowSeconds);
      if (ret == null) continue;
      const weight = h.marketValueNok / total;
      weightedReturn += weight * ret;
      coveredWeight += weight;
    }
    if (coveredWeight === 0) return null;
    const portfolioReturn = weightedReturn / coveredWeight;
    const spyReturn = computeReturnSince(spyHistory, startTs, nowSeconds);
    return { portfolioReturn, spyReturn, coveredWeight };
  }, [hasResults, spyHistory, holdings, results, total, startDate, nowSeconds]);

  const benchmarkByHorizon = useMemo(() => {
    if (!hasResults || spyHistory.length === 0) return [];
    return BENCHMARK_YEARS.map((years) => {
      let weightedReturn = 0;
      let coveredWeight = 0;
      for (const h of holdings) {
        if (!h.ticker) continue;
        const r = results.get(h.ticker);
        if (!r?.priceHistory.length) continue;
        const ret = computeTotalReturn(r.priceHistory, years, nowSeconds);
        if (ret == null) continue;
        const weight = h.marketValueNok / total;
        weightedReturn += weight * ret;
        coveredWeight += weight;
      }
      const spyReturn = computeTotalReturn(spyHistory, years, nowSeconds);
      return {
        years,
        portfolioReturn: coveredWeight > 0 ? weightedReturn / coveredWeight : null,
        spyReturn,
        coveredWeight,
      };
    });
  }, [hasResults, spyHistory, holdings, results, total, nowSeconds]);

  return (
    <div className="max-w-5xl mx-auto px-4 pb-16">
      <div className="mt-4 mb-5 text-sm leading-relaxed rounded-xl border border-amber-300/60 dark:border-amber-700/50 bg-amber-50 dark:bg-amber-900/15 text-amber-800 dark:text-amber-300 p-4">
        <b>⚠ Ovo NIJE finansijski savet.</b> Vrednosti pozicija su iz tvog poslednjeg izveštaja brokera (možeš ih ručno
        ažurirati) — cena, sud, fundamenti i tehnički pregled po akciji se preuzimaju uživo iz istog sveobuhvatnog
        modela kao na <a href="/model" className="underline">/model</a> i <a href="/lista" className="underline">/lista</a>.
        Fondovi (bez pojedinačnog tikera) i gotovina se ne analiziraju pojedinačno, samo se broje u ukupnu vrednost i
        udele.
      </div>

      <Section title="Pozicije u portfelju">
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr>
                <th className="text-left text-xs uppercase text-zinc-500 py-1.5 px-2 border-b border-zinc-200 dark:border-zinc-800">Naziv</th>
                <th className="text-left text-xs uppercase text-zinc-500 py-1.5 px-2 border-b border-zinc-200 dark:border-zinc-800">Ticker</th>
                <th className="text-left text-xs uppercase text-zinc-500 py-1.5 px-2 border-b border-zinc-200 dark:border-zinc-800">Vrsta</th>
                <th className="text-left text-xs uppercase text-zinc-500 py-1.5 px-2 border-b border-zinc-200 dark:border-zinc-800">Valuta</th>
                <th className="text-right text-xs uppercase text-zinc-500 py-1.5 px-2 border-b border-zinc-200 dark:border-zinc-800">Broj</th>
                <th className="text-right text-xs uppercase text-zinc-500 py-1.5 px-2 border-b border-zinc-200 dark:border-zinc-800">Vrednost (NOK)</th>
                <th className="text-right text-xs uppercase text-zinc-500 py-1.5 px-2 border-b border-zinc-200 dark:border-zinc-800">Udeo</th>
                <th className="py-1.5 px-2 border-b border-zinc-200 dark:border-zinc-800"></th>
              </tr>
            </thead>
            <tbody>
              {holdings.map((h) => (
                <tr key={h.id}>
                  <td className="py-1 px-2 border-b border-zinc-200 dark:border-zinc-800">
                    <input value={h.name} onChange={(e) => updateHolding(h.id, { name: e.target.value })} className="w-full min-w-[120px] bg-transparent border-b border-transparent focus:border-zinc-400 text-sm" />
                  </td>
                  <td className="py-1 px-2 border-b border-zinc-200 dark:border-zinc-800">
                    <input value={h.ticker ?? ""} onChange={(e) => updateHolding(h.id, { ticker: e.target.value.toUpperCase() || null })} placeholder="—" className="w-20 bg-transparent border-b border-transparent focus:border-zinc-400 text-sm" />
                  </td>
                  <td className="py-1 px-2 border-b border-zinc-200 dark:border-zinc-800">
                    <select value={h.category} onChange={(e) => updateHolding(h.id, { category: e.target.value as PortfolioHolding["category"] })} className="bg-transparent text-sm">
                      <option value="akcija">Akcija</option>
                      <option value="fond">Fond</option>
                      <option value="gotovina">Gotovina</option>
                    </select>
                  </td>
                  <td className="py-1 px-2 border-b border-zinc-200 dark:border-zinc-800">
                    <input value={h.currency} onChange={(e) => updateHolding(h.id, { currency: e.target.value.toUpperCase() })} className="w-14 bg-transparent border-b border-transparent focus:border-zinc-400 text-sm" />
                  </td>
                  <td className="py-1 px-2 border-b border-zinc-200 dark:border-zinc-800 text-right">
                    <input type="number" value={h.shares} onChange={(e) => updateHolding(h.id, { shares: parseFloat(e.target.value) || 0 })} className="w-20 bg-transparent border-b border-transparent focus:border-zinc-400 text-sm text-right tabular-nums" />
                  </td>
                  <td className="py-1 px-2 border-b border-zinc-200 dark:border-zinc-800 text-right">
                    <input type="number" value={h.marketValueNok} onChange={(e) => updateHolding(h.id, { marketValueNok: parseFloat(e.target.value) || 0 })} className="w-24 bg-transparent border-b border-transparent focus:border-zinc-400 text-sm text-right tabular-nums" />
                  </td>
                  <td className="py-1 px-2 border-b border-zinc-200 dark:border-zinc-800 text-right tabular-nums text-zinc-500 dark:text-zinc-400">
                    {total > 0 ? `${((h.marketValueNok / total) * 100).toFixed(1)}%` : "—"}
                  </td>
                  <td className="py-1 px-2 border-b border-zinc-200 dark:border-zinc-800">
                    <button onClick={() => removeHolding(h.id)} className="text-xs text-red-600 dark:text-red-400">✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={5} className="py-2 px-2 font-semibold">Ukupno</td>
                <td className="py-2 px-2 text-right font-semibold tabular-nums">{fmtNok(total)}</td>
                <td colSpan={2}></td>
              </tr>
            </tfoot>
          </table>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button onClick={addHolding} className="text-sm px-3 py-1.5 rounded-lg border border-zinc-300 dark:border-zinc-700">+ Dodaj poziciju</button>
          <button onClick={resetToReport} className="text-sm px-3 py-1.5 rounded-lg border border-zinc-300 dark:border-zinc-700">Resetuj na izveštaj</button>
          <button onClick={runAnalysis} disabled={running} className="text-sm px-4 py-1.5 rounded-lg bg-blue-600 disabled:opacity-60 text-white font-semibold">
            {running ? `Analiziram... (${progress}%)` : hasResults ? "Osveži analizu" : "Pokreni analizu"}
          </button>
        </div>
      </Section>

      {hasResults && (
        <>
          <Section title="Koncentracija i diverzifikacija">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
              <WeightList title="Po vrsti imovine" rows={concentration.categoryWeights} />
              <WeightList title="Po sektoru" rows={concentration.sectorWeights} />
              <WeightList title="Po valuti" rows={concentration.currencyWeights} />
            </div>
            {concentration.flags.length > 0 ? (
              <div className="mt-4 pt-3 border-t border-zinc-200 dark:border-zinc-800 space-y-2">
                <h4 className="text-xs font-semibold uppercase text-amber-600 dark:text-amber-400 mb-1">Upozorenja o koncentraciji</h4>
                {concentration.flags.map((f, i) => (
                  <div key={i} className="text-sm">
                    <span className={`font-medium ${f.severity >= 3 ? "text-red-600 dark:text-red-400" : "text-amber-600 dark:text-amber-400"}`}>{f.label}</span>
                    <span className="text-zinc-500 dark:text-zinc-400"> — {f.detail}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">Nema upozorenja o koncentraciji iznad pragova modela.</p>
            )}
          </Section>

          <Section title="Sud po poziciji — šta tržište već uračunava u cenu">
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr>
                    <th className="text-left text-xs uppercase text-zinc-500 py-1.5 px-2 border-b border-zinc-200 dark:border-zinc-800">Pozicija</th>
                    <th className="text-right text-xs uppercase text-zinc-500 py-1.5 px-2 border-b border-zinc-200 dark:border-zinc-800">Udeo</th>
                    <th className="text-right text-xs uppercase text-zinc-500 py-1.5 px-2 border-b border-zinc-200 dark:border-zinc-800">FCF prinos</th>
                    <th className="text-left text-xs uppercase text-zinc-500 py-1.5 px-2 border-b border-zinc-200 dark:border-zinc-800">Sud</th>
                    <th className="text-left text-xs uppercase text-zinc-500 py-1.5 px-2 border-b border-zinc-200 dark:border-zinc-800">Fundamenti</th>
                    <th className="text-center text-xs uppercase text-zinc-500 py-1.5 px-2 border-b border-zinc-200 dark:border-zinc-800">🚩</th>
                    <th className="text-left text-xs uppercase text-zinc-500 py-1.5 px-2 border-b border-zinc-200 dark:border-zinc-800">Uračunato u cenu?</th>
                  </tr>
                </thead>
                <tbody>
                  {holdings.filter((h) => h.ticker).map((h) => {
                    const r = results.get(h.ticker!);
                    const c = r?.computed;
                    const fcfYield = c ? computeFcfYield(resolveFcfForYield(c.data), c.data.marketCap) : null;
                    return (
                      <tr key={h.id}>
                        <td className="py-1.5 px-2 border-b border-zinc-200 dark:border-zinc-800">
                          <a href={`/model?ticker=${h.ticker}`} className="hover:underline font-medium">{h.name}</a>
                        </td>
                        <td className="py-1.5 px-2 border-b border-zinc-200 dark:border-zinc-800 text-right tabular-nums">{total > 0 ? `${((h.marketValueNok / total) * 100).toFixed(1)}%` : "—"}</td>
                        {r?.error ? (
                          <td colSpan={5} className="py-1.5 px-2 border-b border-zinc-200 dark:border-zinc-800 text-xs text-zinc-500 dark:text-zinc-400 italic">Greška: {r.error}</td>
                        ) : c ? (
                          <>
                            <td className={`py-1.5 px-2 border-b border-zinc-200 dark:border-zinc-800 text-right tabular-nums ${fcfYield != null && fcfYield < 0 ? "text-red-600 dark:text-red-400" : ""}`}>
                              {fcfYield != null ? `${(fcfYield * 100).toFixed(1)}%` : "—"}
                            </td>
                            <td className={`py-1.5 px-2 border-b border-zinc-200 dark:border-zinc-800 text-xs font-medium ${c.finalVerdict.verdict === "Kupovina" ? "text-emerald-600 dark:text-emerald-400" : c.finalVerdict.verdict === "Izbegavanje" ? "text-red-600 dark:text-red-400" : c.finalVerdict.verdict === "Čekaj — preskupo" ? "text-amber-600 dark:text-amber-400" : "text-zinc-600 dark:text-zinc-400"}`}>
                              {c.finalVerdict.verdict}
                            </td>
                            <td className={`py-1.5 px-2 border-b border-zinc-200 dark:border-zinc-800 text-xs font-medium ${c.fundamentalsRating.rating === "Jaki" ? "text-emerald-600 dark:text-emerald-400" : c.fundamentalsRating.rating === "Slabi" ? "text-red-600 dark:text-red-400" : "text-zinc-600 dark:text-zinc-400"}`}>
                              {c.fundamentalsRating.rating}
                            </td>
                            <td className="py-1.5 px-2 border-b border-zinc-200 dark:border-zinc-800 text-center">
                              {c.redFlags.length > 0 ? <span className="text-red-600 dark:text-red-400 font-semibold">{c.redFlags.length}</span> : <span className="text-zinc-400">0</span>}
                            </td>
                            <td className="py-1.5 px-2 border-b border-zinc-200 dark:border-zinc-800 text-xs text-zinc-600 dark:text-zinc-400">
                              {c.valuationFilter.pricedForPerfection ? "Da — cena uključuje visoka očekivanja" : "Ne — nema ekstremnih očekivanja u ceni"}
                            </td>
                          </>
                        ) : (
                          <td colSpan={5} className="py-1.5 px-2 border-b border-zinc-200 dark:border-zinc-800 text-xs italic text-zinc-500 dark:text-zinc-400">…</td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Section>

          <Section title="Tehnički pregled (mesečni trend)">
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr>
                    <th className="text-left text-xs uppercase text-zinc-500 py-1.5 px-2 border-b border-zinc-200 dark:border-zinc-800">Pozicija</th>
                    <th className="text-left text-xs uppercase text-zinc-500 py-1.5 px-2 border-b border-zinc-200 dark:border-zinc-800">Trend</th>
                    <th className="text-left text-xs uppercase text-zinc-500 py-1.5 px-2 border-b border-zinc-200 dark:border-zinc-800">Detalj</th>
                  </tr>
                </thead>
                <tbody>
                  {holdings.filter((h) => h.ticker).map((h) => {
                    const r = results.get(h.ticker!);
                    if (!r || r.error) return null;
                    const snapshot = computeTechnicalSnapshot(r.priceHistory);
                    return (
                      <tr key={h.id}>
                        <td className="py-1.5 px-2 border-b border-zinc-200 dark:border-zinc-800 font-medium">{h.name}</td>
                        <td className={`py-1.5 px-2 border-b border-zinc-200 dark:border-zinc-800 text-xs font-medium ${snapshot.trend === "rastući" ? "text-emerald-600 dark:text-emerald-400" : snapshot.trend === "opadajući" ? "text-red-600 dark:text-red-400" : "text-zinc-600 dark:text-zinc-400"}`}>
                          {snapshot.trend}
                        </td>
                        <td className="py-1.5 px-2 border-b border-zinc-200 dark:border-zinc-800 text-xs text-zinc-500 dark:text-zinc-400">{snapshot.detail}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
              Trend je izveden iz mesečnih zaključnih cena (prosek poslednja ~3 meseca naspram ~12 meseci) — jednostavan, deterministički signal, ne zamena za dnevni tehnički grafikon.
            </p>
          </Section>

          <Section title="Stres-test portfelja">
            <p className="text-sm mb-3">
              Ponderisana beta portfelja: <b>{stressTest.portfolioBeta != null ? stressTest.portfolioBeta.toFixed(2) : "—"}</b> (fondovi ≈ 1, gotovina = 0, akcije po stvarnoj beta vrednosti).
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr>
                    <th className="text-left text-xs uppercase text-zinc-500 py-1.5 px-2 border-b border-zinc-200 dark:border-zinc-800">Scenario</th>
                    <th className="text-right text-xs uppercase text-zinc-500 py-1.5 px-2 border-b border-zinc-200 dark:border-zinc-800">Procenjen uticaj</th>
                    <th className="text-right text-xs uppercase text-zinc-500 py-1.5 px-2 border-b border-zinc-200 dark:border-zinc-800">U NOK</th>
                  </tr>
                </thead>
                <tbody>
                  {stressTest.scenarios.map((s) => (
                    <tr key={s.label}>
                      <td className="py-1.5 px-2 border-b border-zinc-200 dark:border-zinc-800">{s.label}</td>
                      <td className="py-1.5 px-2 border-b border-zinc-200 dark:border-zinc-800 text-right tabular-nums text-red-600 dark:text-red-400">{fmtPct(s.portfolioImpactPercent ? s.portfolioImpactPercent / 100 : null)}</td>
                      <td className="py-1.5 px-2 border-b border-zinc-200 dark:border-zinc-800 text-right tabular-nums text-red-600 dark:text-red-400">{s.portfolioImpactNok != null ? fmtNok(s.portfolioImpactNok) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
              Procena je linearna (beta × pad tržišta) — pojednostavljenje koje ne uzima u obzir da korelacije rastu u panici (pozicije koje inače nisu povezane mogu pasti zajedno), niti specifične rizike po kompaniji iz sekcije rizika/crvenih zastavica iznad.
            </p>
          </Section>

          <Section title="Istorijski učinak naspram SPY">
            <div className="flex flex-wrap gap-4 items-end mb-4">
              <div>
                <label className="block text-xs text-zinc-500 dark:text-zinc-400 mb-1">Datum početka (npr. otvaranje portfelja)</label>
                <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="px-2 py-1 rounded border border-zinc-300 dark:border-zinc-700 bg-transparent text-sm" />
              </div>
              <div>
                <label className="block text-xs text-zinc-500 dark:text-zinc-400 mb-1">Prijavljeni ukupan prinos od tog datuma (iz izveštaja brokera, %)</label>
                <input type="text" value={reportedReturn} onChange={(e) => setReportedReturn(e.target.value)} className="w-24 px-2 py-1 rounded border border-zinc-300 dark:border-zinc-700 bg-transparent text-sm" />
              </div>
            </div>
            {portfolioVsSpySinceStart && (
              <p className="text-sm mb-3">
                Prijavljeni prinos portfelja (svi računi, iz izveštaja): <b>{reportedReturn}%</b>. Ponderisani prinos samo pozicija sa dostupnim tikerom ({(portfolioVsSpySinceStart.coveredWeight * 100).toFixed(0)}% portfelja) za isti period: <b>{fmtPct(portfolioVsSpySinceStart.portfolioReturn)}</b>, naspram SPY: <b>{fmtPct(portfolioVsSpySinceStart.spyReturn)}</b>.
              </p>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr>
                    <th className="text-left text-xs uppercase text-zinc-500 py-1.5 px-2 border-b border-zinc-200 dark:border-zinc-800">Period</th>
                    <th className="text-right text-xs uppercase text-zinc-500 py-1.5 px-2 border-b border-zinc-200 dark:border-zinc-800">Portfolio (ponderisano)</th>
                    <th className="text-right text-xs uppercase text-zinc-500 py-1.5 px-2 border-b border-zinc-200 dark:border-zinc-800">SPY</th>
                    <th className="text-left text-xs uppercase text-zinc-500 py-1.5 px-2 border-b border-zinc-200 dark:border-zinc-800">Pokriveno</th>
                  </tr>
                </thead>
                <tbody>
                  {benchmarkByHorizon.map((row) => (
                    <tr key={row.years}>
                      <td className="py-1.5 px-2 border-b border-zinc-200 dark:border-zinc-800">{row.years} god.</td>
                      <td className="py-1.5 px-2 border-b border-zinc-200 dark:border-zinc-800 text-right tabular-nums">{fmtPct(row.portfolioReturn, 0)}</td>
                      <td className="py-1.5 px-2 border-b border-zinc-200 dark:border-zinc-800 text-right tabular-nums">{fmtPct(row.spyReturn, 0)}</td>
                      <td className="py-1.5 px-2 border-b border-zinc-200 dark:border-zinc-800 text-xs text-zinc-500 dark:text-zinc-400">{(row.coveredWeight * 100).toFixed(0)}% portfelja</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
              &quot;Ponderisano&quot; znači prosek prinosa pojedinačnih pozicija otežan njihovim udelom u portfelju — pokriva samo pozicije sa Yahoo tikerom (fondovi bez tikera i gotovina su isključeni, otud &quot;Pokriveno&quot; kolona).
            </p>
          </Section>

          <div className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed border border-zinc-200 dark:border-zinc-800 rounded-xl p-4">
            Automatska analiza vesti po pojedinačnoj poziciji (koja vest utiče na koju akciju i koliko) nije još
            integrisana na sajtu — za najsvežije vesti pogledaj <Link href="/" className="underline">Vesti</Link>. Model
            pokriva samo američka i evropska tržišta; svi zaključci su automatski izvedeni iz javno dostupnih podataka
            prema fiksnim pravilima. Ovo NIJE finansijski savet.
          </div>
        </>
      )}
    </div>
  );
}

function WeightList({ title, rows }: { title: string; rows: { label: string; weight: number }[] }) {
  return (
    <div>
      <h4 className="text-xs font-semibold uppercase text-zinc-500 dark:text-zinc-400 mb-2">{title}</h4>
      <div className="space-y-1.5">
        {rows.map((r) => (
          <div key={r.label} className="text-sm">
            <div className="flex justify-between">
              <span>{r.label}</span>
              <span className="tabular-nums">{(r.weight * 100).toFixed(1)}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden mt-0.5">
              <div className="h-full bg-blue-600" style={{ width: `${Math.min(100, r.weight * 100)}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/50 rounded-xl p-5 mb-4">
      <h3 className="text-sm font-semibold pb-2 mb-3 border-b border-zinc-200 dark:border-zinc-800">{title}</h3>
      {children}
    </div>
  );
}
