"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  classifyBusinessPhase,
  computeOverviewScores,
  computeOwnHistoricalAverages,
  buildCapitalAllocationBreakdown,
  BUSINESS_PHASE_DEFINITIONS,
  computeEarningsReactions,
  computeFcfYieldPremium,
  computeGrowthHorizons,
  computeHistoricalVolatility,
  computeModel,
  DEFAULT_ASSUMPTIONS,
  extractModelData,
  resolveFcfForYield,
  type ComputedModel,
  type EarningsReaction,
  type HistoricalMultipleRow,
  type HistoricalPricePoint,
  type MultipleReadingTone,
} from "@/lib/buildModel";
import { type FilterCheck } from "@/lib/model";
import { fetchDailyPriceHistory, fetchPriceHistory, fetchStockAnalysisFcf, searchSymbols, translateToSerbian, type SearchResult } from "@/lib/clientData";
import { recordVerdict } from "@/lib/verdictJournal";

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

const TONE_COLORS: Record<MultipleReadingTone, string> = {
  "povoljno": "text-emerald-600 dark:text-emerald-400",
  "neutralno": "text-zinc-600 dark:text-zinc-400",
  "skupo": "text-red-600 dark:text-red-400",
  "nedovoljno podataka": "text-zinc-400",
};

function scoreColor(score: number | null): string {
  if (score == null) return "bg-zinc-300 dark:bg-zinc-700";
  if (score >= 4) return "bg-emerald-500";
  if (score === 3) return "bg-amber-500";
  return "bg-red-500";
}

function scoreTextColor(score: number | null): string {
  if (score == null) return "text-zinc-400";
  if (score >= 4) return "text-emerald-600 dark:text-emerald-400";
  if (score === 3) return "text-amber-600 dark:text-amber-400";
  return "text-red-600 dark:text-red-400";
}

function severityColor(severity: number): string {
  if (severity >= 4) return "bg-red-500";
  if (severity === 3) return "bg-amber-500";
  return "bg-emerald-500";
}

type Tone = "good" | "neutral" | "bad" | "unknown";

function toneClass(tone: Tone): string {
  if (tone === "good") return "text-emerald-600 dark:text-emerald-400";
  if (tone === "bad") return "text-red-600 dark:text-red-400";
  if (tone === "neutral") return "text-amber-600 dark:text-amber-400";
  return "text-zinc-400";
}

// Pragovi su fiksni i dokumentovani uz svaki poziv — nema slobodne procene.
function toneForNetDebtToEbitda(x: number | null): Tone {
  if (x == null) return "unknown";
  if (x < 1) return "good";
  if (x < 3) return "neutral";
  return "bad";
}
function toneForSbcPercent(x: number | null): Tone {
  if (x == null) return "unknown";
  if (x < 0.03) return "good";
  if (x < 0.08) return "neutral";
  return "bad";
}
function toneForVolatility(x: number | null): Tone {
  if (x == null) return "unknown";
  if (x < 0.25) return "good";
  if (x < 0.45) return "neutral";
  return "bad";
}
function toneForSigned(x: number | null): Tone {
  if (x == null) return "unknown";
  if (x > 0.001) return "good";
  if (x < -0.001) return "bad";
  return "neutral";
}
function toneForStreak(x: number | null): Tone {
  if (x == null) return "unknown";
  if (x >= 3) return "good";
  if (x >= 1) return "neutral";
  return "bad";
}

// Pet tačkica (dot meter) — vizuelni ekvivalent trake ocene 1-5 sa uzora,
// bez tvrdnje o preciznosti koju brojevi inače sugerišu.
function DotMeter({ score }: { score: number | null }) {
  return (
    <div className="flex gap-0.5 justify-center mt-1">
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} className={`w-1.5 h-1.5 rounded-full ${score != null && i <= score ? scoreColor(score) : "bg-zinc-200 dark:bg-zinc-700"}`} />
      ))}
    </div>
  );
}

function DimensionBadge({ title, score, label }: { title: string; score: number | null; label: string }) {
  return (
    <div className="flex-1 min-w-[92px] text-center border border-zinc-200 dark:border-zinc-800 rounded-lg py-2 px-1">
      <div className="text-[10px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{title}</div>
      <div className={`text-sm font-bold ${scoreTextColor(score)}`}>{score ?? "—"}</div>
      <DotMeter score={score} />
      <div className="text-[10px] text-zinc-500 dark:text-zinc-400 mt-1 truncate" title={label}>
        {label}
      </div>
    </div>
  );
}

function Box({ title, badge, children }: { title: string; badge?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="border border-zinc-200 dark:border-zinc-800 rounded-xl p-4 bg-white/70 dark:bg-zinc-900/50">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-bold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{title}</h3>
        {badge}
      </div>
      {children}
    </div>
  );
}

function CheckRow({ c }: { c: FilterCheck }) {
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

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-zinc-200 dark:border-zinc-800 rounded-lg p-2 text-center">
      <div className="text-sm font-bold">{value}</div>
      <div className="text-[10px] text-zinc-500 dark:text-zinc-400 mt-0.5">{label}</div>
    </div>
  );
}

// Samostalan red (ne oslanja se na roditeljski grid da uparuje labelu i
// vrednost) — ranije je u nekim kutijama roditeljski div bio obično
// naslagan (bez grid/flex klase), pa su labela i broj završavali jedno
// ispod drugog umesto u istom redu.
function KeyVal({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-baseline gap-3 py-0.5">
      <span className="text-zinc-500 dark:text-zinc-400">{label}</span>
      <span className="text-right font-medium shrink-0">{value}</span>
    </div>
  );
}

// Grafikon istorijskog P/E-a (godišnje, iz dostupnih izveštaja — obično
// poslednje ~4 fiskalne godine) sa trenutnim P/E kao poslednjim stubićem i
// isprekidanom linijom na nivou sopstvenog istorijskog proseka — vizuelni
// odgovor na "gde je trenutna cena u odnosu na istorijsku" bez uvođenja nove
// procene, samo prikaz brojeva koji već postoje u tabeli multiplikatora ispod.
function PeHistoryChart({ rows, currentPE, avgPE }: { rows: HistoricalMultipleRow[]; currentPE: number | null; avgPE: number | null }) {
  const points: { label: string; value: number; isNow: boolean }[] = rows
    .filter((r): r is { year: string; multiple: number } => r.multiple != null && r.multiple > 0)
    .map((r) => ({ label: r.year, value: r.multiple, isNow: false }));
  if (currentPE != null && currentPE > 0) points.push({ label: "Sada", value: currentPE, isNow: true });
  if (points.length < 2) return null;

  const maxVal = Math.max(...points.map((p) => p.value), avgPE ?? 0) * 1.15;
  const avgHeightPercent = avgPE != null ? Math.min(100, (avgPE / maxVal) * 100) : null;
  const cols = `repeat(${points.length}, 1fr)`;

  function toneFor(p: { value: number; isNow: boolean }): string {
    if (!p.isNow) return "bg-zinc-300 dark:bg-zinc-700";
    if (avgPE == null) return "bg-zinc-400";
    if (p.value < avgPE * 0.95) return "bg-emerald-500";
    if (p.value > avgPE * 1.05) return "bg-red-500";
    return "bg-amber-500";
  }

  return (
    <div className="mb-3">
      <div className="text-[11px] text-zinc-500 dark:text-zinc-400 mb-1">Istorijski P/E (godišnje) naspram trenutnog</div>
      <div className="grid gap-1.5" style={{ gridTemplateColumns: cols }}>
        {points.map((p) => (
          <div key={p.label} className={`text-center text-[10px] tabular-nums ${p.isNow ? "font-semibold text-zinc-700 dark:text-zinc-300" : "text-zinc-500 dark:text-zinc-400"}`}>
            {p.value.toFixed(1)}×
          </div>
        ))}
      </div>
      <div className="relative h-20 grid gap-1.5" style={{ gridTemplateColumns: cols }}>
        {avgHeightPercent != null && (
          <div
            className="absolute left-0 right-0 border-t border-dashed border-zinc-400 dark:border-zinc-500"
            style={{ bottom: `${avgHeightPercent}%` }}
          />
        )}
        {points.map((p) => (
          <div key={p.label} className="flex items-end h-full" title={`${p.label}: P/E ${p.value.toFixed(1)}×`}>
            <div className={`w-full rounded-t ${toneFor(p)}`} style={{ height: `${Math.max(4, (p.value / maxVal) * 100)}%` }} />
          </div>
        ))}
      </div>
      <div className="grid gap-1.5" style={{ gridTemplateColumns: cols }}>
        {points.map((p) => (
          <div key={p.label} className={`text-center text-[10px] mt-1 ${p.isNow ? "font-semibold text-zinc-900 dark:text-zinc-50" : "text-zinc-400"}`}>
            {p.label}
          </div>
        ))}
      </div>
      {avgPE != null && (
        <p className="text-[11px] text-zinc-400 mt-1">
          Isprekidana linija = sopstveni istorijski prosek P/E ({avgPE.toFixed(1)}×). Zeleno/crveno na stubiću
          &quot;Sada&quot; = trenutni P/E je ispod/iznad tog proseka (±5%), žuto = blizu proseka.
        </p>
      )}
    </div>
  );
}

export default function OverviewCard() {
  const [ticker, setTicker] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ComputedModel | null>(null);
  const [analyzedTicker, setAnalyzedTicker] = useState("");
  const [ownAvg, setOwnAvg] = useState<ReturnType<typeof computeOwnHistoricalAverages> | null>(null);
  const [translatedSummary, setTranslatedSummary] = useState<string | null>(null);
  const [translatingSummary, setTranslatingSummary] = useState(false);
  const [fallbackFcf, setFallbackFcf] = useState<number | null>(null);
  const [monthlyPriceHistory, setMonthlyPriceHistory] = useState<HistoricalPricePoint[]>([]);
  const [earningsReactions, setEarningsReactions] = useState<EarningsReaction[]>([]);
  const [suggestions, setSuggestions] = useState<SearchResult[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [now] = useState(() => Date.now());
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchParams = useSearchParams();

  async function runAnalysis(sym: string) {
    if (!sym) return;
    setLoading(true);
    setError("");
    setResult(null);
    setOwnAvg(null);
    setTranslatedSummary(null);
    setFallbackFcf(null);
    setMonthlyPriceHistory([]);
    setEarningsReactions([]);
    setAnalyzedTicker(sym.toUpperCase());
    try {
      const r = await fetchModelResult(sym);
      setResult(r);
      recordVerdict({
        ticker: sym.toUpperCase(),
        companyName: r.data.companyName,
        date: new Date().toISOString().slice(0, 10),
        verdict: r.finalVerdict.verdict,
        price: r.data.currentPrice,
        currency: r.data.currency,
      });
      const priceHistory = await fetchPriceHistory(sym);
      setMonthlyPriceHistory(priceHistory);
      setOwnAvg(computeOwnHistoricalAverages(r, priceHistory));
      if (resolveFcfForYield(r.data) == null) {
        fetchStockAnalysisFcf(sym).then(setFallbackFcf);
      }
      // Aproksimacija reakcije cene na izveštaje — vidi napomenu u
      // computeEarningsReactions o ograničenjima (Yahoo daje datum kraja
      // kvartala, ne datum objave rezultata).
      if (r.data.earningsBeats?.some((b) => b.date != null)) {
        fetchDailyPriceHistory(sym).then((daily) => {
          setEarningsReactions(computeEarningsReactions(r.data.earningsBeats, daily));
        });
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
    const {
      data,
      breakdown,
      growthPotential,
      moat,
      moatNarrative,
      management,
      risks,
      bullBear,
      finalVerdict,
      redFlags,
      shortTermUpside,
      fcfStability,
      consecutiveRevenueQuarters,
      consecutiveEarningsQuarters,
      qualityOfEarnings,
      fcfConversion,
      altmanZScore,
      shareCountTrend,
      shareholderYield,
      netDebtToEbitda,
      sbcPercent,
    } = result;
    const { currentPFcf, multiplesTable, multiplesVerdict, qualityChecks, scores } = computeOverviewScores(
      result,
      ownAvg,
      fallbackFcf
    );

    const capitalAllocation = buildCapitalAllocationBreakdown(data.capitalAllocationRows).slice(-4);

    const revenueGrowth = computeGrowthHorizons(breakdown.rows, (r) => r.revenue);
    const earningsGrowth = computeGrowthHorizons(breakdown.rows, (r) => r.netIncome);
    const fcfGrowth = computeGrowthHorizons(breakdown.rows, (r) => r.fcf);

    const lastRow = data.yearlyRows[data.yearlyRows.length - 1];
    const netMargin = lastRow?.revenue && lastRow.netIncome != null ? lastRow.netIncome / lastRow.revenue : null;
    const fcfMargin = lastRow?.revenue && lastRow.fcf != null ? lastRow.fcf / lastRow.revenue : null;
    const revenueTtmOrLatest = data.revenueTtm ?? lastRow?.revenue ?? null;
    const revenueTtmLabel = data.revenueTtm != null ? "Prihod (TTM)" : "Prihod (poslednja FG)";
    const priceToSales = data.marketCap != null && revenueTtmOrLatest ? data.marketCap / revenueTtmOrLatest : null;

    const financialHealthCheck: FilterCheck = {
      label: "Finansijski zdrava (likvidnost + zaduženost)",
      pass:
        data.currentRatio != null && data.debtToEquity != null
          ? data.currentRatio >= 1 && data.debtToEquity / 100 < 1.5
          : null,
      detail:
        data.currentRatio != null && data.debtToEquity != null
          ? `Current ratio ${data.currentRatio.toFixed(2)}, Dug/kapital ${(data.debtToEquity / 100).toFixed(2)}`
          : "Nedostaje current ratio ili dug/kapital.",
    };
    const phase = classifyBusinessPhase({
      revenueGrowthTtm: data.revenueGrowthTtm,
      revenueCagr: breakdown.revenueCagr,
      operatingMargins: data.operatingMargins,
      dividendPaidConsistently: data.dividendPaidConsistently,
    });

    const rangePosition =
      data.fiftyTwoWeekLow != null && data.fiftyTwoWeekHigh != null && data.fiftyTwoWeekHigh > data.fiftyTwoWeekLow
        ? ((data.currentPrice - data.fiftyTwoWeekLow) / (data.fiftyTwoWeekHigh - data.fiftyTwoWeekLow)) * 100
        : null;

    // Traka niska/prosečna/visoka ciljna cena analitičara (konsenzus, ne naš
    // model) — direktno sa Yahoo Finance-a (targetLowPrice/Mean/HighPrice).
    const targetBand =
      data.targetLowPrice != null && data.targetMeanPrice != null && data.targetHighPrice != null && data.targetHighPrice > data.targetLowPrice
        ? { low: data.targetLowPrice, mean: data.targetMeanPrice, high: data.targetHighPrice }
        : null;
    const targetBandMin = targetBand ? Math.min(targetBand.low, data.currentPrice) * 0.95 : null;
    const targetBandMax = targetBand ? Math.max(targetBand.high, data.currentPrice) * 1.05 : null;
    const targetPricePosition =
      targetBand && targetBandMin != null && targetBandMax != null && targetBandMax > targetBandMin
        ? ((data.currentPrice - targetBandMin) / (targetBandMax - targetBandMin)) * 100
        : null;

    const beatsCount = data.earningsBeats ? data.earningsBeats.filter((b) => b.beat).length : null;
    const daysToEarnings = data.nextEarningsDate != null ? Math.round((data.nextEarningsDate * 1000 - now) / 86400000) : null;
    const historicalVolatility = computeHistoricalVolatility(monthlyPriceHistory);
    const fcfYieldValue = multiplesTable.find((m) => m.metric === "FCF prinos")?.value ?? null;
    const fcfYieldPremium = computeFcfYieldPremium(fcfYieldValue, DEFAULT_ASSUMPTIONS.riskFreeRate);

    content = (
      <div className="mt-6 space-y-4">
        {/* Zaglavlje */}
        <div className="border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/50 rounded-xl p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="w-11 h-11 rounded-lg bg-blue-600 text-white font-bold flex items-center justify-center text-lg shrink-0">
                {analyzedTicker.slice(0, 1)}
              </div>
              <div>
                <h2 className="text-xl font-bold leading-tight">{data.companyName}</h2>
                <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                  {analyzedTicker}
                  {data.exchangeName ? ` · ${data.exchangeName}` : ""}
                  {data.country ? ` · ${data.country}` : ""}
                </div>
                <div className="text-xs text-zinc-500 dark:text-zinc-400">
                  {[data.sector, data.industry].filter(Boolean).join(" · ")}
                  {data.employees != null ? ` · ${data.employees.toLocaleString("en-US")} zaposlenih` : ""}
                </div>
              </div>
            </div>
            <div className="text-right">
              <div className="text-xl font-bold">{fmtMoney(data.currentPrice, data.currency)}</div>
              <div className="text-xs text-zinc-500 dark:text-zinc-400">
                {new Date(now).toLocaleDateString("sr-RS")} · Tržišna kap. {fmtMarketCap(data.marketCap, data.currency)}
              </div>
              <div className="text-xs text-zinc-500 dark:text-zinc-400">
                {revenueTtmLabel} {fmtMarketCap(revenueTtmOrLatest, data.currency)}
              </div>
              {data.nextEarningsDate != null && (
                <div className="text-xs text-zinc-500 dark:text-zinc-400">
                  Sledeći izveštaj: {new Date(data.nextEarningsDate * 1000).toLocaleDateString("sr-RS")}
                  {daysToEarnings != null && daysToEarnings >= 0 ? ` (za ${daysToEarnings} d.)` : ""}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Kompozitni skor + dimenzije */}
        <div className="border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/50 rounded-xl p-4">
          <div className="flex flex-wrap items-center gap-4 mb-3">
            <div className="text-center px-4 py-2 rounded-xl bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900">
              <div className="text-[10px] uppercase tracking-wide opacity-70">Kompozitni skor</div>
              <div className="text-2xl font-bold">{scores.composite != null ? scores.composite.toFixed(1) : "—"}</div>
              <div className="text-xs font-bold">{finalVerdict.verdict}</div>
            </div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 flex-1 min-w-[200px]">{finalVerdict.detail}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <DimensionBadge title="Poslovanje" score={scores.business.score} label={scores.business.label} />
            <DimensionBadge title="Moat" score={scores.moat.score} label={scores.moat.label} />
            <DimensionBadge title="Pravac moat-a" score={scores.moatDirection.score} label={scores.moatDirection.label} />
            <DimensionBadge title="Rast" score={scores.growth.score} label={scores.growth.label} />
            <DimensionBadge title="Menadžment" score={scores.management.score} label={scores.management.label} />
            <DimensionBadge title="Rizik" score={scores.risk.score} label={scores.risk.label} />
            <DimensionBadge title="Valuacija" score={scores.valuation.score} label={scores.valuation.label} />
          </div>
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          {/* Poslovanje */}
          <Box title="Poslovanje" badge={<span className={`text-xs font-bold ${scoreTextColor(scores.business.score)}`}>{scores.business.score ?? "—"}/5</span>}>
            {data.businessSummary ? (
              <p className="text-xs leading-relaxed text-zinc-600 dark:text-zinc-300 mb-3 line-clamp-4">
                {translatedSummary ?? (translatingSummary ? "Prevodim opis..." : data.businessSummary)}
              </p>
            ) : (
              <p className="text-xs italic text-zinc-500 dark:text-zinc-400 mb-3">Opis poslovanja nije dostupan.</p>
            )}
            <p className="text-[11px] text-zinc-400 mb-2 italic">
              Podela prihoda po segmentima nije dostupna (Yahoo Finance je ne pruža za većinu tikera) — proverljivi kvalitativni signali ispod:
            </p>
            {qualityChecks.map((c) => (
              <CheckRow key={c.label} c={c} />
            ))}
          </Box>

          {/* Faza */}
          <Box title="Faza poslovnog ciklusa">
            <div className="grid grid-cols-5 gap-1 mb-3">
              {[1, 2, 3, 4, 5].map((p) => (
                <div key={p} className={`h-2 rounded-full ${phase.phase === p ? "bg-blue-600" : "bg-zinc-200 dark:bg-zinc-800"}`} />
              ))}
            </div>
            <div className="text-xs grid grid-cols-5 gap-1 text-center text-zinc-400 mb-3">
              <span>Osnivanje</span>
              <span>Hiper-rast</span>
              <span>Poluga</span>
              <span>Povraćaj kap.</span>
              <span>Opadanje</span>
            </div>
            <div className="text-sm font-semibold">{phase.label}</div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1 mb-3">{phase.detail}</p>
            <table className="w-full text-[11px] border-collapse">
              <tbody>
                {BUSINESS_PHASE_DEFINITIONS.map((d) => {
                  const active = d.phase === phase.phase;
                  return (
                    <tr key={d.phase} className={active ? "bg-blue-50 dark:bg-blue-900/20" : ""}>
                      <td className={`py-1 pr-2 align-top ${active ? "font-bold" : "text-zinc-500 dark:text-zinc-400"}`}>
                        {active && "→ "}
                        {d.phase} · {d.name}
                      </td>
                      <td className="py-1 text-zinc-500 dark:text-zinc-400 align-top">{d.meaning}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="text-[11px] text-zinc-400 mt-2 italic">
              Aproksimacija iz rasta prihoda, operativne marže i doslednosti dividende — fiksni pragovi (vidi kriterijum svake faze iznad), ne kvalitativna procena.
            </p>
          </Box>

          {/* Moat */}
          <Box title="Konkurentska prednost (moat)" badge={<span className={`text-xs font-bold ${scoreTextColor(scores.moat.score)}`}>{moat.score}/10</span>}>
            <div className="flex items-center gap-2 mb-2">
              <div className="flex-1 h-2 rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden">
                <div className={scoreColor(scores.moat.score) + " h-full"} style={{ width: `${moat.score * 10}%` }} />
              </div>
            </div>
            <div className="text-sm font-semibold mb-2">{moatNarrative.headline}</div>
            <ul className="space-y-1.5 mb-2">
              {moatNarrative.reasons.map((r) => (
                <li key={r} className="text-xs text-zinc-600 dark:text-zinc-300 flex gap-1.5">
                  <span className="text-zinc-400 shrink-0">•</span>
                  <span>{r}</span>
                </li>
              ))}
            </ul>
            <p className="text-[11px] text-zinc-400 italic">
              Obrazloženje je izvedeno iz istih fiksnih pragova koji daju i ocenu {moat.score}/10 (marže i prinos na kapital naspram cene kapitala) —
              ne meri direktno brend ili distribuciju, jer to finansijski izveštaji sami po sebi ne pokazuju.
            </p>
          </Box>

          {/* Menadžment */}
          <Box title="Menadžment i vlasnička struktura" badge={<span className={`text-xs font-bold ${scoreTextColor(scores.management.score)}`}>{scores.management.score ?? "—"}/5</span>}>
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
            <div className="text-xs">
              <KeyVal label="Vlasništvo insajdera" value={fmtPct(data.heldPercentInsiders, 1)} />
              <KeyVal label="Institucionalni investitori" value={fmtPct(data.heldPercentInstitutions, 1)} />
              <KeyVal label="Prinos na kapital (ROE, proxy za ROIC)" value={fmtPct(data.returnOnEquity, 1)} />
              <KeyVal label="Neto marža" value={fmtPct(netMargin, 1)} />
              <KeyVal label="Dividendni prinos" value={fmtPct(data.dividendYield, 2)} />
              <KeyVal
                label="Zarada naspram procena (poslednja 4 kv.)"
                value={beatsCount != null && data.earningsBeats ? `${beatsCount}/${data.earningsBeats.length} premašilo` : "Nije dostupno"}
              />
              <div className="flex justify-between items-baseline gap-3 py-0.5">
                <span className="text-zinc-500 dark:text-zinc-400">Trend broja akcija u opticaju</span>
                <span className={`text-right font-medium shrink-0 ${toneClass(shareCountTrend.direction === "opada (otkup)" || shareCountTrend.direction === "stabilno" ? "good" : shareCountTrend.direction === "raste (dilucija)" ? "neutral" : "unknown")}`}>
                  {shareCountTrend.direction === "nepoznato" ? "—" : shareCountTrend.direction}
                </span>
              </div>
              <div className="flex justify-between items-baseline gap-3 py-0.5">
                <span className="text-zinc-500 dark:text-zinc-400">Ukupni prinos akcionarima (div. + otkup)</span>
                <span className={`text-right font-medium shrink-0 ${toneClass(toneForSigned(shareholderYield))}`}>{fmtPct(shareholderYield, 2)}</span>
              </div>
            </div>
            <p className="text-[11px] text-zinc-400 mt-2 italic">{shareCountTrend.detail}</p>

            {data.insiderTransactions && data.insiderTransactions.length > 0 && (
              <div className="mt-3 pt-2 border-t border-zinc-100 dark:border-zinc-800">
                <div className="text-[10px] uppercase text-zinc-400 mb-1">Poslednje insajderske transakcije</div>
                <table className="w-full text-[11px]">
                  <tbody>
                    {data.insiderTransactions.slice(0, 5).map((t, i) => (
                      <tr key={i} className="border-t border-zinc-100 dark:border-zinc-800">
                        <td className="py-1 text-zinc-500 dark:text-zinc-400">{t.date != null ? new Date(t.date * 1000).toLocaleDateString("sr-RS") : "—"}</td>
                        <td className="py-1 text-zinc-500 dark:text-zinc-400 truncate max-w-[110px]">{t.filerName ?? "—"}</td>
                        <td className={`py-1 text-right font-medium ${t.type === "kupovina" ? "text-emerald-600 dark:text-emerald-400" : t.type === "prodaja" ? "text-red-600 dark:text-red-400" : "text-zinc-400"}`}>
                          {t.type} {t.shares != null ? `(${t.shares.toLocaleString("en-US")})` : ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {earningsReactions.length > 0 && (
              <div className="mt-3 pt-2 border-t border-zinc-100 dark:border-zinc-800">
                <div className="text-[10px] uppercase text-zinc-400 mb-1">Reakcija cene posle izveštaja (aproksimacija)</div>
                <table className="w-full text-[11px]">
                  <tbody>
                    {earningsReactions.map((e) => (
                      <tr key={e.date} className="border-t border-zinc-100 dark:border-zinc-800">
                        <td className="py-1 text-zinc-500 dark:text-zinc-400">{new Date(e.date * 1000).toLocaleDateString("sr-RS")}</td>
                        <td className={`py-1 ${e.beat ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>{e.beat ? "Premašilo" : "Promašilo"}</td>
                        <td className={`py-1 text-right font-medium ${toneClass(toneForSigned(e.reactionPercent))}`}>{fmtPct(e.reactionPercent, 1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="text-[11px] text-zinc-400 mt-1 italic">
                  Približna promena cene u ~2 meseca nakon kraja kvartala — Yahoo ne daje tačan datum objave rezultata, pa ovo NIJE precizna reakcija na dan objave.
                </p>
              </div>
            )}
          </Box>

          {/* Rast */}
          <Box title="Rast" badge={<span className={`text-xs font-bold ${scoreTextColor(scores.growth.score)}`}>{scores.growth.score ?? "—"}/5</span>}>
            <div className="grid grid-cols-3 gap-2 mb-3">
              <StatTile label="Prihod 1G" value={fmtPct(revenueGrowth.oneYear)} />
              <StatTile label="Prihod 3G" value={fmtPct(revenueGrowth.threeYear)} />
              <StatTile label="Prihod 5G" value={fmtPct(revenueGrowth.fiveYear)} />
              <StatTile label="Dobit 1G" value={fmtPct(earningsGrowth.oneYear)} />
              <StatTile label="Dobit 3G" value={fmtPct(earningsGrowth.threeYear)} />
              <StatTile label="Dobit 5G" value={fmtPct(earningsGrowth.fiveYear)} />
            </div>
            <div className="text-xs text-zinc-600 dark:text-zinc-400 mb-2">
              Procena analitičara za budući rast: <span className="font-semibold">{growthPotential.estimateRange}</span>
            </div>
            <div className="text-xs text-zinc-600 dark:text-zinc-400">
              Uzastopni kvartali rasta: prihod{" "}
              <span className={`font-semibold ${toneClass(toneForStreak(consecutiveRevenueQuarters))}`}>{consecutiveRevenueQuarters ?? "—"}</span>, dobit{" "}
              <span className={`font-semibold ${toneClass(toneForStreak(consecutiveEarningsQuarters))}`}>{consecutiveEarningsQuarters ?? "—"}</span>
            </div>
            <p className="text-[11px] text-zinc-400 mt-1 italic">Sekvencijalno kvartal-na-kvartal (ne godina-na-godinu) — Yahoo obično vraća samo poslednja 4 kvartala.</p>
          </Box>

          {/* Ključni pokazatelji — namerno BEZ rasta prihoda/dobiti (već su u kutiji "Rast")
              i BEZ ROE/dividende (već su u kutiji "Menadžment"), da isti broj ne bi
              stajao dvaput pod dva imena. Fokus ovde je isključivo profitabilnost i
              novčani tok. */}
          <Box title="Profitabilnost i novčani tok">
            <div className="grid grid-cols-3 gap-2 mb-3">
              <StatTile label="Bruto marža" value={fmtPct(data.grossMargin, 1)} />
              <StatTile label="Operativna marža" value={fmtPct(data.operatingMargins, 1)} />
              <StatTile label="Neto marža" value={fmtPct(netMargin, 1)} />
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
              <div>
                <div className="text-[10px] uppercase text-zinc-400 mb-0.5">Slobodan novčani tok</div>
                <KeyVal label="FCF marža" value={fmtPct(fcfMargin, 1)} />
                <KeyVal label="Rast FCF (3G)" value={fmtPct(fcfGrowth.threeYear)} />
              </div>
              <div>
                <div className="text-[10px] uppercase text-zinc-400 mb-0.5">Bilans stanja</div>
                <KeyVal label="Gotovina" value={fmtMarketCap(data.fundamentals.totalCash, data.currency)} />
                <KeyVal label="Dug" value={fmtMarketCap(data.fundamentals.totalDebt, data.currency)} />
                <div className="flex justify-between items-baseline gap-3 py-0.5">
                  <span className="text-zinc-500 dark:text-zinc-400">Neto dug/EBITDA (proxy)</span>
                  <span className={`text-right font-medium shrink-0 ${toneClass(toneForNetDebtToEbitda(netDebtToEbitda))}`}>{fmtRatio(netDebtToEbitda)}</span>
                </div>
              </div>
            </div>
            <div className="mt-3 pt-2 border-t border-zinc-100 dark:border-zinc-800 text-xs">
              <div className="flex justify-between items-baseline gap-3 py-0.5">
                <span className="text-zinc-500 dark:text-zinc-400">Kvalitet zarade (neto/operativna dobit)</span>
                <span className={`text-right font-medium shrink-0 ${toneClass(qualityOfEarnings.label === "Uredno" ? "good" : qualityOfEarnings.label === "Proveriti jednokratne stavke" ? "bad" : "unknown")}`}>
                  {qualityOfEarnings.label}
                </span>
              </div>
              <div className="flex justify-between items-baseline gap-3 py-0.5">
                <span className="text-zinc-500 dark:text-zinc-400">FCF konverzija (FCF/neto dobit)</span>
                <span className={`text-right font-medium shrink-0 ${toneClass(fcfConversion.label === "Odlično" ? "good" : fcfConversion.label === "Solidno" ? "neutral" : fcfConversion.label === "Slabo" ? "bad" : "unknown")}`}>
                  {fcfConversion.label}
                  {fcfConversion.ratio != null ? ` (${(fcfConversion.ratio * 100).toFixed(0)}%)` : ""}
                </span>
              </div>
              <div className="flex justify-between items-baseline gap-3 py-0.5">
                <span className="text-zinc-500 dark:text-zinc-400">Stabilnost FCF-a (koef. varijacije)</span>
                <span
                  className={`text-right font-medium shrink-0 ${toneClass(fcfStability.label === "Stabilan" ? "good" : fcfStability.label === "Umereno stabilan" ? "neutral" : fcfStability.label === "Nestabilan" ? "bad" : "unknown")}`}
                >
                  {fcfStability.label}
                  {fcfStability.coefficientOfVariation != null ? ` (${fcfStability.coefficientOfVariation.toFixed(2)})` : ""}
                </span>
              </div>
              <div className="flex justify-between items-baseline gap-3 py-0.5">
                <span className="text-zinc-500 dark:text-zinc-400">Akcijska kompenzacija (SBC) / prihod</span>
                <span className={`text-right font-medium shrink-0 ${toneClass(toneForSbcPercent(sbcPercent))}`}>{fmtPct(sbcPercent, 1)}</span>
              </div>
            </div>
            <p className="text-[11px] text-zinc-400 mt-2 italic">
              {qualityOfEarnings.detail} {fcfConversion.detail} {fcfStability.detail}
            </p>
            <p className="text-[11px] text-zinc-400 mt-1 italic">
              Rast prihoda/dobiti je u kutiji &quot;Rast&quot;, a ROE i dividenda u kutiji &quot;Menadžment&quot; — ovde su samo marže, gotovina i kvalitet zarade, da se isti broj ne ponavlja pod dva imena.
            </p>
          </Box>

          {/* Kapitalna alokacija */}
          <Box title="Kapitalna alokacija">
            {capitalAllocation.length > 0 ? (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-[10px] uppercase text-zinc-400">
                        <th className="text-left py-1">Godina</th>
                        <th className="text-right py-1">FCF</th>
                        <th className="text-right py-1">Dividenda</th>
                        <th className="text-right py-1">Otkup akcija</th>
                        <th className="text-right py-1">Otplata duga</th>
                        <th className="text-right py-1">Ostalo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {capitalAllocation.map((r) => (
                        <tr key={r.label} className="border-t border-zinc-100 dark:border-zinc-800">
                          <td className="py-1 text-zinc-500 dark:text-zinc-400">{r.label}</td>
                          <td className="py-1 text-right font-medium">{fmtMarketCap(r.fcf, data.currency)}</td>
                          <td className="py-1 text-right tabular-nums">{r.dividendsPercent.toFixed(0)}%</td>
                          <td className="py-1 text-right tabular-nums">{r.buybacksPercent.toFixed(0)}%</td>
                          <td className="py-1 text-right tabular-nums">{r.debtPaydownPercent.toFixed(0)}%</td>
                          <td className={`py-1 text-right tabular-nums ${r.otherPercent < -10 ? "text-amber-600 dark:text-amber-400 font-medium" : ""}`}>{r.otherPercent.toFixed(0)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-[11px] text-zinc-400 mt-2 italic">
                  Procenti su udeo u slobodnom novčanom toku (FCF) te godine. &quot;Ostalo&quot; je preostalo posle
                  dividende, otkupa akcija i otplate duga — pozitivno znači zadržana gotovina/rezerva ili
                  reinvestiranje, negativno (žuto) znači da je deo raspodele te godine finansiran dugom ili
                  gotovinskim rezervama, jer FCF nije pokrio sve isplate.
                </p>
              </>
            ) : (
              <p className="text-xs italic text-zinc-500 dark:text-zinc-400">
                Nema dovoljno podataka za prikaz — slobodan novčani tok nije pozitivan u dostupnim godišnjim
                izveštajima, ili dividenda/otkup/dug nisu dostupni u Yahoo izveštaju za ovaj tiker.
              </p>
            )}
          </Box>

          {/* Rizik */}
          <Box title="Rizik" badge={<span className={`text-xs font-bold ${scoreTextColor(scores.risk.score)}`}>{scores.risk.label}</span>}>
            <div className="flex justify-between items-baseline gap-3 py-1 mb-1">
              <span className="text-xs text-zinc-500 dark:text-zinc-400">Altman Z-score (rizik bankrotstva)</span>
              <span
                className={`text-xs text-right font-semibold shrink-0 ${toneClass(altmanZScore.zone === "Sigurna zona" ? "good" : altmanZScore.zone === "Siva zona" ? "neutral" : altmanZScore.zone === "Zona rizika" ? "bad" : "unknown")}`}
              >
                {altmanZScore.z != null ? `${altmanZScore.z.toFixed(2)} — ${altmanZScore.zone}` : altmanZScore.zone}
              </span>
            </div>
            <div className="flex justify-between items-baseline gap-3 py-1 mb-2">
              <span className="text-xs text-zinc-500 dark:text-zinc-400">Istorijska volatilnost cene (anualizovana)</span>
              <span className={`text-xs text-right font-semibold shrink-0 ${toneClass(toneForVolatility(historicalVolatility))}`}>{fmtPct(historicalVolatility, 0)}</span>
            </div>
            <CheckRow c={financialHealthCheck} />
            <CheckRow
              c={{ label: "Diversifikovani prihodi (segmenti/geografija)", pass: null, detail: "Nije merljivo — Yahoo Finance ne pruža podelu prihoda po segmentima za većinu tikera." }}
            />
            <CheckRow c={{ label: "Pretnja od disrupcije", pass: null, detail: "Nije merljivo iz finansijskih izveštaja — zahteva kvalitativnu procenu industrije." }} />
            <CheckRow c={{ label: "Faktori van kontrole kompanije (regulativa, sirovine)", pass: null, detail: "Nije merljivo iz finansijskih izveštaja." }} />
            {risks.length > 0 && (
              <div className="mt-3 space-y-2">
                {risks.slice(0, 3).map((r) => (
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
            <p className="text-[11px] text-zinc-400 mt-3 italic">{altmanZScore.detail}</p>
          </Box>

          {/* Valuacija */}
          <Box title="Valuacija" badge={<span className={`text-xs font-bold ${scoreTextColor(scores.valuation.score)}`}>{scores.valuation.score ?? "—"}/5</span>}>
            {targetBand && targetBandMin != null && targetBandMax != null && targetPricePosition != null ? (
              <div className="mb-3">
                <div className="relative h-2 rounded-full bg-gradient-to-r from-red-400 via-amber-400 to-emerald-400">
                  <div className="absolute top-0 h-2 w-1 bg-black dark:bg-white" style={{ left: `${Math.min(100, Math.max(0, targetPricePosition))}%` }} />
                </div>
                <div className="flex justify-between text-[11px] text-zinc-500 dark:text-zinc-400 mt-1">
                  <span>Nisko {fmtMoney(targetBand.low, data.currency)}</span>
                  <span>Prosek {fmtMoney(targetBand.mean, data.currency)}</span>
                  <span>Visoko {fmtMoney(targetBand.high, data.currency)}</span>
                </div>
                <div className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-1">
                  Sada: {fmtMoney(data.currentPrice, data.currency)}
                  {shortTermUpside != null ? ` (${fmtPct(shortTermUpside, 1)} do prosečne ciljne cene)` : ""}
                </div>
                <p className="text-[11px] text-zinc-400 mt-1 italic">Konsenzus ciljnih cena analitičara (Yahoo Finance) — nije naša procena vrednosti, već tuđe mišljenje o budućoj ceni.</p>
              </div>
            ) : (
              <p className="text-xs italic text-zinc-500 dark:text-zinc-400 mb-3">Nema dovoljno pokrivenosti analitičara (ciljne cene) za ovaj tiker.</p>
            )}
            {rangePosition != null && (
              <div className="mb-3">
                <div className="relative h-2 rounded-full bg-zinc-200 dark:bg-zinc-800">
                  <div className="absolute top-0 h-2 w-1 bg-blue-600" style={{ left: `${Math.min(100, Math.max(0, rangePosition))}%` }} />
                </div>
                <div className="flex justify-between text-[11px] text-zinc-500 dark:text-zinc-400 mt-1">
                  <span>52-ned. min {fmtMoney(data.fiftyTwoWeekLow, data.currency)}</span>
                  <span>({rangePosition.toFixed(0)}%)</span>
                  <span>52-ned. maks {fmtMoney(data.fiftyTwoWeekHigh, data.currency)}</span>
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-2 mb-3">
              <StatTile label="P/S" value={fmtRatio(priceToSales)} />
              <StatTile label="P/E" value={fmtRatio(data.peRatio)} />
              <StatTile label="P/B" value={fmtRatio(data.priceToBook)} />
              <StatTile label="P/FCF" value={fmtRatio(currentPFcf)} />
            </div>
            <PeHistoryChart rows={ownAvg?.peRows ?? []} currentPE={data.peRatio} avgPE={ownAvg?.peAvg ?? null} />
            <table className="w-full text-xs">
              <tbody>
                {multiplesTable.map((m) => (
                  <tr key={m.metric} className="border-t border-zinc-100 dark:border-zinc-800">
                    <td className="py-1 text-zinc-500 dark:text-zinc-400">{m.metric}</td>
                    <td className={`py-1 text-right font-medium ${TONE_COLORS[m.tone]}`}>{m.unit === "%" ? fmtPct(m.value, 1) : fmtRatio(m.value)}</td>
                  </tr>
                ))}
                <tr className="border-t border-zinc-100 dark:border-zinc-800">
                  <td className="py-1 text-zinc-500 dark:text-zinc-400">FCF prinos − bezrizična stopa ({(DEFAULT_ASSUMPTIONS.riskFreeRate * 100).toFixed(1)}%)</td>
                  <td className={`py-1 text-right font-medium ${toneClass(toneForSigned(fcfYieldPremium))}`}>{fmtPct(fcfYieldPremium, 1)}</td>
                </tr>
              </tbody>
            </table>
            <div
              className={`mt-2 text-xs font-semibold ${
                multiplesVerdict.verdict === "Izgleda jeftino" ? "text-emerald-600 dark:text-emerald-400" : multiplesVerdict.verdict === "Izgleda skupo" ? "text-red-600 dark:text-red-400" : "text-zinc-600 dark:text-zinc-400"
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
        <b>⚠ Ovo NIJE finansijski savet.</b> Sve ocene dolaze iz fiksnih, dokumentovanih pragova nad merljivim podacima — bez
        subjektivnih procena. Stavke koje finansijski izveštaji ne mere direktno (raspodela prihoda po segmentima, procena
        pretnje od disrupcije i sl.) su jasno označene kao takve, umesto da se izmišljaju. Altman Z-score je klasična formula
        za proizvodna preduzeća (manje pouzdana za banke i nekretnine), a reakcija cene na izveštaje je gruba aproksimacija jer
        Yahoo ne daje tačan datum objave rezultata, samo kraj fiskalnog kvartala. Samo američke i evropske akcije.
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
