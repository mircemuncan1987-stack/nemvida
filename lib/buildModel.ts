// Deljena logika za "Sveobuhvatni model" — koristi je i pojedinačna analiza
// (/model) i skener indeksa (/lista), tako da je ocena precenjenosti/
// podcenjenosti i sud (kupovina/držanje/izbegavanje) svuda na sajtu
// zasnovan na istom modelu, a ne na dve različite metodologije.

import {
  computeDcf,
  computeDdm,
  computeLynchValuation,
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
  type FinalVerdict,
  type YearlyFinancials,
} from "@/lib/model";

export const DEFAULT_ASSUMPTIONS: Assumptions = {
  growthRateY1to5: 0.08,
  terminalGrowthRate: 0.025,
  riskFreeRate: 0.045,
  equityRiskPremium: 0.05,
  costOfDebt: 0.06,
  taxRate: 0.21,
  dividendGrowthRate: 0.03,
  targetPE: 18,
};

export interface ModelData {
  companyName: string;
  currency: string;
  currentPrice: number;
  fundamentals: Fundamentals;
  yearlyRows: YearlyFinancials[];
  grossMargin: number | null;
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function extractModelData(result: any, symbol: string): ModelData {
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

  const reversedCashflows = cashflowStatements.slice().reverse();
  const fcfHistory: number[] = reversedCashflows
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((s: any) => {
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

  // Statementi za prihod, bilans stanja i novčani tok ne moraju imati isti
  // broj perioda niti isti redosled — poravnavaju se po godini završetka
  // fiskalne godine (endDate), a ne po poziciji u nizu, da se izbegne tiho
  // pomeranje podataka između godina kad nizovi nisu iste dužine.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const byYear = (statements: any[]) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const map = new Map<string, any>();
    for (const s of statements) {
      const year = s.endDate?.fmt?.slice(0, 4);
      if (year) map.set(year, s);
    }
    return map;
  };
  const balanceByYear = byYear(balanceSheets);
  const cashflowByYear = byYear(reversedCashflows);

  const yearlyRows: YearlyFinancials[] = incomeStatements.map(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (s: any, i: number) => {
      const year = s.endDate?.fmt?.slice(0, 4) ?? null;
      const bs = (year && balanceByYear.get(year)) || {};
      const cf = (year && cashflowByYear.get(year)) || {};
      const ocf = cf.totalCashFromOperatingActivities?.raw;
      const capex = cf.capitalExpenditures?.raw;
      const shortDebt = bs.shortLongTermDebt?.raw;
      const longDebt = bs.longTermDebt?.raw;
      return {
        label: year || `Godina ${i + 1}`,
        revenue: s.totalRevenue?.raw ?? null,
        netIncome: s.netIncome?.raw ?? null,
        operatingIncome: s.operatingIncome?.raw ?? null,
        totalEquity: bs.totalStockholderEquity?.raw ?? null,
        totalDebt: shortDebt != null || longDebt != null ? (shortDebt ?? 0) + (longDebt ?? 0) : null,
        fcf: ocf != null && capex != null ? ocf + capex : null,
      };
    }
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const longTermTrend = earningsTrend.find((t: any) => t.period === "+5y");
  const analystLongTermGrowth = longTermTrend?.growth?.raw ?? null;

  return {
    companyName: fundamentals.companyName,
    currency: fundamentals.currency,
    currentPrice,
    fundamentals,
    yearlyRows,
    grossMargin: financialData.grossMargins?.raw ?? null,
    peRatio: summaryDetail.trailingPE?.raw ?? null,
    pegRatio: keyStats.pegRatio?.raw ?? null,
    evToEbitda: keyStats.enterpriseToEbitda?.raw ?? null,
    priceToBook: keyStats.priceToBook?.raw ?? null,
    returnOnEquity: financialData.returnOnEquity?.raw ?? null,
    operatingMargins: financialData.operatingMargins?.raw ?? null,
    dividendYield: summaryDetail.dividendYield?.raw ?? null,
    dividendPaidConsistently: summaryDetail.dividendRate?.raw != null,
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

export interface ComputedModel {
  data: ModelData;
  wacc: number;
  avgIntrinsicValue: number | null;
  lynchValue: number | null;
  shortTermUpside: number | null;
  valuationUpside: number | null;
  breakdown: ReturnType<typeof buildFinancialBreakdown>;
  growthFilter: ReturnType<typeof runGrowthFilter>;
  valuationFilter: ReturnType<typeof runValuationFilter>;
  moat: ReturnType<typeof scoreMoat>;
  growthPotential: ReturnType<typeof scoreGrowthPotential>;
  risks: ReturnType<typeof rankRisks>;
  management: ReturnType<typeof scoreManagementQuality>;
  bullBear: ReturnType<typeof buildBullBear>;
  finalVerdict: FinalVerdict;
}

export interface HistoricalPricePoint {
  timestamp: number; // unix sekunde
  close: number;
}

export interface HistoricalPeRow {
  year: string;
  pe: number | null;
}

// Aproksimacija: EPS po godini se računa kao neto dobit te godine podeljena
// TRENUTNIM brojem akcija u opticaju (istorijski broj akcija nije dostupan u
// ovom izvoru), a cena se uzima sa najbližeg dostupnog meseca oko kraja
// kalendarske godine (aproksimacija kraja fiskalne godine ako se ne
// poklapaju). Rezultat je procena, ne tačna knjigovodstvena vrednost.
export function computeHistoricalPE(
  yearlyRows: YearlyFinancials[],
  priceHistory: HistoricalPricePoint[],
  sharesOutstanding: number | null
): HistoricalPeRow[] {
  return yearlyRows.map((r) => {
    const yearNum = parseInt(r.label, 10);
    if (!sharesOutstanding || priceHistory.length === 0 || r.netIncome == null || r.netIncome <= 0 || Number.isNaN(yearNum)) {
      return { year: r.label, pe: null };
    }
    const eps = r.netIncome / sharesOutstanding;
    const targetTime = Date.UTC(yearNum, 11, 31) / 1000;
    let closest: HistoricalPricePoint | null = null;
    let closestDiff = Infinity;
    for (const p of priceHistory) {
      const diff = Math.abs(p.timestamp - targetTime);
      if (diff < closestDiff) {
        closestDiff = diff;
        closest = p;
      }
    }
    if (!closest) return { year: r.label, pe: null };
    return { year: r.label, pe: closest.close / eps };
  });
}

export function computeModel(data: ModelData, assumptions: Assumptions = DEFAULT_ASSUMPTIONS): ComputedModel {
  const f = data.fundamentals;
  const wacc = estimateWacc(f, assumptions);
  const suggestedGrowth = estimateFcfCagr(f.fcfHistory) ?? (f.revenueGrowth != null ? Math.max(-0.1, Math.min(0.3, f.revenueGrowth)) : assumptions.growthRateY1to5);
  const valuationAssumptions = { ...assumptions, growthRateY1to5: suggestedGrowth, targetPE: f.trailingPE ?? assumptions.targetPE };
  const dcf = computeDcf(f, valuationAssumptions, wacc);
  const ddm = computeDdm(f, valuationAssumptions);
  const relative = computeRelativeValuation(f, valuationAssumptions);
  const lynchValue = computeLynchValuation(f, valuationAssumptions.growthRateY1to5 * 100, (data.dividendYield ?? 0) * 100);
  const modelValues = [dcf.intrinsicValuePerShare, ddm, relative, lynchValue].filter((v): v is number => v != null);
  const avgIntrinsicValue = modelValues.length ? modelValues.reduce((a, b) => a + b, 0) / modelValues.length : null;
  const valuationUpside = summarizeUpside(f.currentPrice, avgIntrinsicValue);
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
    grossMargin: data.grossMargin,
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
  });
  const management = scoreManagementQuality({
    heldPercentInsiders: data.heldPercentInsiders,
    heldPercentInstitutions: data.heldPercentInstitutions,
    insiderNetPercentShares: data.insiderNetPercentShares,
    shortPercentOfFloat: data.shortPercentOfFloat,
    dividendPaidConsistently: data.dividendPaidConsistently,
  });

  const signals: DimensionSignal[] = [
    { label: "Finansijski trend", positive: breakdown.verdict === "jača", detail: breakdown.detail },
    ...growthFilter.checks
      .filter((c) => c.pass != null)
      .map((c): DimensionSignal => ({ label: `Filter rasta — ${c.label}`, positive: c.pass as boolean, detail: c.detail })),
    ...valuationFilter.checks
      .filter((c) => c.pass != null)
      .map((c): DimensionSignal => ({ label: `Filter valuacije — ${c.label}`, positive: c.pass as boolean, detail: c.detail })),
    { label: "Konkurentska prednost (proxy)", positive: moat.score >= 6, detail: `Ocena ${moat.score}/10 — ${moat.detail}` },
    { label: "Kvalitet menadžmenta (proxy)", positive: management.verdict === "izgleda pouzdano", detail: management.details.filter((d) => !d.startsWith("Napomena")).join(" ") },
    ...risks.slice(0, 3).map((r): DimensionSignal => ({ label: `Rizik — ${r.label}`, positive: r.severity <= 2, detail: r.detail })),
  ];
  const bullBear = buildBullBear(signals);

  const finalVerdict = buildFinalVerdict({
    shortTermUpside,
    growthTier: growthPotential.tier,
    growthLabel: growthPotential.label,
    growthEstimateRange: growthPotential.estimateRange,
    pegRatio: data.pegRatio,
    evToEbitda: data.evToEbitda,
    topRiskDetail: risks[0] ? `${risks[0].label} — ${risks[0].detail}` : null,
    pricedForPerfection: valuationFilter.pricedForPerfection,
  });

  return { data, wacc, avgIntrinsicValue, lynchValue, shortTermUpside, valuationUpside, breakdown, growthFilter, valuationFilter, moat, growthPotential, risks, management, bullBear, finalVerdict };
}
