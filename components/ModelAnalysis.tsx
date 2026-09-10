"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  computeDcf,
  computeGrahamNumber,
  computeRelativeValuation,
  estimateFcfCagr,
  estimateWacc,
  summarizeUpside,
  type Assumptions,
  type Fundamentals,
} from "@/lib/valuation";
import { isUsOrEuropeanMarket } from "@/lib/marketScope";
import {
  buildBullBear,
  buildFinalVerdict,
  buildFinancialBreakdown,
  rankRisks,
  runGrowthFilter,
  runValuationFilter,
  scoreGrowthPotential,
  scoreManagementQuality,
  scoreMoat,
  type DimensionSignal,
  type FilterCheck,
  type YearlyFinancials,
} from "@/lib/model";

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

interface ModelData {
  companyName: string;
  currency: string;
  currentPrice: number;
  fundamentals: Fundamentals;
  yearlyRows: YearlyFinancials[];
  grossMarginHistory: number[];
  peRatio: number | null;
  pegRatio: number | null;
  evToEbitda: number | null;
  priceToBook: number | null;
  returnOnEquity: number | null;
  operatingMargins: number | null;
  dividendYield: number | null;
  dividendPaidConsistently: boolean | null;
  debtToEquity: number | null;
  currentRatio: number | null;
  beta: number | null;
  revenueGrowthTtm: number | null;
  analystLongTermGrowth: number | null;
  targetMeanPrice: number | null;
  targetHighPrice: number | null;
  targetLowPrice: number | null;
  heldPercentInsiders: number | null;
  heldPercentInstitutions: number | null;
  insiderNetPercentShares: number | null;
  shortPercentOfFloat: number | null;
  marketCap: number | null;
}

async function fetchModelData(symbol: string): Promise<ModelData> {
  const res = await fetch(`/api/stock?symbol=${encodeURIComponent(symbol)}&type=valuation`, { cache: "no-store" });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  const result = data?.quoteSummary?.result?.[0];
  if (!result) throw new Error("Podaci nisu dostupni za ovaj tiker.");

  const price = result.price || {};
  const summaryDetail = result.summaryDetail || {};
  const keyStats = result.defaultKeyStatistics || {};
  const financialData = result.financialData || {};
  const assetProfile = result.assetProfile || {};
  const cashflowStatements = result.cashflowStatementHistory?.cashflowStatements || [];
  const incomeStatements = (result.incomeStatementHistory?.incomeStatementHistory || []).slice().reverse();
  const balanceSheets = (result.balanceSheetHistory?.balanceSheetStatements || []).slice().reverse();
  const earningsTrend = result.earningsTrend?.trend || [];
  const netSharePurchaseActivity = result.netSharePurchaseActivity || {};

  const country: string | null = assetProfile.country || null;
  const currency: string | null = price.currency || null;
  if (!isUsOrEuropeanMarket(country, currency)) {
    throw new Error(
      `Ovaj model je namenjen samo američkim i evropskim akcijama. Tiker ${symbol.toUpperCase()} izgleda da je sa drugog tržišta (zemlja: ${country || "nepoznato"}, valuta: ${currency || "nepoznato"}).`
    );
  }

  const currentPrice = price.regularMarketPrice?.raw ?? financialData.currentPrice?.raw;
  if (!currentPrice) throw new Error("Trenutna cena nije dostupna za ovaj tiker.");

  const fcfHistory: number[] = cashflowStatements
    .slice()
    .reverse()
    .map((s: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      const ocf = s.totalCashFromOperatingActivities?.raw;
      const capex = s.capitalExpenditures?.raw;
      if (ocf == null || capex == null) return null;
      return ocf + capex;
    })
    .filter((v: number | null): v is number => v != null);

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

  const yearlyRows: YearlyFinancials[] = incomeStatements.map((s: any, i: number) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    const bs = balanceSheets[i] || {};
    const cf = cashflowStatements.slice().reverse()[i] || {};
    const ocf = cf.totalCashFromOperatingActivities?.raw;
    const capex = cf.capitalExpenditures?.raw;
    return {
      label: s.endDate?.fmt ? s.endDate.fmt.slice(0, 4) : `Godina ${i + 1}`,
      revenue: s.totalRevenue?.raw ?? null,
      netIncome: s.netIncome?.raw ?? null,
      operatingIncome: s.operatingIncome?.raw ?? null,
      totalEquity: bs.totalStockholderEquity?.raw ?? null,
      totalDebt: (bs.shortLongTermDebt?.raw ?? 0) + (bs.longTermDebt?.raw ?? 0) || null,
      fcf: ocf != null && capex != null ? ocf + capex : null,
    };
  });

  const grossMarginHistory: number[] = incomeStatements
    .map((s: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      const gp = s.grossProfit?.raw;
      const rev = s.totalRevenue?.raw;
      if (gp == null || !rev) return null;
      return gp / rev;
    })
    .filter((v: number | null): v is number => v != null);

  const longTermTrend = earningsTrend.find((t: any) => t.period === "+5y"); // eslint-disable-line @typescript-eslint/no-explicit-any
  const analystLongTermGrowth = longTermTrend?.growth?.raw ?? null;

  return {
    companyName: fundamentals.companyName,
    currency: fundamentals.currency,
    currentPrice,
    fundamentals,
    yearlyRows,
    grossMarginHistory,
    peRatio: summaryDetail.trailingPE?.raw ?? null,
    pegRatio: keyStats.pegRatio?.raw ?? null,
    evToEbitda: keyStats.enterpriseToEbitda?.raw ?? null,
    priceToBook: keyStats.priceToBook?.raw ?? null,
    returnOnEquity: financialData.returnOnEquity?.raw ?? null,
    operatingMargins: financialData.operatingMargins?.raw ?? null,
    dividendYield: summaryDetail.dividendYield?.raw ?? null,
    dividendPaidConsistently: summaryDetail.dividendRate?.raw != null ? true : keyStats.dividendRate != null ? true : false,
    debtToEquity: financialData.debtToEquity?.raw ?? null,
    currentRatio: financialData.currentRatio?.raw ?? null,
    beta: keyStats.beta?.raw ?? null,
    revenueGrowthTtm: financialData.revenueGrowth?.raw ?? null,
    analystLongTermGrowth,
    targetMeanPrice: financialData.targetMeanPrice?.raw ?? null,
    targetHighPrice: financialData.targetHighPrice?.raw ?? null,
    targetLowPrice: financialData.targetLowPrice?.raw ?? null,
    heldPercentInsiders: keyStats.heldPercentInsiders?.raw ?? null,
    heldPercentInstitutions: keyStats.heldPercentInstitutions?.raw ?? null,
    insiderNetPercentShares: netSharePurchaseActivity.netPercentInsiderShares?.raw ?? null,
    shortPercentOfFloat: keyStats.shortPercentOfFloat?.raw ?? null,
    marketCap: price.marketCap?.raw ?? null,
  };
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
  const [data, setData] = useState<ModelData | null>(null);
  const [assumptions] = useState<Assumptions>(DEFAULT_ASSUMPTIONS);
  const searchParams = useSearchParams();

  async function runAnalysis(sym: string) {
    if (!sym) return;
    setLoading(true);
    setError("");
    setData(null);
    try {
      const d = await fetchModelData(sym);
      setData(d);
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
      // eslint-disable-next-line react-hooks/set-state-in-effect -- inicijalno popunjavanje iz URL parametra
      setTicker(sym);
      runAnalysis(sym);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await runAnalysis(ticker.trim().toUpperCase());
  }

  let content: React.ReactNode = null;

  if (data) {
    const f = data.fundamentals;
    const wacc = estimateWacc(f, assumptions);
    const suggestedGrowth = estimateFcfCagr(f.fcfHistory) ?? (f.revenueGrowth != null ? Math.max(-0.1, Math.min(0.3, f.revenueGrowth)) : assumptions.growthRateY1to5);
    const valuationAssumptions = { ...assumptions, growthRateY1to5: suggestedGrowth, targetPE: f.trailingPE ?? assumptions.targetPE };
    const dcf = computeDcf(f, valuationAssumptions, wacc);
    const graham = computeGrahamNumber(f);
    const relative = computeRelativeValuation(f, valuationAssumptions);
    const modelValues = [dcf.intrinsicValuePerShare, graham, relative].filter((v): v is number => v != null);
    const avgIntrinsic = modelValues.length ? modelValues.reduce((a, b) => a + b, 0) / modelValues.length : null;
    const longTermUpside = summarizeUpside(f.currentPrice, avgIntrinsic);
    const shortTermUpside = summarizeUpside(f.currentPrice, data.targetMeanPrice);

    const breakdown = buildFinancialBreakdown(data.yearlyRows);
    const revenueHistory = data.yearlyRows.map((r) => r.revenue).filter((v): v is number => v != null);
    const netIncomeHistory = data.yearlyRows.map((r) => r.netIncome).filter((v): v is number => v != null);
    const growthFilter = runGrowthFilter({ revenueHistory, netIncomeHistory, ttmRevenueGrowth: data.revenueGrowthTtm });
    const valuationFilter = runValuationFilter({
      peRatio: data.peRatio,
      pegRatio: data.pegRatio,
      evToEbitda: data.evToEbitda,
      priceToBook: data.priceToBook,
      returnOnEquity: data.returnOnEquity,
      dividendYield: data.dividendYield,
    });
    const moat = scoreMoat({
      grossMarginHistory: data.grossMarginHistory,
      operatingMargins: data.operatingMargins,
      returnOnInvestedCapitalProxy: data.returnOnEquity,
      wacc,
      marketCap: data.marketCap,
    });
    const growthPotential = scoreGrowthPotential({
      historicalRevenueCagr: breakdown.revenueCagr,
      analystLongTermGrowth: data.analystLongTermGrowth,
      revenueGrowthTtm: data.revenueGrowthTtm,
    });
    const risks = rankRisks({
      debtToEquity: data.debtToEquity,
      currentRatio: data.currentRatio,
      beta: data.beta,
      peRatio: data.peRatio,
      sectorPeMedian: null,
      analystDispersion:
        data.targetHighPrice != null && data.targetLowPrice != null && data.targetMeanPrice != null
          ? { high: data.targetHighPrice, low: data.targetLowPrice, mean: data.targetMeanPrice }
          : null,
      grossMarginTrend: data.grossMarginHistory,
    });
    const management = scoreManagementQuality({
      heldPercentInsiders: data.heldPercentInsiders,
      heldPercentInstitutions: data.heldPercentInstitutions,
      insiderNetPercentShares: data.insiderNetPercentShares,
      shortPercentOfFloat: data.shortPercentOfFloat,
      dividendPaidConsistently: data.dividendPaidConsistently,
    });

    const signals: DimensionSignal[] = [
      { label: "Rast prihoda i dobiti", positive: breakdown.verdict === "jača", detail: breakdown.detail },
      { label: "Kvantitativni skrining rasta", positive: growthFilter.totalApplicable > 0 && growthFilter.passCount >= growthFilter.totalApplicable / 2, detail: `${growthFilter.passCount}/${growthFilter.totalApplicable} kriterijuma zadovoljeno` },
      { label: "Valuacija", positive: valuationFilter.totalApplicable > 0 && valuationFilter.passCount >= valuationFilter.totalApplicable / 2 && !valuationFilter.pricedForPerfection, detail: `${valuationFilter.passCount}/${valuationFilter.totalApplicable} kriterijuma zadovoljeno` },
      { label: "Konkurentska prednost (proxy)", positive: moat.score >= 6, detail: `Ocena ${moat.score}/10` },
      { label: "Kvalitet menadžmenta (proxy)", positive: management.verdict === "izgleda pouzdano", detail: management.verdict },
      { label: "Najveći identifikovani rizik", positive: (risks[0]?.severity ?? 0) <= 2, detail: risks[0] ? `${risks[0].label} (${risks[0].detail})` : "Nema identifikovanih rizika." },
    ];
    const bullBear = buildBullBear(signals);

    const finalVerdict = buildFinalVerdict({
      shortTermUpside,
      longTermUpside,
      catalysts: [growthPotential.label + " (" + growthPotential.estimateRange + ")"],
      risks: risks.slice(0, 2).map((r) => r.label),
      pricedForPerfection: valuationFilter.pricedForPerfection,
    });

    content = (
      <div className="mt-6 space-y-4">
        <div className="border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/50 rounded-xl p-5">
          <div className="flex flex-wrap items-baseline gap-2 justify-between">
            <h2 className="text-xl font-bold">{data.companyName} ({ticker.toUpperCase()})</h2>
            <div className="text-lg font-bold">{fmtMoney(data.currentPrice, data.currency)}</div>
          </div>
        </div>

        <div className={`rounded-xl border-2 p-5 ${finalVerdict.verdict === "Kupovina" ? "border-emerald-400 dark:border-emerald-700" : finalVerdict.verdict === "Izbegavanje" ? "border-red-400 dark:border-red-700" : "border-zinc-300 dark:border-zinc-700"}`}>
          <div className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400 mb-1">Prompt 10 — Should I Buy This Stock? (finalna sinteza)</div>
          <div className="text-lg font-bold mb-1">{finalVerdict.verdict}</div>
          <div className="text-sm mb-2 flex gap-4 flex-wrap">
            <span>Kratkoročno (1 god.): <b>{finalVerdict.shortTermLabel}</b> ({fmtPct(shortTermUpside)})</span>
            <span>Dugoročno (5+ god.): <b>{finalVerdict.longTermLabel}</b> ({fmtPct(longTermUpside)})</span>
          </div>
          <p className="text-sm leading-relaxed">{finalVerdict.detail}</p>
        </div>

        <Section title="Prompt 2 — Deep Financial Breakdown (poslednjih do 5 god.)">
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
          <p className="mt-3 text-sm">Zaključak: kompanija izgleda <b>{breakdown.verdict}</b>. {breakdown.detail}</p>
        </Section>

        <Section title="Prompt 6 (post 1) — Growth Potential Analysis">
          <p className="text-sm"><b>{growthPotential.label}</b> — procenjeni raspon rasta: {growthPotential.estimateRange}.</p>
          <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-1">{growthPotential.detail}</p>
        </Section>

        <Section title="Prompt 2 (post 2) — The Growth Filter">
          <div>{growthFilter.checks.map(checkRow)}</div>
          <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">{growthFilter.passCount}/{growthFilter.totalApplicable} primenjivih kriterijuma zadovoljeno. Analiza samo — nije poziv na kupovinu ili prodaju.</p>
        </Section>

        <Section title="Prompt 6 (post 2) — The Valuation Filter">
          <div>{valuationFilter.checks.map(checkRow)}</div>
          <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">{valuationFilter.passCount}/{valuationFilter.totalApplicable} primenjivih kriterijuma zadovoljeno. Jeftino može značiti pokvareno, skupo može značiti kvalitet — ovo je samo disciplinski filter, ne presuda.</p>
        </Section>

        <Section title="Prompt 3 — Competitive Moat Analysis (objektivni proxy)">
          <p className="text-sm">Ocena: <b>{moat.score}/10</b></p>
          <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-1">{moat.detail}</p>
        </Section>

        <Section title="Prompt 5 — Risk Analysis (rangirano od najopasnijeg)">
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

        <Section title="Prompt 9 — Management Quality Analysis (objektivni proxy)">
          <p className="text-sm mb-2">Zaključak: <b>{management.verdict}</b></p>
          <ul className="list-disc pl-5 space-y-1 text-sm text-zinc-600 dark:text-zinc-400">
            {management.details.map((d, i) => (
              <li key={i}>{d}</li>
            ))}
          </ul>
        </Section>

        <Section title="Prompt 8 — Bull vs Bear Debate">
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
        analitičkih dimenzija (finansijski trend, rast, valuacija, konkurentska prednost, rizik, menadžment, bull/bear,
        i finalna sinteza) isključivo iz merljivih podataka.
      </div>

      <form onSubmit={handleSubmit} className="flex flex-wrap gap-2 items-end border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/50 rounded-xl p-4">
        <div className="flex-1 min-w-[160px]">
          <label className="block text-xs text-zinc-500 dark:text-zinc-400 mb-1">Ticker (US/EU)</label>
          <input
            type="text"
            value={ticker}
            onChange={(e) => setTicker(e.target.value)}
            placeholder="npr. AAPL, ASML.AS, SAP.DE..."
            className="w-full uppercase px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-transparent"
            required
          />
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
