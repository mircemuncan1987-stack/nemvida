"use client";

import { useRef, useState } from "react";
import {
  analyzeHistoricalMultiples,
  buildMultiplesTable,
  computeGrowthHorizons,
  computeHistoricalPE,
  computeHistoricalPFcf,
  computeModel,
  extractModelData,
  resolveFcfForYield,
  summarizeMultiplesTable,
  type ComputedModel,
  type MultipleReadingTone,
} from "@/lib/buildModel";
import { getSectorPeMedian, type FilterCheck, type FundamentalsRating, type Verdict4 } from "@/lib/model";
import { fetchPriceHistory, fetchStockAnalysisFcf, searchSymbols, translateToSerbian, type SearchResult } from "@/lib/clientData";

const fmtMoney = (x: number | null | undefined, currency: string) =>
  x === null || x === undefined || Number.isNaN(x) ? "—" : `${x.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${currency}`;

const fmtPct = (x: number | null | undefined, digits = 1) =>
  x === null || x === undefined || Number.isNaN(x) ? "—" : `${x >= 0 ? "+" : ""}${(x * 100).toFixed(digits)}%`;

const fmtRatio = (x: number | null | undefined) => (x === null || x === undefined || Number.isNaN(x) ? "—" : `${x.toFixed(1)}×`);

function fmtMarketCap(x: number | null, currency: string): string {
  if (x == null) return "—";
  const abs = Math.abs(x);
  if (abs >= 1e12) return `${(x / 1e12).toFixed(2)}T ${currency}`;
  if (abs >= 1e9) return `${(x / 1e9).toFixed(1)}B ${currency}`;
  if (abs >= 1e6) return `${(x / 1e6).toFixed(0)}M ${currency}`;
  return `${x.toLocaleString("en-US")} ${currency}`;
}

async function fetchModelResult(symbol: string): Promise<ComputedModel> {
  const res = await fetch(`/api/stock?symbol=${encodeURIComponent(symbol)}&type=valuation&full=1`, { cache: "no-store" });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  const modelData = extractModelData(data, symbol);
  return computeModel(modelData);
}

const VERDICT_COLORS: Record<Verdict4, string> = {
  "Kupovina": "bg-emerald-600 text-white",
  "Držanje": "bg-zinc-500 text-white",
  "Čekaj — preskupo": "bg-amber-500 text-white",
  "Izbegavanje": "bg-red-600 text-white",
  "Nedovoljno podataka": "bg-zinc-400 text-white",
};

const FUNDAMENTALS_COLORS: Record<FundamentalsRating, string> = {
  "Jaki": "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  "Osrednji": "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  "Slabi": "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  "Nedovoljno podataka": "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
};

const TONE_COLORS: Record<MultipleReadingTone, string> = {
  "povoljno": "text-emerald-600 dark:text-emerald-400",
  "neutralno": "text-zinc-600 dark:text-zinc-400",
  "skupo": "text-red-600 dark:text-red-400",
  "nedovoljno podataka": "text-zinc-400",
};

function severityColor(severity: number): string {
  if (severity >= 4) return "bg-red-500";
  if (severity === 3) return "bg-amber-500";
  return "bg-emerald-500";
}

function Box({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-zinc-200 dark:border-zinc-800 rounded-xl p-4 bg-white/70 dark:bg-zinc-900/50">
      <h3 className="text-xs font-bold uppercase tracking-wide text-zinc-500 dark:text-zinc-400 mb-3">{title}</h3>
      {children}
    </div>
  );
}

function MiniCheck({ c }: { c: FilterCheck }) {
  const icon = c.pass == null ? "●" : c.pass ? "✓" : "✗";
  const color = c.pass == null ? "text-zinc-400" : c.pass ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400";
  return (
    <div className="flex items-start gap-2 py-1">
      <span className={`font-bold shrink-0 ${color}`}>{icon}</span>
      <div>
        <div className="text-xs font-medium">{c.label}</div>
        <div className="text-[11px] text-zinc-500 dark:text-zinc-400">{c.detail}</div>
      </div>
    </div>
  );
}

export default function OverviewCard() {
  const [ticker, setTicker] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ComputedModel | null>(null);
  const [analyzedTicker, setAnalyzedTicker] = useState("");
  const [ownPeAvg, setOwnPeAvg] = useState<ReturnType<typeof analyzeHistoricalMultiples> | null>(null);
  const [translatedSummary, setTranslatedSummary] = useState<string | null>(null);
  const [translatingSummary, setTranslatingSummary] = useState(false);
  const [fallbackFcf, setFallbackFcf] = useState<number | null>(null);
  const [suggestions, setSuggestions] = useState<SearchResult[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [now] = useState(() => Date.now());
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function runAnalysis(sym: string) {
    if (!sym) return;
    setLoading(true);
    setError("");
    setResult(null);
    setOwnPeAvg(null);
    setTranslatedSummary(null);
    setFallbackFcf(null);
    setAnalyzedTicker(sym.toUpperCase());
    try {
      const r = await fetchModelResult(sym);
      setResult(r);
      const priceHistory = await fetchPriceHistory(sym);
      const shares = r.data.fundamentals.sharesOutstanding;
      const historicalPE = computeHistoricalPE(r.breakdown.rows, priceHistory, shares);
      const historicalPFcf = computeHistoricalPFcf(r.breakdown.rows, priceHistory, shares);
      setOwnPeAvg(analyzeHistoricalMultiples(historicalPE, historicalPFcf));
      if (resolveFcfForYield(r.data) == null) {
        fetchStockAnalysisFcf(sym).then(setFallbackFcf);
      }
      if (r.data.businessSummary) {
        setTranslatingSummary(true);
        translateToSerbian(r.data.businessSummary)
          .then(setTranslatedSummary)
          .finally(() => setTranslatingSummary(false));
      }
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

  function handleTickerChange(value: string) {
    setTicker(value);
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    const query = value.trim();
    if (query.length < 2) {
      setSuggestions([]);
      return;
    }
    searchDebounceRef.current = setTimeout(async () => {
      const found = await searchSymbols(query);
      setSuggestions(found);
      setShowSuggestions(true);
    }, 300);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await runAnalysis(ticker.trim().toUpperCase());
  }

  let content: React.ReactNode = null;

  if (result) {
    const { data, breakdown, growthFilter, growthPotential, moat, management, risks, bullBear, finalVerdict, fundamentalsRating, redFlags, avgIntrinsicValue } = result;
    const resolvedFcf = resolveFcfForYield(data) ?? fallbackFcf;
    const currentPFcf =
      resolvedFcf != null && resolvedFcf > 0 && data.fundamentals.sharesOutstanding
        ? data.currentPrice / (resolvedFcf / data.fundamentals.sharesOutstanding)
        : null;
    const sectorPeMedian = getSectorPeMedian(data.sector);
    const multiplesTable = buildMultiplesTable({
      peRatio: data.peRatio,
      pegRatio: data.pegRatio,
      evToEbitda: data.evToEbitda,
      currentPFcf,
      freeCashflowTtm: resolvedFcf,
      marketCap: data.marketCap,
      ownHistoricalPeAvg: ownPeAvg?.peAvg ?? null,
      ownHistoricalPFcfAvg: ownPeAvg?.pFcfAvg ?? null,
      peTrend: ownPeAvg?.peTrend ?? null,
      pFcfTrend: ownPeAvg?.pFcfTrend ?? null,
      sectorPeMedian,
      sector: data.sector,
    });
    const multiplesVerdict = summarizeMultiplesTable(multiplesTable);

    const revenueGrowth = computeGrowthHorizons(breakdown.rows, (r) => r.revenue);
    const earningsGrowth = computeGrowthHorizons(breakdown.rows, (r) => r.netIncome);
    const fcfGrowth = computeGrowthHorizons(breakdown.rows, (r) => r.fcf);

    const lastRow = data.yearlyRows[data.yearlyRows.length - 1];
    const netMargin = lastRow?.revenue && lastRow.netIncome != null ? lastRow.netIncome / lastRow.revenue : null;
    const fcfMargin = lastRow?.revenue && lastRow.fcf != null ? lastRow.fcf / lastRow.revenue : null;

    const rangePosition =
      data.fiftyTwoWeekLow != null && data.fiftyTwoWeekHigh != null && data.fiftyTwoWeekHigh > data.fiftyTwoWeekLow
        ? ((data.currentPrice - data.fiftyTwoWeekLow) / (data.fiftyTwoWeekHigh - data.fiftyTwoWeekLow)) * 100
        : null;

    // Traka "jeftino/pošteno/skupo" u odnosu na prosečnu procenjenu unutrašnju
    // vrednost (prosek DCF/DDM/relativne valuacije/Lynch formule — vidi
    // computeModel). ±15% je fiksna, ista margina za svaku kompaniju — nije
    // procena specifična za ovaj tiker.
    const band =
      avgIntrinsicValue != null
        ? { cheap: avgIntrinsicValue * 0.85, fair: avgIntrinsicValue, expensive: avgIntrinsicValue * 1.15 }
        : null;
    const bandMin = band ? band.cheap * 0.85 : null;
    const bandMax = band ? band.expensive * 1.15 : null;
    const pricePosition =
      band && bandMin != null && bandMax != null && bandMax > bandMin
        ? ((data.currentPrice - bandMin) / (bandMax - bandMin)) * 100
        : null;

    const pricingPowerCheck: FilterCheck = {
      label: "Može da diže cene (bruto marža preko 40%)",
      pass: data.grossMargin == null ? null : data.grossMargin > 0.4,
      detail: data.grossMargin != null ? `Bruto marža ${(data.grossMargin * 100).toFixed(1)}%` : "Bruto marža nije dostupna.",
    };
    const recessionCheck: FilterCheck = {
      label: "Otporna na tržišne padove (beta ispod 1)",
      pass: data.beta == null ? null : data.beta < 1,
      detail: data.beta != null ? `Beta ${data.beta.toFixed(2)} — koliko akcija u proseku prati kretanje tržišta.` : "Beta nije dostupna.",
    };

    content = (
      <div className="mt-6 space-y-4">
        {/* Zaglavlje */}
        <div className="border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/50 rounded-xl p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-xl font-bold">
                {data.companyName} <span className="text-zinc-400 font-normal">· {analyzedTicker}</span>
              </h2>
              <div className="text-sm text-zinc-500 dark:text-zinc-400 mt-0.5">
                {[data.sector, data.industry].filter(Boolean).join(" · ")}
                {data.country ? ` · ${data.country}` : ""}
                {data.employees != null ? ` · ${data.employees.toLocaleString("en-US")} zaposlenih` : ""}
              </div>
            </div>
            <div className="text-right">
              <div className="text-xl font-bold">{fmtMoney(data.currentPrice, data.currency)}</div>
              <div className="text-xs text-zinc-500 dark:text-zinc-400">
                Tržišna kap. {fmtMarketCap(data.marketCap, data.currency)} · {new Date(now).toLocaleDateString("sr-RS")}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 mt-4">
            <span className={`px-3 py-1 rounded-full text-sm font-bold ${VERDICT_COLORS[finalVerdict.verdict]}`}>{finalVerdict.verdict}</span>
            <span className={`px-3 py-1 rounded-full text-sm font-semibold ${FUNDAMENTALS_COLORS[fundamentalsRating.rating]}`}>
              Fundamenti: {fundamentalsRating.rating}
            </span>
            <span className="px-3 py-1 rounded-full text-sm font-semibold bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
              {growthPotential.label.split(" (")[0]}
            </span>
          </div>
          <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">{finalVerdict.detail}</p>
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          {/* Poslovanje */}
          <Box title="Poslovanje">
            {data.businessSummary ? (
              <p className="text-xs leading-relaxed text-zinc-600 dark:text-zinc-300 mb-3 line-clamp-5">
                {translatedSummary ?? (translatingSummary ? "Prevodim opis..." : data.businessSummary)}
              </p>
            ) : (
              <p className="text-xs italic text-zinc-500 dark:text-zinc-400 mb-3">Opis poslovanja nije dostupan.</p>
            )}
            {growthFilter.checks[0] && <MiniCheck c={growthFilter.checks[0]} />}
            <MiniCheck c={pricingPowerCheck} />
            <MiniCheck c={recessionCheck} />
            <div className="flex items-start gap-2 py-1">
              <span
                className={`font-bold shrink-0 ${moat.score >= 6 ? "text-emerald-600 dark:text-emerald-400" : moat.score <= 3 ? "text-red-600 dark:text-red-400" : "text-amber-600 dark:text-amber-400"}`}
              >
                {moat.score >= 6 ? "✓" : moat.score <= 3 ? "✗" : "●"}
              </span>
              <div>
                <div className="text-xs font-medium">
                  Konkurentska pozicija: {moat.score >= 6 ? "Dominantna" : moat.score <= 3 ? "Slaba" : "Umerena"} ({moat.score}/10)
                </div>
              </div>
            </div>
          </Box>

          {/* Rast */}
          <Box title="Rast">
            <div className="grid grid-cols-3 gap-2 text-center mb-3">
              <div>
                <div className="text-[11px] text-zinc-500 dark:text-zinc-400">Prihod 1G</div>
                <div className="font-semibold text-sm">{fmtPct(revenueGrowth.oneYear)}</div>
              </div>
              <div>
                <div className="text-[11px] text-zinc-500 dark:text-zinc-400">Prihod 3G</div>
                <div className="font-semibold text-sm">{fmtPct(revenueGrowth.threeYear)}</div>
              </div>
              <div>
                <div className="text-[11px] text-zinc-500 dark:text-zinc-400">Prihod 5G</div>
                <div className="font-semibold text-sm">{fmtPct(revenueGrowth.fiveYear)}</div>
              </div>
              <div>
                <div className="text-[11px] text-zinc-500 dark:text-zinc-400">Dobit 1G</div>
                <div className="font-semibold text-sm">{fmtPct(earningsGrowth.oneYear)}</div>
              </div>
              <div>
                <div className="text-[11px] text-zinc-500 dark:text-zinc-400">Dobit 3G</div>
                <div className="font-semibold text-sm">{fmtPct(earningsGrowth.threeYear)}</div>
              </div>
              <div>
                <div className="text-[11px] text-zinc-500 dark:text-zinc-400">Dobit 5G</div>
                <div className="font-semibold text-sm">{fmtPct(earningsGrowth.fiveYear)}</div>
              </div>
            </div>
            <div className="text-xs text-zinc-600 dark:text-zinc-400">
              Procena analitičara za budući rast: <span className="font-semibold">{growthPotential.estimateRange}</span>
            </div>
          </Box>

          {/* Konkurentska prednost */}
          <Box title="Konkurentska prednost (moat)">
            <div className="flex items-center gap-2 mb-2">
              <div className="flex-1 h-2 rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden">
                <div
                  className={`h-full ${moat.score >= 6 ? "bg-emerald-500" : moat.score <= 3 ? "bg-red-500" : "bg-amber-500"}`}
                  style={{ width: `${moat.score * 10}%` }}
                />
              </div>
              <span className="text-sm font-bold w-10 text-right">{moat.score}/10</span>
            </div>
            <p className="text-xs text-zinc-600 dark:text-zinc-400">{moat.detail}</p>
          </Box>

          {/* Menadžment */}
          <Box title="Menadžment i vlasnička struktura">
            <div
              className={`text-sm font-semibold mb-2 ${
                management.verdict === "izgleda pouzdano"
                  ? "text-emerald-600 dark:text-emerald-400"
                  : management.verdict === "izgleda rizično"
                    ? "text-red-600 dark:text-red-400"
                    : "text-zinc-600 dark:text-zinc-400"
              }`}
            >
              {management.verdict === "izgleda pouzdano" ? "Izgleda pouzdano" : management.verdict === "izgleda rizično" ? "Izgleda rizično" : management.verdict === "mešovito" ? "Mešoviti signali" : "Nedovoljno podataka"}
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
              <div className="text-zinc-500 dark:text-zinc-400">Vlasništvo insajdera</div>
              <div className="text-right font-medium">{fmtPct(data.heldPercentInsiders, 1)}</div>
              <div className="text-zinc-500 dark:text-zinc-400">Institucionalni investitori</div>
              <div className="text-right font-medium">{fmtPct(data.heldPercentInstitutions, 1)}</div>
              <div className="text-zinc-500 dark:text-zinc-400">ROE (proxy za ROIC)</div>
              <div className="text-right font-medium">{fmtPct(data.returnOnEquity, 1)}</div>
              <div className="text-zinc-500 dark:text-zinc-400">Neto marža</div>
              <div className="text-right font-medium">{fmtPct(netMargin, 1)}</div>
              <div className="text-zinc-500 dark:text-zinc-400">Dividendni prinos</div>
              <div className="text-right font-medium">{fmtPct(data.dividendYield, 2)}</div>
            </div>
          </Box>

          {/* Ključni pokazatelji */}
          <Box title="Ključni pokazatelji">
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
              <div className="text-zinc-500 dark:text-zinc-400">Bruto marža</div>
              <div className="text-right font-medium">{fmtPct(data.grossMargin, 1)}</div>
              <div className="text-zinc-500 dark:text-zinc-400">Operativna marža</div>
              <div className="text-right font-medium">{fmtPct(data.operatingMargins, 1)}</div>
              <div className="text-zinc-500 dark:text-zinc-400">Neto marža</div>
              <div className="text-right font-medium">{fmtPct(netMargin, 1)}</div>
              <div className="text-zinc-500 dark:text-zinc-400">FCF marža</div>
              <div className="text-right font-medium">{fmtPct(fcfMargin, 1)}</div>
              <div className="text-zinc-500 dark:text-zinc-400">Rast FCF (3G)</div>
              <div className="text-right font-medium">{fmtPct(fcfGrowth.threeYear, 1)}</div>
              <div className="text-zinc-500 dark:text-zinc-400">Gotovina</div>
              <div className="text-right font-medium">{fmtMarketCap(data.fundamentals.totalCash, data.currency)}</div>
              <div className="text-zinc-500 dark:text-zinc-400">Dug</div>
              <div className="text-right font-medium">{fmtMarketCap(data.fundamentals.totalDebt, data.currency)}</div>
            </div>
          </Box>

          {/* Rizik */}
          <Box title="Rizik">
            {risks.length === 0 ? (
              <p className="text-xs italic text-zinc-500 dark:text-zinc-400">Nema detektovanih rizika iz dostupnih podataka.</p>
            ) : (
              <div className="space-y-2">
                {risks.slice(0, 4).map((r) => (
                  <div key={r.label}>
                    <div className="flex justify-between text-xs mb-0.5">
                      <span className="font-medium">{r.label}</span>
                      <span className="text-zinc-500 dark:text-zinc-400">{r.detail}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden">
                      <div className={`h-full ${severityColor(r.severity)}`} style={{ width: `${r.severity * 20}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Box>

          {/* Valuacija */}
          <Box title="Valuacija">
            {band && bandMin != null && bandMax != null && pricePosition != null ? (
              <div className="mb-3">
                <div className="relative h-2 rounded-full bg-gradient-to-r from-emerald-400 via-amber-400 to-red-400">
                  <div className="absolute top-0 h-2 w-1 bg-black dark:bg-white" style={{ left: `${Math.min(100, Math.max(0, pricePosition))}%` }} />
                </div>
                <div className="flex justify-between text-[11px] text-zinc-500 dark:text-zinc-400 mt-1">
                  <span>Jeftino {fmtMoney(band.cheap, data.currency)}</span>
                  <span>Pošteno {fmtMoney(band.fair, data.currency)}</span>
                  <span>Skupo {fmtMoney(band.expensive, data.currency)}</span>
                </div>
                <div className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-1">Sada: {fmtMoney(data.currentPrice, data.currency)}</div>
              </div>
            ) : (
              <p className="text-xs italic text-zinc-500 dark:text-zinc-400 mb-3">Nedovoljno podataka za procenu unutrašnje vrednosti.</p>
            )}
            {rangePosition != null && (
              <div className="mb-3 text-[11px] text-zinc-500 dark:text-zinc-400">
                52-nedeljni raspon: {fmtMoney(data.fiftyTwoWeekLow, data.currency)} – {fmtMoney(data.fiftyTwoWeekHigh, data.currency)} (trenutno na {rangePosition.toFixed(0)}%)
              </div>
            )}
            <table className="w-full text-xs">
              <tbody>
                {multiplesTable.map((m) => (
                  <tr key={m.metric} className="border-t border-zinc-100 dark:border-zinc-800">
                    <td className="py-1 text-zinc-500 dark:text-zinc-400">{m.metric}</td>
                    <td className={`py-1 text-right font-medium ${TONE_COLORS[m.tone]}`}>{m.unit === "%" ? fmtPct(m.value, 1) : fmtRatio(m.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div
              className={`mt-2 text-xs font-semibold ${
                multiplesVerdict.verdict === "Izgleda jeftino"
                  ? "text-emerald-600 dark:text-emerald-400"
                  : multiplesVerdict.verdict === "Izgleda skupo"
                    ? "text-red-600 dark:text-red-400"
                    : "text-zinc-600 dark:text-zinc-400"
              }`}
            >
              {multiplesVerdict.verdict}
            </div>
          </Box>
        </div>

        {/* Zastavice */}
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="border border-emerald-300/60 dark:border-emerald-700/50 bg-emerald-50 dark:bg-emerald-900/15 rounded-xl p-4">
            <h3 className="text-xs font-bold uppercase tracking-wide text-emerald-700 dark:text-emerald-400 mb-2">Zeleni signali</h3>
            {bullBear.bull.length ? (
              <ul className="space-y-1">
                {bullBear.bull.map((b) => (
                  <li key={b} className="text-xs text-emerald-800 dark:text-emerald-300 flex gap-1.5">
                    <span>✓</span>
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs italic text-emerald-800/70 dark:text-emerald-300/70">Nema jasnih pozitivnih signala u dostupnim podacima.</p>
            )}
          </div>
          <div className="border border-red-300/60 dark:border-red-700/50 bg-red-50 dark:bg-red-900/15 rounded-xl p-4">
            <h3 className="text-xs font-bold uppercase tracking-wide text-red-700 dark:text-red-400 mb-2">Crveni signali</h3>
            {redFlags.length || bullBear.bear.length ? (
              <ul className="space-y-1">
                {[...redFlags, ...bullBear.bear].slice(0, 6).map((b) => (
                  <li key={b} className="text-xs text-red-800 dark:text-red-300 flex gap-1.5">
                    <span>✗</span>
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs italic text-red-800/70 dark:text-red-300/70">Nema detektovanih upozorenja u dostupnim podacima.</p>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 pb-16">
      <div className="mt-4 mb-5 text-sm leading-relaxed rounded-xl border border-amber-300/60 dark:border-amber-700/50 bg-amber-50 dark:bg-amber-900/15 text-amber-800 dark:text-amber-300 p-4">
        <b>⚠ Ovo NIJE finansijski savet.</b> Kompaktan pregled na jednoj strani — isti podaci i pragovi kao u{" "}
        <a href="/model" className="underline">sveobuhvatnom modelu</a>, samo drugačije, vizuelno prikazani. Samo američke i evropske akcije.
      </div>

      <form onSubmit={handleSubmit} className="flex flex-wrap gap-2 items-end border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/50 rounded-xl p-4">
        <div className="flex-1 min-w-[160px] relative">
          <label className="block text-xs text-zinc-500 dark:text-zinc-400 mb-1">Ticker ili naziv kompanije (US/EU)</label>
          <input
            type="text"
            value={ticker}
            onChange={(e) => handleTickerChange(e.target.value)}
            onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
            placeholder="npr. AAPL, MSFT, ASML, SAP..."
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
        <button type="submit" disabled={loading} className="bg-blue-600 disabled:opacity-60 text-white font-semibold px-5 py-2 rounded-lg text-sm">
          {loading ? "Učitavam..." : "Prikaži"}
        </button>
      </form>
      {error && <div className="mt-3 text-sm text-red-600 dark:text-red-400">Greška: {error}</div>}

      {content}
    </div>
  );
}
