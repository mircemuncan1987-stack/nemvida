"use client";

import { useState } from "react";

interface AnalyzedFor {
  ticker: string;
  companyName: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractCompanyName(stockData: any, fallback: string): string {
  const price = stockData?.quoteSummary?.result?.[0]?.price;
  return price?.longName || price?.shortName || fallback;
}

export default function FisherAnalysis() {
  const [ticker, setTicker] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [analyzedFor, setAnalyzedFor] = useState<AnalyzedFor | null>(null);

  async function runAnalysis() {
    const sym = ticker.trim().toUpperCase();
    if (!sym) return;
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const stockRes = await fetch(`/api/stock?symbol=${encodeURIComponent(sym)}&type=valuation`, { cache: "no-store" });
      const stockData = await stockRes.json();
      if (!stockRes.ok) throw new Error(stockData?.error || `HTTP ${stockRes.status}`);
      const companyName = extractCompanyName(stockData, sym);

      const fisherRes = await fetch("/api/fisher", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker: sym, companyName }),
      });
      const fisherData = await fisherRes.json();
      if (!fisherRes.ok) throw new Error(fisherData?.error || `HTTP ${fisherRes.status}`);

      setResult(fisherData.text);
      setAnalyzedFor({ ticker: sym, companyName });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Greška pri analizi.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-3xl mx-auto px-4 pb-16">
      <div className="mt-4 mb-5 text-sm leading-relaxed rounded-xl border border-amber-300/60 dark:border-amber-700/50 bg-amber-50 dark:bg-amber-900/15 text-amber-800 dark:text-amber-300 p-4">
        <b>⚠ Ovo NIJE finansijski savet, i razlikuje se od ostatka sajta.</b> Ovo je jedina stranica koja koristi
        slobodan AI-generisan tekst (Claude), umesto fiksnih pravila nad merljivim podacima kao svuda drugde na
        sajtu. Odgovori su zasnovani na znanju modela iz obuke — <b>nije live pretraga interneta u realnom
        vremenu</b> — pa mogu biti zastareli, netačni ili nepotpuni, posebno za skorašnje vesti i događaje. Fišerov
        okvir (Philip Fisher, &quot;Common Stocks and Uncommon Profits&quot;) je subjektivan i kvalitativan po
        prirodi — mnoga od ovih 15 pitanja (integritet menadžmenta, odnosi sa zaposlenima) se ne mogu proveriti iz
        javno dostupnih finansijskih podataka. Uzmi odgovore kao polaznu tačku za sopstveno istraživanje, ne kao
        gotov zaključak.
      </div>

      <div className="border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/50 rounded-xl p-4 mb-4 flex flex-wrap gap-3 items-center">
        <input
          type="text"
          value={ticker}
          onChange={(e) => setTicker(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !loading && runAnalysis()}
          placeholder="Ticker (npr. MSFT)"
          className="flex-1 min-w-[160px] px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-transparent text-sm"
        />
        <button onClick={runAnalysis} disabled={loading} className="bg-blue-600 text-white font-semibold px-5 py-2 rounded-lg text-sm disabled:opacity-60">
          {loading ? "Analiziram... (može potrajati 20-60s)" : "Analiziraj (Fišerovih 15 pitanja)"}
        </button>
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400 mb-4">{error}</p>}

      {result && analyzedFor && (
        <div className="border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/50 rounded-xl p-5">
          <h2 className="text-lg font-bold mb-3">
            {analyzedFor.companyName} ({analyzedFor.ticker})
          </h2>
          <div className="text-sm whitespace-pre-wrap leading-relaxed">{result}</div>
        </div>
      )}
    </div>
  );
}
