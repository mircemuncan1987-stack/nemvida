"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  computeDcf,
  computeDdm,
  computeGrahamNumber,
  computeRelativeValuation,
  computeReverseDcfGrowth,
  estimateFcfCagr,
  estimateWacc,
  summarizeUpside,
  type Assumptions,
  type Fundamentals,
} from "@/lib/valuation";
import { combineVerdict, summarizeQualitative, type QualitativeInputs, type Verdict } from "@/lib/qualitative";

const DEFAULT_ASSUMPTIONS: Assumptions = {
  growthRateY1to5: 0.08,
  terminalGrowthRate: 0.025,
  riskFreeRate: 0.045,
  equityRiskPremium: 0.05,
  costOfDebt: 0.06,
  taxRate: 0.21,
  dividendGrowthRate: 0.03,
  targetPE: 18,
};

const fmtPct = (x: number | null | undefined, digits = 1) =>
  x === null || x === undefined || Number.isNaN(x) ? "—" : `${x >= 0 ? "+" : ""}${(x * 100).toFixed(digits)}%`;

const fmtMoney = (x: number | null | undefined, currency: string) =>
  x === null || x === undefined || Number.isNaN(x) ? "—" : `${x.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${currency}`;

interface CompanyProfile {
  summary: string | null;
  sector: string | null;
  industry: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  website: string | null;
  employees: number | null;
}

async function fetchValuationFundamentals(symbol: string): Promise<{ fundamentals: Fundamentals; qualitative: QualitativeInputs; profile: CompanyProfile }> {
  const res = await fetch(`/api/stock?symbol=${encodeURIComponent(symbol)}&type=valuation`, { cache: "no-store" });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  const result = data?.quoteSummary?.result?.[0];
  if (!result) throw new Error("Podaci nisu dostupni za ovaj tiker.");

  const price = result.price || {};
  const summaryDetail = result.summaryDetail || {};
  const keyStats = result.defaultKeyStatistics || {};
  const financialData = result.financialData || {};
  const cashflowStatements = result.cashflowStatementHistory?.cashflowStatements || [];
  const incomeStatements = result.incomeStatementHistory?.incomeStatementHistory || [];
  const recTrend = result.recommendationTrend?.trend?.[0] || null;
  const assetProfile = result.assetProfile || {};

  const fcfHistory: number[] = cashflowStatements
    .slice()
    .reverse()
    .map((s: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      const ocf = s.totalCashFromOperatingActivities?.raw;
      const capex = s.capitalExpenditures?.raw;
      if (ocf == null || capex == null) return null;
      return ocf + capex; // capex je već negativan u Yahoo podacima
    })
    .filter((v: number | null): v is number => v != null);

  const revenueHistory: number[] = incomeStatements
    .slice()
    .reverse()
    .map((s: any) => s.totalRevenue?.raw) // eslint-disable-line @typescript-eslint/no-explicit-any
    .filter((v: number | null | undefined): v is number => v != null);

  const currentPrice = price.regularMarketPrice?.raw ?? financialData.currentPrice?.raw;
  if (!currentPrice) throw new Error("Trenutna cena nije dostupna za ovaj tiker.");

  const fundamentals: Fundamentals = {
    companyName: price.longName || price.shortName || symbol,
    currency: price.currency || "USD",
    currentPrice,
    sharesOutstanding: keyStats.sharesOutstanding?.raw ?? null,
    trailingEps: keyStats.trailingEps?.raw ?? null,
    forwardEps: keyStats.forwardEps?.raw ?? null,
    bookValuePerShare: keyStats.bookValue?.raw ?? null,
    trailingPE: summaryDetail.trailingPE?.raw ?? null,
    forwardPE: summaryDetail.forwardPE?.raw ?? null,
    dividendRate: summaryDetail.dividendRate?.raw ?? null,
    beta: keyStats.beta?.raw ?? null,
    totalDebt: financialData.totalDebt?.raw ?? null,
    totalCash: financialData.totalCash?.raw ?? null,
    freeCashflowTtm: financialData.freeCashflow?.raw ?? null,
    fcfHistory,
    revenueGrowth: financialData.revenueGrowth?.raw ?? null,
  };

  const qualitative: QualitativeInputs = {
    currentRatio: financialData.currentRatio?.raw ?? null,
    quickRatio: financialData.quickRatio?.raw ?? null,
    debtToEquity: financialData.debtToEquity?.raw ?? null,
    returnOnEquity: financialData.returnOnEquity?.raw ?? null,
    returnOnAssets: financialData.returnOnAssets?.raw ?? null,
    grossMargins: financialData.grossMargins?.raw ?? null,
    operatingMargins: financialData.operatingMargins?.raw ?? null,
    profitMargins: financialData.profitMargins?.raw ?? null,
    revenueGrowth: financialData.revenueGrowth?.raw ?? null,
    earningsGrowth: financialData.earningsGrowth?.raw ?? null,
    revenueHistory,
    targetMeanPrice: financialData.targetMeanPrice?.raw ?? null,
    currentPrice,
    recommendation: recTrend
      ? {
          strongBuy: recTrend.strongBuy ?? 0,
          buy: recTrend.buy ?? 0,
          hold: recTrend.hold ?? 0,
          sell: recTrend.sell ?? 0,
          strongSell: recTrend.strongSell ?? 0,
        }
      : null,
  };

  const profile: CompanyProfile = {
    summary: assetProfile.longBusinessSummary || null,
    sector: assetProfile.sector || null,
    industry: assetProfile.industry || null,
    city: assetProfile.city || null,
    state: assetProfile.state || null,
    country: assetProfile.country || null,
    website: assetProfile.website || null,
    employees: assetProfile.fullTimeEmployees ?? null,
  };

  return { fundamentals, qualitative, profile };
}

export default function ValuationCalculator() {
  const [ticker, setTicker] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [fundamentals, setFundamentals] = useState<Fundamentals | null>(null);
  const [qualitativeInputs, setQualitativeInputs] = useState<QualitativeInputs | null>(null);
  const [profile, setProfile] = useState<CompanyProfile | null>(null);
  const [assumptions, setAssumptions] = useState<Assumptions>(DEFAULT_ASSUMPTIONS);
  const searchParams = useSearchParams();

  async function runAnalysis(sym: string) {
    if (!sym) return;
    setLoading(true);
    setError("");
    setFundamentals(null);
    setQualitativeInputs(null);
    setProfile(null);
    try {
      const { fundamentals: f, qualitative: q, profile: p } = await fetchValuationFundamentals(sym);
      setFundamentals(f);
      setQualitativeInputs(q);
      setProfile(p);
      const suggestedGrowth = estimateFcfCagr(f.fcfHistory);
      setAssumptions((prev) => ({
        ...prev,
        growthRateY1to5: suggestedGrowth ?? (f.revenueGrowth != null ? Math.max(-0.1, Math.min(0.3, f.revenueGrowth)) : prev.growthRateY1to5),
        targetPE: f.trailingPE ?? prev.targetPE,
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Greška pri preuzimanju podataka.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const fromUrl = searchParams.get("ticker");
    if (fromUrl) {
      const sym = fromUrl.trim().toUpperCase();
      // eslint-disable-next-line react-hooks/set-state-in-effect -- inicijalno popunjavanje iz URL parametra, jednokratno
      setTicker(sym);
      runAnalysis(sym);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await runAnalysis(ticker.trim().toUpperCase());
  }

  const wacc = fundamentals ? estimateWacc(fundamentals, assumptions) : null;
  const dcf = fundamentals ? computeDcf(fundamentals, assumptions, wacc ?? undefined) : null;
  const reverseGrowth = fundamentals ? computeReverseDcfGrowth(fundamentals, assumptions, wacc ?? undefined) : null;
  const graham = fundamentals ? computeGrahamNumber(fundamentals) : null;
  const ddm = fundamentals ? computeDdm(fundamentals, assumptions) : null;
  const relative = fundamentals ? computeRelativeValuation(fundamentals, assumptions) : null;

  const models = fundamentals
    ? [
        { label: "DCF (diskontovani novčani tok)", value: dcf?.intrinsicValuePerShare ?? null, note: dcf?.error },
        { label: "Graham Number", value: graham, note: graham ? undefined : "Zahteva pozitivan EPS i knjigovodstvenu vrednost." },
        { label: "Dividend Discount Model", value: ddm, note: ddm ? undefined : "Akcija ne isplaćuje dividendu ili je g ≥ cena kapitala." },
        { label: `Relativna procena (P/E × ${assumptions.targetPE.toFixed(1)})`, value: relative, note: relative ? undefined : "EPS nije dostupan." },
      ]
    : [];

  const validValues = models.map((m) => m.value).filter((v): v is number => v != null);
  const avgValue = validValues.length ? validValues.reduce((a, b) => a + b, 0) / validValues.length : null;
  const minValue = validValues.length ? Math.min(...validValues) : null;
  const maxValue = validValues.length ? Math.max(...validValues) : null;
  const avgUpside = fundamentals && avgValue != null ? summarizeUpside(fundamentals.currentPrice, avgValue) : null;

  const qualitativeSummary = qualitativeInputs ? summarizeQualitative(qualitativeInputs) : null;
  const verdict = qualitativeSummary ? combineVerdict(avgUpside, qualitativeSummary) : null;

  return (
    <div className="max-w-4xl mx-auto px-4 pb-16">
      <div className="mt-4 mb-5 text-sm leading-relaxed rounded-xl border border-amber-300/60 dark:border-amber-700/50 bg-amber-50 dark:bg-amber-900/15 text-amber-800 dark:text-amber-300 p-4">
        <b>⚠ Ovo NIJE finansijski savet.</b> Svi modeli zavise od pretpostavki koje uneseš (stopa rasta, diskontna
        stopa...) — mala promena pretpostavki menja rezultat drastično. Ovo je edukativni alat za razumevanje
        metodologije procene vrednosti, ne preporuka za kupovinu/prodaju. Uvek proveri fundamentalne podatke iz
        više izvora.
      </div>

      <form onSubmit={handleSubmit} className="flex flex-wrap gap-2 items-end border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/50 rounded-xl p-4">
        <div className="flex-1 min-w-[160px]">
          <label className="block text-xs text-zinc-500 dark:text-zinc-400 mb-1">Ticker</label>
          <input
            type="text"
            value={ticker}
            onChange={(e) => setTicker(e.target.value)}
            placeholder="npr. AAPL, KO, JNJ..."
            className="w-full uppercase px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-transparent"
            required
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          className="bg-blue-600 disabled:opacity-60 text-white font-semibold px-5 py-2 rounded-lg text-sm"
        >
          {loading ? "Učitavam..." : "Izračunaj"}
        </button>
      </form>
      {error && <div className="mt-3 text-sm text-red-600 dark:text-red-400">Greška: {error}</div>}

      {fundamentals && (
        <div className="mt-6">
          <div className="border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/50 rounded-xl p-5 mb-4">
            <div className="flex flex-wrap items-baseline gap-2 justify-between">
              <h2 className="text-xl font-bold">{fundamentals.companyName} ({ticker.toUpperCase()})</h2>
              <div className="text-lg font-bold">{fmtMoney(fundamentals.currentPrice, fundamentals.currency)}</div>
            </div>
          </div>

          {profile && <CompanyProfileCard profile={profile} />}

          {verdict && <VerdictBanner verdict={verdict} avgUpside={avgUpside} />}

          <AssumptionsPanel assumptions={assumptions} setAssumptions={setAssumptions} wacc={wacc} />

          <div className="border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/50 rounded-xl p-5 mb-4">
            <h3 className="text-sm font-semibold pb-2 mb-3 border-b border-zinc-200 dark:border-zinc-800">Procenjena vrednost po modelu</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr>
                    <th className="text-left text-xs uppercase text-zinc-500 dark:text-zinc-400 py-1.5 px-2 border-b border-zinc-200 dark:border-zinc-800">Model</th>
                    <th className="text-right text-xs uppercase text-zinc-500 dark:text-zinc-400 py-1.5 px-2 border-b border-zinc-200 dark:border-zinc-800">Procenjena vrednost</th>
                    <th className="text-right text-xs uppercase text-zinc-500 dark:text-zinc-400 py-1.5 px-2 border-b border-zinc-200 dark:border-zinc-800">Razlika od cene</th>
                  </tr>
                </thead>
                <tbody>
                  {models.map((m) => {
                    const upside = summarizeUpside(fundamentals.currentPrice, m.value);
                    return (
                      <tr key={m.label}>
                        <td className="py-1.5 px-2 border-b border-zinc-200 dark:border-zinc-800">{m.label}</td>
                        <td className="py-1.5 px-2 border-b border-zinc-200 dark:border-zinc-800 text-right tabular-nums">
                          {m.value != null ? fmtMoney(m.value, fundamentals.currency) : <span className="italic text-zinc-500">{m.note || "N/A"}</span>}
                        </td>
                        <td className={`py-1.5 px-2 border-b border-zinc-200 dark:border-zinc-800 text-right tabular-nums ${upside != null ? (upside >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400") : ""}`}>
                          {fmtPct(upside)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {avgValue != null && (
              <div className="mt-4 grid grid-cols-3 gap-3 text-center">
                <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-3">
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">Min procena</div>
                  <div className="font-bold">{fmtMoney(minValue, fundamentals.currency)}</div>
                </div>
                <div className="rounded-lg border border-blue-300 dark:border-blue-700 p-3 bg-blue-50 dark:bg-blue-900/15">
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">Prosek modela</div>
                  <div className="font-bold">{fmtMoney(avgValue, fundamentals.currency)}</div>
                  <div className={`text-xs ${summarizeUpside(fundamentals.currentPrice, avgValue)! >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                    {fmtPct(summarizeUpside(fundamentals.currentPrice, avgValue))}
                  </div>
                </div>
                <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-3">
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">Max procena</div>
                  <div className="font-bold">{fmtMoney(maxValue, fundamentals.currency)}</div>
                </div>
              </div>
            )}
          </div>

          <div className="border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/50 rounded-xl p-5 mb-4">
            <h3 className="text-sm font-semibold pb-2 mb-3 border-b border-zinc-200 dark:border-zinc-800">Reverse DCF — koji rast tržište &quot;očekuje&quot;</h3>
            {reverseGrowth != null ? (
              <p className="text-sm">
                Po trenutnoj ceni i tvojim pretpostavkama za diskontnu i terminalnu stopu, tržište implicitno
                očekuje godišnji rast slobodnog novčanog toka od otprilike{" "}
                <b className={reverseGrowth >= assumptions.growthRateY1to5 ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"}>
                  {fmtPct(reverseGrowth)}
                </b>{" "}
                narednih 5 godina. {reverseGrowth > 0.25 ? "Ovo je veoma optimistična pretpostavka — proveri da li je realno održiva." : ""}
              </p>
            ) : (
              <p className="text-sm italic text-zinc-500 dark:text-zinc-400">Nije moguće izračunati (nedostaje FCF, broj akcija, ili je van razumnog opsega rasta).</p>
            )}
          </div>

          {qualitativeSummary && <QualitativeSection summary={qualitativeSummary} />}

          <MethodologyNotes />
        </div>
      )}
    </div>
  );
}

function verdictColor(v: Verdict) {
  if (v === "pozitivno") return "text-emerald-600 dark:text-emerald-400";
  if (v === "negativno") return "text-red-600 dark:text-red-400";
  return "text-zinc-500 dark:text-zinc-400";
}

function verdictIcon(v: Verdict) {
  if (v === "pozitivno") return "▲";
  if (v === "negativno") return "▼";
  return "●";
}

function VerdictBanner({
  verdict,
  avgUpside,
}: {
  verdict: { label: string; detail: string };
  avgUpside: number | null;
}) {
  const tone = avgUpside == null ? "" : avgUpside > 0.05 ? "border-emerald-400 dark:border-emerald-700" : avgUpside < -0.05 ? "border-red-400 dark:border-red-700" : "border-zinc-300 dark:border-zinc-700";
  return (
    <div className={`rounded-xl border-2 ${tone} bg-white/70 dark:bg-zinc-900/50 p-5 mb-4`}>
      <div className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400 mb-1">Sud (kvantitativno + kvalitativno)</div>
      <div className="text-lg font-bold mb-2">{verdict.label}</div>
      <p className="text-sm leading-relaxed">{verdict.detail}</p>
    </div>
  );
}

function CompanyProfileCard({ profile }: { profile: CompanyProfile }) {
  const location = [profile.city, profile.state, profile.country].filter(Boolean).join(", ");
  return (
    <div className="border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/50 rounded-xl p-5 mb-4">
      <h3 className="text-sm font-semibold pb-2 mb-3 border-b border-zinc-200 dark:border-zinc-800">O kompaniji</h3>
      {profile.summary ? (
        <p className="text-sm leading-relaxed mb-3">{profile.summary}</p>
      ) : (
        <p className="text-sm italic text-zinc-500 dark:text-zinc-400 mb-3">Opis poslovanja nije dostupan za ovaj tiker.</p>
      )}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
        <div>
          <div className="text-xs text-zinc-500 dark:text-zinc-400">Sektor</div>
          <div>{profile.sector || "—"}</div>
        </div>
        <div>
          <div className="text-xs text-zinc-500 dark:text-zinc-400">Industrija</div>
          <div>{profile.industry || "—"}</div>
        </div>
        <div>
          <div className="text-xs text-zinc-500 dark:text-zinc-400">Sedište</div>
          <div>{location || "—"}</div>
        </div>
        <div>
          <div className="text-xs text-zinc-500 dark:text-zinc-400">Zaposleni</div>
          <div>{profile.employees != null ? profile.employees.toLocaleString("en-US") : "—"}</div>
        </div>
      </div>
      {profile.website && (
        <a href={profile.website} target="_blank" rel="noopener noreferrer" className="inline-block mt-3 text-sm text-blue-600 dark:text-blue-400 hover:underline">
          {profile.website}
        </a>
      )}
      <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
        Godina osnivanja nije dostupna u ovom izvoru podataka (Yahoo Finance je ne prikazuje) — nije prikazana da se
        ne bi nagađala.
      </p>
    </div>
  );
}

function QualitativeSection({ summary }: { summary: ReturnType<typeof summarizeQualitative> }) {
  return (
    <div className="border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/50 rounded-xl p-5 mb-4">
      <h3 className="text-sm font-semibold pb-2 mb-3 border-b border-zinc-200 dark:border-zinc-800">
        Objektivni kvalitativni pokazatelji — {summary.overallLabel}
      </h3>
      <div className="space-y-3">
        {summary.dimensions.map((d) => (
          <div key={d.label} className="flex items-start gap-3">
            <span className={`text-lg leading-none ${verdictColor(d.verdict)}`}>{verdictIcon(d.verdict)}</span>
            <div>
              <div className="text-sm font-semibold">{d.label}</div>
              <div className="text-sm text-zinc-600 dark:text-zinc-400">{d.detail}</div>
            </div>
          </div>
        ))}
      </div>
      <p className="mt-4 text-xs text-zinc-500 dark:text-zinc-400">
        Svaki pokazatelj se izračunava iz merljivih finansijskih podataka (marže, zaduženost, rast, konsenzus
        analitičara) prema fiksnim pragovima — namerno je isključena subjektivna procena (npr. kvalitet menadžmenta,
        snaga brenda) jer se ne može objektivno meriti.
      </p>
    </div>
  );
}

function AssumptionsPanel({
  assumptions,
  setAssumptions,
  wacc,
}: {
  assumptions: Assumptions;
  setAssumptions: (a: Assumptions) => void;
  wacc: number | null;
}) {
  const field = (
    key: keyof Assumptions,
    label: string,
    step: number,
    minVal: number,
    maxVal: number,
    isPercent = true
  ) => (
    <div>
      <label className="block text-xs text-zinc-500 dark:text-zinc-400 mb-1">{label}</label>
      <input
        type="number"
        step={step}
        min={minVal}
        max={maxVal}
        value={isPercent ? (assumptions[key] * 100).toFixed(2) : assumptions[key]}
        onChange={(e) => {
          const raw = parseFloat(e.target.value);
          if (Number.isNaN(raw)) return;
          setAssumptions({ ...assumptions, [key]: isPercent ? raw / 100 : raw });
        }}
        className="w-full px-2 py-1.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-transparent text-sm tabular-nums"
      />
    </div>
  );

  return (
    <div className="border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/50 rounded-xl p-5 mb-4">
      <h3 className="text-sm font-semibold pb-2 mb-3 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
        Pretpostavke (podesi po želji)
        {wacc != null && <span className="text-xs font-normal text-zinc-500 dark:text-zinc-400">Izračunati WACC: {(wacc * 100).toFixed(2)}%</span>}
      </h3>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {field("growthRateY1to5", "Rast FCF (god. 1-5), %", 0.5, -50, 100)}
        {field("terminalGrowthRate", "Terminalna stopa rasta, %", 0.1, 0, 5)}
        {field("riskFreeRate", "Bezrizična stopa, %", 0.1, 0, 15)}
        {field("equityRiskPremium", "Premija rizika tržišta, %", 0.1, 0, 15)}
        {field("costOfDebt", "Cena duga (kamata), %", 0.1, 0, 20)}
        {field("taxRate", "Poreska stopa, %", 0.5, 0, 50)}
        {field("dividendGrowthRate", "Rast dividende, %", 0.1, 0, 15)}
        {field("targetPE", "Ciljni P/E multiplikator", 0.5, 1, 60, false)}
      </div>
    </div>
  );
}

function MethodologyNotes() {
  return (
    <div className="border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/50 rounded-xl p-5 text-sm leading-relaxed">
      <h3 className="text-sm font-semibold pb-2 mb-3 border-b border-zinc-200 dark:border-zinc-800">Kako se ovo računa</h3>
      <ul className="list-disc pl-5 space-y-2">
        <li><b>DCF</b>: projektuje slobodan novčani tok (FCF) 5 godina uz zadatu stopu rasta, dodaje terminalnu vrednost (večna renta po terminalnoj stopi), sve diskontuje po WACC-u, oduzima neto dug, deli brojem akcija.</li>
        <li><b>WACC</b>: ponderisan prosek cene kapitala akcionara (CAPM: bezrizična stopa + beta × premija rizika) i cene duga (kamata umanjena za poresku uštedu), ponderisano tržišnom kapitalizacijom naspram duga.</li>
        <li><b>Graham Number</b>: √(22.5 × EPS × knjigovodstvena vrednost po akciji) — konzervativna formula Benjamina Grahama.</li>
        <li><b>Dividend Discount Model</b>: sledeća dividenda / (cena kapitala − stopa rasta dividende) — samo za akcije koje isplaćuju dividendu.</li>
        <li><b>Relativna procena</b>: očekivani EPS × ciljni P/E multiplikator (podrazumevano trenutni trailing P/E akcije, možeš promeniti).</li>
        <li><b>Reverse DCF</b>: rešava DCF jednačinu unazad — koja stopa rasta bi, uz iste pretpostavke za WACC i terminalnu stopu, opravdala trenutnu tržišnu cenu.</li>
        <li>Podrazumevana stopa rasta FCF-a se procenjuje iz istorijskog CAGR-a poslednjih dostupnih godina (ograničeno na -20% do 35% da se izbegnu ekstremne pretpostavke) — uvek je možeš ručno promeniti.</li>
      </ul>
    </div>
  );
}
