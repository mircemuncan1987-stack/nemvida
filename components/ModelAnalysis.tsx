"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { computeModel, extractModelData, type ComputedModel } from "@/lib/buildModel";
import type { FilterCheck } from "@/lib/model";

const fmtPct = (x: number | null | undefined, digits = 1) =>
  x === null || x === undefined || Number.isNaN(x) ? "—" : `${x >= 0 ? "+" : ""}${(x * 100).toFixed(digits)}%`;

const fmtMoney = (x: number | null | undefined, currency: string) =>
  x === null || x === undefined || Number.isNaN(x) ? "—" : `${x.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${currency}`;

async function fetchModelResult(symbol: string): Promise<ComputedModel> {
  const res = await fetch(`/api/stock?symbol=${encodeURIComponent(symbol)}&type=valuation`, { cache: "no-store" });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  const result = data?.quoteSummary?.result?.[0];
  if (!result) throw new Error("Podaci nisu dostupni za ovaj tiker.");
  const modelData = extractModelData(result, symbol);
  return computeModel(modelData);
}

interface SearchResult {
  symbol: string;
  name: string;
  exchange: string;
}

async function searchSymbols(query: string): Promise<SearchResult[]> {
  const res = await fetch(`/api/stock?symbol=${encodeURIComponent(query)}&type=search`, { cache: "no-store" });
  if (!res.ok) return [];
  const data = await res.json();
  const quotes = data?.quotes || [];
  return quotes
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((q: any) => q.symbol && q.quoteType === "EQUITY")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((q: any) => ({ symbol: q.symbol, name: q.shortname || q.longname || q.symbol, exchange: q.exchDisp || q.exchange || "" }));
}

function checkRow(c: FilterCheck) {
  const icon = c.pass == null ? "●" : c.pass ? "✓" : "✗";
  const color = c.pass == null ? "text-zinc-400" : c.pass ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400";
  return (
    <div key={c.label} className="flex items-start gap-3 py-1.5">
      <span className={`font-bold ${color}`}>{icon}</span>
      <div>
        <div className="text-sm font-medium">{c.label}</div>
        <div className="text-xs text-zinc-500 dark:text-zinc-400">{c.detail}</div>
      </div>
    </div>
  );
}

export default function ModelAnalysis() {
  const [ticker, setTicker] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ComputedModel | null>(null);
  const [suggestions, setSuggestions] = useState<SearchResult[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const searchParams = useSearchParams();

  async function runAnalysis(sym: string) {
    if (!sym) return;
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const r = await fetchModelResult(sym);
      setResult(r);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Greška pri preuzimanju podataka.");
    } finally {
      setLoading(false);
    }
  }

  function pickSuggestion(s: SearchResult) {
    setTicker(s.symbol);
    setSuggestions([]);
    setShowSuggestions(false);
    runAnalysis(s.symbol);
  }

  useEffect(() => {
    const fromUrl = searchParams.get("ticker");
    if (fromUrl) {
      const sym = fromUrl.trim().toUpperCase();
      // eslint-disable-next-line react-hooks/set-state-in-effect -- inicijalno popunjavanje iz URL parametra
      setTicker(sym);
      runAnalysis(sym);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const query = ticker.trim();
    if (query.length < 2) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- čisti prethodne predloge kad je unos prekratak za pretragu
      setSuggestions([]);
      return;
    }
    let cancelled = false;
    const handle = setTimeout(async () => {
      const found = await searchSymbols(query);
      if (!cancelled) {
        setSuggestions(found);
        setShowSuggestions(true);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [ticker]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await runAnalysis(ticker.trim().toUpperCase());
  }

  let content: React.ReactNode = null;

  if (result) {
    const { data, breakdown, growthFilter, valuationFilter, moat, growthPotential, risks, management, bullBear, finalVerdict, shortTermUpside } = result;

    content = (
      <div className="mt-6 space-y-4">
        <div className="border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/50 rounded-xl p-5">
          <div className="flex flex-wrap items-baseline gap-2 justify-between">
            <h2 className="text-xl font-bold">{data.companyName} ({ticker.toUpperCase()})</h2>
            <div className="text-lg font-bold">{fmtMoney(data.currentPrice, data.currency)}</div>
          </div>
        </div>

        <Section title="1. Finansijski trend (poslednjih do 5 god.)">
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr>
                  <th className="text-left text-xs uppercase text-zinc-500 py-1.5 px-2 border-b border-zinc-200 dark:border-zinc-800">Godina</th>
                  <th className="text-right text-xs uppercase text-zinc-500 py-1.5 px-2 border-b border-zinc-200 dark:border-zinc-800">Prihod</th>
                  <th className="text-right text-xs uppercase text-zinc-500 py-1.5 px-2 border-b border-zinc-200 dark:border-zinc-800">Neto dobit (PAT)</th>
                  <th className="text-right text-xs uppercase text-zinc-500 py-1.5 px-2 border-b border-zinc-200 dark:border-zinc-800">FCF</th>
                  <th className="text-right text-xs uppercase text-zinc-500 py-1.5 px-2 border-b border-zinc-200 dark:border-zinc-800">Dug</th>
                </tr>
              </thead>
              <tbody>
                {breakdown.rows.map((r) => (
                  <tr key={r.label}>
                    <td className="py-1.5 px-2 border-b border-zinc-200 dark:border-zinc-800">{r.label}</td>
                    <td className="py-1.5 px-2 border-b border-zinc-200 dark:border-zinc-800 text-right tabular-nums">{r.revenue != null ? fmtMoney(r.revenue, data.currency) : "—"}</td>
                    <td className="py-1.5 px-2 border-b border-zinc-200 dark:border-zinc-800 text-right tabular-nums">{r.netIncome != null ? fmtMoney(r.netIncome, data.currency) : "—"}</td>
                    <td className="py-1.5 px-2 border-b border-zinc-200 dark:border-zinc-800 text-right tabular-nums">{r.fcf != null ? fmtMoney(r.fcf, data.currency) : "—"}</td>
                    <td className="py-1.5 px-2 border-b border-zinc-200 dark:border-zinc-800 text-right tabular-nums">{r.totalDebt != null ? fmtMoney(r.totalDebt, data.currency) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-sm">
            {breakdown.verdict === "nedovoljno podataka" ? (
              <>Nema dovoljno podataka za zaključak. {breakdown.detail}</>
            ) : (
              <>Zaključak: finansijski položaj kompanije izgleda <b>{breakdown.verdict}</b>. {breakdown.detail}</>
            )}
          </p>
        </Section>

        <Section title="2. Filter rasta — kvantitativni skrining">
          <div>{growthFilter.checks.map(checkRow)}</div>
          <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">{growthFilter.passCount}/{growthFilter.totalApplicable} primenjivih kriterijuma zadovoljeno. Ovo je samo analiza — nije poziv na kupovinu ili prodaju.</p>
        </Section>

        <Section title="3. Potencijal rasta (5-10 god.)">
          <p className="text-sm"><b>{growthPotential.label}</b> — procenjeni raspon rasta: {growthPotential.estimateRange}.</p>
          <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-1">{growthPotential.detail}</p>
        </Section>

        <Section title="4. Filter valuacije">
          <div>{valuationFilter.checks.map(checkRow)}</div>
          <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">{valuationFilter.passCount}/{valuationFilter.totalApplicable} primenjivih kriterijuma zadovoljeno. Jeftino ponekad znači pokvareno, a skupo ponekad znači kvalitet — ovo je samo disciplinski filter, ne presuda.</p>
        </Section>

        <Section title="5. Konkurentska prednost (objektivni proxy)">
          <p className="text-sm">Ocena: <b>{moat.score}/10</b></p>
          <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-1">{moat.detail}</p>
        </Section>

        <Section title="6. Analiza rizika (rangirano od najopasnijeg)">
          <div className="space-y-2">
            {risks.map((r) => (
              <div key={r.label} className="flex items-center gap-3">
                <span className={`text-xs font-bold px-2 py-0.5 rounded ${r.severity >= 4 ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" : r.severity >= 3 ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"}`}>
                  {r.severity}/5
                </span>
                <div>
                  <div className="text-sm font-medium">{r.label}</div>
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">{r.detail}</div>
                </div>
              </div>
            ))}
            {risks.length === 0 && <p className="text-sm italic text-zinc-500">Nema dovoljno podataka za procenu rizika.</p>}
          </div>
        </Section>

        <Section title="7. Kvalitet menadžmenta (objektivni proxy)">
          <p className="text-sm mb-2">
            {management.verdict === "nedovoljno podataka" ? (
              <>Nema dovoljno podataka za zaključak o kvalitetu menadžmenta.</>
            ) : (
              <>Zaključak: menadžment <b>{management.verdict}</b>.</>
            )}
          </p>
          <ul className="list-disc pl-5 space-y-1 text-sm text-zinc-600 dark:text-zinc-400">
            {management.details.map((d, i) => (
              <li key={i}>{d}</li>
            ))}
          </ul>
        </Section>

        <Section title="8. Bull vs Bear debata">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <h4 className="text-sm font-semibold text-emerald-600 dark:text-emerald-400 mb-2">Bikovski analitičar</h4>
              <ul className="list-disc pl-5 space-y-1 text-sm">
                {bullBear.bull.length ? bullBear.bull.map((b, i) => <li key={i}>{b}</li>) : <li className="italic text-zinc-500">Nema jasnih bikovskih signala u podacima.</li>}
              </ul>
            </div>
            <div>
              <h4 className="text-sm font-semibold text-red-600 dark:text-red-400 mb-2">Medveđi analitičar</h4>
              <ul className="list-disc pl-5 space-y-1 text-sm">
                {bullBear.bear.length ? bullBear.bear.map((b, i) => <li key={i}>{b}</li>) : <li className="italic text-zinc-500">Nema jasnih medveđih signala u podacima.</li>}
              </ul>
            </div>
          </div>
          <p className="mt-3 text-sm italic text-zinc-600 dark:text-zinc-400">{bullBear.conclusion}</p>
        </Section>

        <div className={`rounded-xl border-2 p-5 ${finalVerdict.verdict === "Kupovina" ? "border-emerald-400 dark:border-emerald-700" : finalVerdict.verdict === "Izbegavanje" ? "border-red-400 dark:border-red-700" : "border-zinc-300 dark:border-zinc-700"}`}>
          <div className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400 mb-1">9. Finalna sinteza — da li kupiti ovu akciju?</div>
          <div className="text-lg font-bold mb-1">{finalVerdict.verdict}</div>
          <div className="text-sm mb-2 flex gap-4 flex-wrap">
            <span>Kratkoročno (1 god., konsenzus analitičara): <b>{finalVerdict.shortTermLabel}</b> ({fmtPct(shortTermUpside)})</span>
            <span>Dugoročni izgled rasta (5+ god.): <b>{finalVerdict.growthLabel}</b></span>
          </div>
          <p className="text-sm leading-relaxed">{finalVerdict.detail}</p>
          <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
            Dugoročni izgled rasta se procenjuje iz istorijskog rasta i konsenzusa analitičara o rastu (vidi sekciju 3), namerno bez oslanjanja na modele procene vrednosti — svaki takav model nosi svoja ograničenja koja mogu iskriviti sud čak i za kvalitetne kompanije.
          </p>
        </div>

        <div className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed border border-zinc-200 dark:border-zinc-800 rounded-xl p-4">
          Model pokriva samo američka i evropska tržišta. Svi zaključci su automatski izvedeni iz javno dostupnih podataka (Yahoo Finance) prema fiksnim pravilima — nema slobodnog AI teksta niti procena koje se ne mogu proveriti. Ovo NIJE finansijski savet.
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 pb-16">
      <div className="mt-4 mb-5 text-sm leading-relaxed rounded-xl border border-amber-300/60 dark:border-amber-700/50 bg-amber-50 dark:bg-amber-900/15 text-amber-800 dark:text-amber-300 p-4">
        <b>⚠ Samo američke i evropske akcije.</b> Ovo NIJE finansijski savet — edukativni alat koji objedinjuje devet
        analitičkih dimenzija (finansijski trend, rast, valuacija, konkurentska prednost, rizik, menadžment, bikovska i
        medveđa debata i finalna sinteza) isključivo iz merljivih podataka.
      </div>

      <form onSubmit={handleSubmit} className="flex flex-wrap gap-2 items-end border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/50 rounded-xl p-4">
        <div className="flex-1 min-w-[160px] relative">
          <label className="block text-xs text-zinc-500 dark:text-zinc-400 mb-1">Ticker ili naziv kompanije (US/EU)</label>
          <input
            type="text"
            value={ticker}
            onChange={(e) => setTicker(e.target.value)}
            onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
            placeholder="npr. AAPL, ASML, SAP, Nestle..."
            className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-transparent"
            autoComplete="off"
            required
          />
          {showSuggestions && suggestions.length > 0 && (
            <ul className="absolute z-10 mt-1 w-full max-h-64 overflow-y-auto rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-lg">
              {suggestions.map((s) => (
                <li key={s.symbol}>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pickSuggestion(s)}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800 flex justify-between gap-2"
                  >
                    <span className="truncate">
                      <span className="font-semibold">{s.symbol}</span>{" "}
                      <span className="text-zinc-500 dark:text-zinc-400">{s.name}</span>
                    </span>
                    <span className="text-xs text-zinc-400 shrink-0">{s.exchange}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <button
          type="submit"
          disabled={loading}
          className="bg-blue-600 disabled:opacity-60 text-white font-semibold px-5 py-2 rounded-lg text-sm"
        >
          {loading ? "Učitavam..." : "Analiziraj"}
        </button>
      </form>
      {error && <div className="mt-3 text-sm text-red-600 dark:text-red-400">Greška: {error}</div>}

      {content}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/50 rounded-xl p-5">
      <h3 className="text-sm font-semibold pb-2 mb-3 border-b border-zinc-200 dark:border-zinc-800">{title}</h3>
      {children}
    </div>
  );
}
