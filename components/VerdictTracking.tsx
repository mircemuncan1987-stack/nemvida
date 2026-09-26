"use client";

import { useEffect, useState } from "react";
import { computeReturnSince, type HistoricalPricePoint } from "@/lib/buildModel";
import { fetchDailyPriceHistory } from "@/lib/clientData";
import { loadVerdictJournal, removeVerdictEntry, type VerdictJournalEntry } from "@/lib/verdictJournal";

interface RefreshResult {
  returnSince: number | null;
  spyReturn: number | null;
  currentPrice: number | null;
}

const fmtMoney = (x: number | null, currency: string) => (x == null ? "—" : `${x.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${currency}`);
const fmtPct = (x: number | null) => (x == null ? "—" : `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%`);

function daysAgo(dateStr: string): number {
  const then = new Date(dateStr + "T00:00:00Z").getTime();
  return Math.floor((Date.now() - then) / 86400000);
}

export default function VerdictTracking() {
  const [entries, setEntries] = useState<VerdictJournalEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [results, setResults] = useState<Map<string, RefreshResult>>(new Map());
  const [running, setRunning] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState<number | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- jednokratno učitavanje iz localStorage pri montiranju
    setEntries(loadVerdictJournal());
    setLoaded(true);
  }, []);

  async function refresh() {
    setRunning(true);
    const nowSeconds = Math.floor(Date.now() / 1000);
    const uniqueTickers = Array.from(new Set(entries.map((e) => e.ticker)));
    const [spyHistory, ...stockHistories] = await Promise.all([
      fetchDailyPriceHistory("SPY"),
      ...uniqueTickers.map((t) => fetchDailyPriceHistory(t)),
    ]);
    const historyByTicker = new Map<string, HistoricalPricePoint[]>();
    uniqueTickers.forEach((t, i) => historyByTicker.set(t, stockHistories[i]));

    const newResults = new Map<string, RefreshResult>();
    for (const e of entries) {
      const hist = historyByTicker.get(e.ticker) || [];
      const startTs = Math.floor(new Date(e.date + "T00:00:00Z").getTime() / 1000);
      newResults.set(`${e.ticker}_${e.date}`, {
        returnSince: computeReturnSince(hist, startTs, nowSeconds),
        spyReturn: computeReturnSince(spyHistory, startTs, nowSeconds),
        currentPrice: hist.length ? hist[hist.length - 1].close : null,
      });
    }
    setResults(newResults);
    setLastRefreshed(Date.now());
    setRunning(false);
  }

  function removeEntry(ticker: string, date: string) {
    removeVerdictEntry(ticker, date);
    setEntries((prev) => prev.filter((e) => !(e.ticker === ticker && e.date === date)));
  }

  const sorted = [...entries].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.ticker.localeCompare(b.ticker)));

  return (
    <div className="max-w-5xl mx-auto px-4 pb-16">
      <div className="mt-4 mb-5 text-sm leading-relaxed rounded-xl border border-amber-300/60 dark:border-amber-700/50 bg-amber-50 dark:bg-amber-900/15 text-amber-800 dark:text-amber-300 p-4">
        <b>⚠ Ovo NIJE finansijski savet, i NIJE retroaktivan test modela.</b> Ovde se čuva sud modela (i cena) za
        svaki tiker onog trenutka kad ga analiziraš na <a href="/pregled" className="underline">pregledu kompanije</a>
        {" "}— jedan zapis po tikeru po kalendarskom danu, lokalno u tvom pregledaču. Praćenje počinje od trenutka kad
        prvi put otvoriš taj tiker — model nema pristup istoriji sopstvenih prošlih sudova od pre nego što je ovo
        dodato, pa se ništa ne dopunjuje unazad. Vremenom, kroz obično korišćenje /pregled, ovo postaje stvarna
        (mala) evidencija koliko su sudovi modela bili u pravu.
      </div>

      <div className="border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/50 rounded-xl p-4 mb-4 flex flex-wrap gap-3 items-center">
        <button
          onClick={refresh}
          disabled={running || entries.length === 0}
          className="bg-blue-600 text-white font-semibold px-5 py-2 rounded-lg text-sm disabled:opacity-60"
        >
          {running ? "Osvežavam..." : "Osveži cene"}
        </button>
        {lastRefreshed && <span className="text-xs text-zinc-500 dark:text-zinc-400">Osveženo: {new Date(lastRefreshed).toLocaleString("sr-RS")}</span>}
      </div>

      {loaded && entries.length === 0 && (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Još nema zapisa. Analiziraj neki tiker na <a href="/pregled" className="underline">pregledu kompanije</a> —
          sud i cena se automatski zabeleže ovde.
        </p>
      )}

      {entries.length > 0 && (
        <div className="border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/50 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr>
                  <th className="text-left text-xs uppercase text-zinc-500 dark:text-zinc-400 py-2 px-3 border-b border-zinc-200 dark:border-zinc-800">Ticker</th>
                  <th className="text-left text-xs uppercase text-zinc-500 dark:text-zinc-400 py-2 px-3 border-b border-zinc-200 dark:border-zinc-800">Datum poziva</th>
                  <th className="text-left text-xs uppercase text-zinc-500 dark:text-zinc-400 py-2 px-3 border-b border-zinc-200 dark:border-zinc-800">Sud tada</th>
                  <th className="text-right text-xs uppercase text-zinc-500 dark:text-zinc-400 py-2 px-3 border-b border-zinc-200 dark:border-zinc-800">Cena tada</th>
                  <th className="text-right text-xs uppercase text-zinc-500 dark:text-zinc-400 py-2 px-3 border-b border-zinc-200 dark:border-zinc-800">Cena sada</th>
                  <th className="text-right text-xs uppercase text-zinc-500 dark:text-zinc-400 py-2 px-3 border-b border-zinc-200 dark:border-zinc-800">Prinos</th>
                  <th className="text-right text-xs uppercase text-zinc-500 dark:text-zinc-400 py-2 px-3 border-b border-zinc-200 dark:border-zinc-800">SPY (isti period)</th>
                  <th className="text-left text-xs uppercase text-zinc-500 dark:text-zinc-400 py-2 px-3 border-b border-zinc-200 dark:border-zinc-800">Ishod</th>
                  <th className="py-2 px-3 border-b border-zinc-200 dark:border-zinc-800"></th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((e) => {
                  const r = results.get(`${e.ticker}_${e.date}`);
                  const outcome = r && r.returnSince != null && r.spyReturn != null ? (r.returnSince > r.spyReturn ? "Nadmašuje SPY" : "Ispod SPY") : null;
                  return (
                    <tr key={`${e.ticker}_${e.date}`}>
                      <td className="py-2 px-3 border-b border-zinc-200 dark:border-zinc-800 font-semibold">
                        <a href={`/pregled?ticker=${e.ticker}`} className="hover:underline">{e.ticker}</a>
                      </td>
                      <td className="py-2 px-3 border-b border-zinc-200 dark:border-zinc-800 text-xs text-zinc-500 dark:text-zinc-400">
                        {e.date} <span className="text-zinc-400">({daysAgo(e.date)}d)</span>
                      </td>
                      <td
                        className={`py-2 px-3 border-b border-zinc-200 dark:border-zinc-800 text-xs font-medium ${
                          e.verdict === "Kupovina"
                            ? "text-emerald-600 dark:text-emerald-400"
                            : e.verdict === "Izbegavanje"
                              ? "text-red-600 dark:text-red-400"
                              : e.verdict === "Čekaj — preskupo"
                                ? "text-amber-600 dark:text-amber-400"
                                : "text-zinc-600 dark:text-zinc-400"
                        }`}
                      >
                        {e.verdict}
                      </td>
                      <td className="py-2 px-3 border-b border-zinc-200 dark:border-zinc-800 text-right tabular-nums">{fmtMoney(e.price, e.currency)}</td>
                      <td className="py-2 px-3 border-b border-zinc-200 dark:border-zinc-800 text-right tabular-nums">{fmtMoney(r?.currentPrice ?? null, e.currency)}</td>
                      <td className={`py-2 px-3 border-b border-zinc-200 dark:border-zinc-800 text-right tabular-nums font-medium ${r?.returnSince != null && r.returnSince < 0 ? "text-red-600 dark:text-red-400" : r?.returnSince != null ? "text-emerald-600 dark:text-emerald-400" : ""}`}>
                        {fmtPct(r?.returnSince ?? null)}
                      </td>
                      <td className="py-2 px-3 border-b border-zinc-200 dark:border-zinc-800 text-right tabular-nums text-zinc-500 dark:text-zinc-400">{fmtPct(r?.spyReturn ?? null)}</td>
                      <td
                        className={`py-2 px-3 border-b border-zinc-200 dark:border-zinc-800 text-xs font-medium ${
                          outcome === "Nadmašuje SPY" ? "text-emerald-600 dark:text-emerald-400" : outcome === "Ispod SPY" ? "text-red-600 dark:text-red-400" : "text-zinc-400"
                        }`}
                      >
                        {outcome ?? "—"}
                      </td>
                      <td className="py-2 px-3 border-b border-zinc-200 dark:border-zinc-800">
                        <button onClick={() => removeEntry(e.ticker, e.date)} className="text-xs text-red-600 dark:text-red-400">✕</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
