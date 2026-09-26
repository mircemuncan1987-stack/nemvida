// Deljena logika za "Sveobuhvatni model" — koristi je i pojedinačna analiza
// (/model) i skener indeksa (/lista), tako da je ocena precenjenosti/
// podcenjenosti i sud (kupovina/držanje/izbegavanje) svuda na sajtu
// zasnovan na istom modelu, a ne na dve različite metodologije.

import {
  computeDcf,
  computeDdm,
  computeFcfYield,
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
  getSectorPeMedian,
  identifyRedFlags,
  rankRisks,
  rateFundamentals,
  runGrowthFilter,
  runValuationFilter,
  scoreGrowthPotential,
  scoreManagementQuality,
  scoreMoat,
  buildMoatNarrative,
  type FilterCheck,
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
  revenueTtm: number | null;
  exchangeName: string | null;
  earningsBeats: { beat: boolean; surprisePercent: number | null; date: number | null }[] | null;
  businessSummary: string | null;
  sector: string | null;
  industry: string | null;
  country: string | null;
  city: string | null;
  website: string | null;
  employees: number | null;
  fiftyTwoWeekLow: number | null;
  fiftyTwoWeekHigh: number | null;
  payoutRatio: number | null;
  nextEarningsDate: number | null; // unix sekunde
  recommendation: {
    strongBuy: number;
    buy: number;
    hold: number;
    sell: number;
    strongSell: number;
  } | null;
  // Za Altman Z-score proxy — samo poslednja dostupna godina (dovoljno za
  // trenutni "snapshot" rizika, ne treba istorija).
  totalAssets: number | null;
  totalLiabilities: number | null;
  totalCurrentAssets: number | null;
  totalCurrentLiabilities: number | null;
  retainedEarnings: number | null;
  latestDepreciation: number | null; // za EBITDA proxy (operatingIncome + depreciation)
  latestStockBasedCompensation: number | null;
  quarterlyRevenue: number[]; // hronološki rastuće, koliko god kvartala Yahoo vrati (obično poslednja 4)
  quarterlyNetIncome: number[];
  sharesOutstandingHistory: { year: string; shares: number }[]; // hronološki rastuće
  insiderTransactions: { date: number | null; filerName: string | null; type: "kupovina" | "prodaja" | "ostalo"; shares: number | null }[] | null;
}

function classifyInsiderTransaction(text: string | undefined | null): "kupovina" | "prodaja" | "ostalo" {
  if (!text) return "ostalo";
  const t = text.toLowerCase();
  if (t.includes("sale")) return "prodaja";
  if (t.includes("purchase") || t.includes("buy")) return "kupovina";
  return "ostalo";
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function extractModelData(fullData: any, symbol: string): ModelData {
  const result = fullData?.quoteSummary?.result?.[0];
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
  const recTrend = result.recommendationTrend?.trend?.[0] || null;
  const calendarEvents = result.calendarEvents || {};
  const earningsHistory = result.earningsHistory?.history || [];
  const quarterlyIncomeStatements = (result.incomeStatementHistoryQuarterly?.incomeStatementHistory || []).slice().reverse();
  const insiderTransactionsRaw = result.insiderTransactions?.transactions || [];

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

  // Yahoo-ov noviji "fundamentals-timeseries" endpoint je pouzdaniji izvor za
  // istorijski FCF/dug/kapital od starih balanceSheetHistory/
  // cashflowStatementHistory modula (koji su kod mnogih tikera prazni) — ako
  // je dostupan, koristi se kao primarni izvor, uz stare module kao rezervu.
  const timeseriesByYear = (typeKey: string): Map<string, number> => {
    const map = new Map<string, number>();
    const entries = fullData?.timeseries?.result || [];
    for (const entry of entries) {
      if (entry?.meta?.type?.[0] !== typeKey) continue;
      const series = entry[typeKey];
      if (!Array.isArray(series)) continue;
      for (const point of series) {
        const year = point?.asOfDate?.slice(0, 4);
        const value = point?.reportedValue?.raw;
        if (year && value != null) map.set(year, value);
      }
    }
    return map;
  };
  const fcfByYear = timeseriesByYear("annualFreeCashFlow");
  const debtByYear = timeseriesByYear("annualTotalDebt");
  const equityByYear = timeseriesByYear("annualStockholdersEquity");
  const sharesByYear = timeseriesByYear("annualOrdinarySharesNumber");
  const sbcByYear = timeseriesByYear("annualStockBasedCompensation");
  const sharesOutstandingHistory = Array.from(sharesByYear.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([year, shares]) => ({ year, shares }));
  const latestSbcYear = Array.from(sbcByYear.keys()).sort().pop();
  const latestStockBasedCompensation = latestSbcYear != null ? sbcByYear.get(latestSbcYear) ?? null : null;

  // Poslednja dostupna godina bilansa stanja — balanceSheets je gore
  // reverse-ovan u hronološki rastući redosled, pa je poslednji element
  // najnovija godina (ne prvi).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const latestBalanceSheet: any = balanceSheets[balanceSheets.length - 1] || {};
  const latestDepreciation = reversedCashflows[reversedCashflows.length - 1]?.depreciation?.raw ?? null;

  const quarterlyRevenue: number[] = quarterlyIncomeStatements
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((s: any) => s.totalRevenue?.raw)
    .filter((v: number | undefined): v is number => v != null);
  const quarterlyNetIncome: number[] = quarterlyIncomeStatements
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((s: any) => s.netIncome?.raw)
    .filter((v: number | undefined): v is number => v != null);

  const insiderTransactions =
    insiderTransactionsRaw.length > 0
      ? insiderTransactionsRaw
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .map((t: any) => ({
            date: t.startDate?.raw ?? null,
            filerName: t.filerName ?? null,
            type: classifyInsiderTransaction(t.transactionText),
            shares: t.shares?.raw ?? null,
          }))
          .slice(0, 8)
      : null;

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
      const legacyDebt = shortDebt != null || longDebt != null ? (shortDebt ?? 0) + (longDebt ?? 0) : null;
      const legacyFcf = ocf != null && capex != null ? ocf + capex : null;
      return {
        label: year || `Godina ${i + 1}`,
        revenue: s.totalRevenue?.raw ?? null,
        netIncome: s.netIncome?.raw ?? null,
        operatingIncome: s.operatingIncome?.raw ?? null,
        totalEquity: (year && equityByYear.get(year)) ?? bs.totalStockholderEquity?.raw ?? null,
        totalDebt: (year && debtByYear.get(year)) ?? legacyDebt,
        fcf: (year && fcfByYear.get(year)) ?? legacyFcf,
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
    revenueTtm: financialData.totalRevenue?.raw ?? null,
    exchangeName: price.exchangeName ?? price.fullExchangeName ?? null,
    earningsBeats: earningsHistory.length
      ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
        earningsHistory.map((h: any) => ({
          beat: (h.epsDifference?.raw ?? 0) > 0,
          surprisePercent: h.surprisePercent?.raw != null ? h.surprisePercent.raw * 100 : null,
          date: h.quarter?.raw ?? null,
        }))
      : null,
    businessSummary: assetProfile.longBusinessSummary ?? null,
    sector: assetProfile.sector ?? null,
    industry: assetProfile.industry ?? null,
    country: assetProfile.country ?? null,
    city: assetProfile.city ?? null,
    website: assetProfile.website ?? null,
    employees: assetProfile.fullTimeEmployees ?? null,
    fiftyTwoWeekLow: summaryDetail.fiftyTwoWeekLow?.raw ?? null,
    fiftyTwoWeekHigh: summaryDetail.fiftyTwoWeekHigh?.raw ?? null,
    payoutRatio: summaryDetail.payoutRatio?.raw ?? null,
    nextEarningsDate: calendarEvents.earnings?.earningsDate?.[0]?.raw ?? null,
    recommendation: recTrend
      ? {
          strongBuy: recTrend.strongBuy ?? 0,
          buy: recTrend.buy ?? 0,
          hold: recTrend.hold ?? 0,
          sell: recTrend.sell ?? 0,
          strongSell: recTrend.strongSell ?? 0,
        }
      : null,
    totalAssets: latestBalanceSheet.totalAssets?.raw ?? null,
    totalLiabilities: latestBalanceSheet.totalLiab?.raw ?? null,
    totalCurrentAssets: latestBalanceSheet.totalCurrentAssets?.raw ?? null,
    totalCurrentLiabilities: latestBalanceSheet.totalCurrentLiabilities?.raw ?? null,
    retainedEarnings: latestBalanceSheet.retainedEarnings?.raw ?? null,
    latestDepreciation,
    latestStockBasedCompensation,
    quarterlyRevenue,
    quarterlyNetIncome,
    sharesOutstandingHistory,
    insiderTransactions,
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
  moatNarrative: ReturnType<typeof buildMoatNarrative>;
  growthPotential: ReturnType<typeof scoreGrowthPotential>;
  risks: ReturnType<typeof rankRisks>;
  management: ReturnType<typeof scoreManagementQuality>;
  bullBear: ReturnType<typeof buildBullBear>;
  finalVerdict: FinalVerdict;
  fundamentalsRating: ReturnType<typeof rateFundamentals>;
  redFlags: string[];
  fcfStability: ReturnType<typeof computeFcfStability>;
  consecutiveRevenueQuarters: number | null;
  consecutiveEarningsQuarters: number | null;
  qualityOfEarnings: QualityOfEarnings;
  altmanZScore: AltmanZScore;
  shareCountTrend: ShareCountTrend;
  shareholderYield: number | null;
  netDebtToEbitda: number | null;
  sbcPercent: number | null;
}

export interface HistoricalPricePoint {
  timestamp: number; // unix sekunde
  close: number;
}

export interface HistoricalMultipleRow {
  year: string;
  multiple: number | null;
}

// Aproksimacija: "po akciji" vrednost za svaku godinu se računa kao
// odgovarajuća stavka te godine (neto dobit, FCF...) podeljena TRENUTNIM
// brojem akcija u opticaju (istorijski broj akcija nije dostupan u ovom
// izvoru), a cena se uzima sa najbližeg dostupnog meseca oko kraja
// kalendarske godine (aproksimacija kraja fiskalne godine ako se ne
// poklapaju). Rezultat je procena, ne tačna knjigovodstvena vrednost.
function computeHistoricalMultiple(
  yearlyRows: YearlyFinancials[],
  priceHistory: HistoricalPricePoint[],
  sharesOutstanding: number | null,
  metric: (row: YearlyFinancials) => number | null
): HistoricalMultipleRow[] {
  return yearlyRows.map((r) => {
    const yearNum = parseInt(r.label, 10);
    const value = metric(r);
    if (!sharesOutstanding || priceHistory.length === 0 || value == null || value <= 0 || Number.isNaN(yearNum)) {
      return { year: r.label, multiple: null };
    }
    const perShare = value / sharesOutstanding;
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
    // Ako je najbliža dostupna cena udaljena više od ~90 dana od kraja te
    // fiskalne godine (npr. istorija cena ne seže toliko unazad — spinoff,
    // nedavni IPO), bolje je vratiti null nego tiho upariti pogrešnu godinu
    // sa pogrešnom cenom — isti princip kao findClosestPoint niže u fajlu.
    if (!closest || closestDiff > 90 * 86400) return { year: r.label, multiple: null };
    return { year: r.label, multiple: closest.close / perShare };
  });
}

export function computeHistoricalPE(
  yearlyRows: YearlyFinancials[],
  priceHistory: HistoricalPricePoint[],
  sharesOutstanding: number | null
): HistoricalMultipleRow[] {
  return computeHistoricalMultiple(yearlyRows, priceHistory, sharesOutstanding, (r) => r.netIncome);
}

export function computeHistoricalPFcf(
  yearlyRows: YearlyFinancials[],
  priceHistory: HistoricalPricePoint[],
  sharesOutstanding: number | null
): HistoricalMultipleRow[] {
  return computeHistoricalMultiple(yearlyRows, priceHistory, sharesOutstanding, (r) => r.fcf);
}

// PEG = P/E te godine podeljen godišnjim rastom neto dobiti (g/g, u
// procentnim poenima) u odnosu na prethodnu godinu. Nedefinisan (null) kad
// prethodna godina nedostaje ili je rast dobiti negativan/nula — PEG tada
// nema smislenu interpretaciju.
export function computeHistoricalPEG(
  yearlyRows: YearlyFinancials[],
  priceHistory: HistoricalPricePoint[],
  sharesOutstanding: number | null
): HistoricalMultipleRow[] {
  const peRows = computeHistoricalPE(yearlyRows, priceHistory, sharesOutstanding);
  return yearlyRows.map((r, i) => {
    const pe = peRows[i]?.multiple;
    const prev = yearlyRows[i - 1];
    if (pe == null || !prev || prev.netIncome == null || prev.netIncome <= 0 || r.netIncome == null || r.netIncome <= 0) {
      return { year: r.label, multiple: null };
    }
    const growthPercent = ((r.netIncome - prev.netIncome) / prev.netIncome) * 100;
    if (growthPercent <= 0) return { year: r.label, multiple: null };
    return { year: r.label, multiple: pe / growthPercent };
  });
}

// ---------- CAGR na više horizonta (1/3/5 godina), za prikaz kao "1G/3G/5G" umesto jednog proseka za sav dostupan period ----------

export interface GrowthHorizons {
  oneYear: number | null;
  threeYear: number | null;
  fiveYear: number | null;
}

function cagrBasic(first: number, last: number, years: number): number | null {
  if (first <= 0 || last <= 0 || years <= 0) return null;
  return Math.pow(last / first, 1 / years) - 1;
}

// yearlyRows je hronološki (najstarije prvo) — vidi extractModelData. Yahoo-ov
// incomeStatementHistory obično pokriva samo poslednje 4 fiskalne godine, pa
// "5G" često ostaje "—" (nedovoljno istorije), što je tačnije nego da se
// prikaže procena zasnovana na manje godina nego što je naznačeno.
export function computeGrowthHorizons(rows: YearlyFinancials[], selector: (r: YearlyFinancials) => number | null): GrowthHorizons {
  const n = rows.length;
  const at = (yearsAgo: number): number | null => (n - 1 - yearsAgo >= 0 ? selector(rows[n - 1 - yearsAgo]) : null);
  const latest = at(0);
  const horizon = (years: number): number | null => {
    const past = at(years);
    if (latest == null || past == null) return null;
    return cagrBasic(past, latest, years);
  };
  return { oneYear: horizon(1), threeYear: horizon(3), fiveYear: horizon(5) };
}

export interface DebtEquityRow {
  year: string;
  ratio: number | null;
}

export function computeDebtEquityHistory(yearlyRows: YearlyFinancials[]): DebtEquityRow[] {
  return yearlyRows.map((r) => ({
    year: r.label,
    ratio: r.totalDebt != null && r.totalEquity != null && r.totalEquity !== 0 ? r.totalDebt / r.totalEquity : null,
  }));
}

// ---------- Stabilnost slobodnog novčanog toka ----------
//
// Koeficijent varijacije (standardna devijacija / prosek) kroz dostupne
// godišnje izveštaje — koliko je FCF predvidljiv iz godine u godinu, ne
// samo kolika mu je trenutna marža ili nivo. Kad je bar jedna godina bila
// negativna, CV kao odnos gubi smisao (deljenje sa prosekom blizu nule ili
// promena znaka čine broj varljivim — ista vrsta greške koju smo ranije
// ispravljali kod P/E i P/FCF) — takav slučaj se direktno označava kao
// "Nestabilan" bez računanja CV broja.
export interface FcfStability {
  coefficientOfVariation: number | null;
  years: number;
  label: "Stabilan" | "Umereno stabilan" | "Nestabilan" | "Nedovoljno podataka";
  detail: string;
}

export function computeFcfStability(yearlyRows: YearlyFinancials[]): FcfStability {
  const fcfs = yearlyRows.map((r) => r.fcf).filter((v): v is number => v != null);
  if (fcfs.length < 3) {
    return {
      coefficientOfVariation: null,
      years: fcfs.length,
      label: "Nedovoljno podataka",
      detail: "Potrebno je bar 3 godine slobodnog novčanog toka da bi procena stabilnosti imala smisla.",
    };
  }

  const hasNegativeYear = fcfs.some((v) => v < 0);
  const mean = fcfs.reduce((a, b) => a + b, 0) / fcfs.length;
  const variance = fcfs.reduce((sum, v) => sum + (v - mean) ** 2, 0) / fcfs.length;
  const stdDev = Math.sqrt(variance);
  const cv = mean > 0 ? stdDev / mean : null;

  if (hasNegativeYear) {
    return {
      coefficientOfVariation: cv,
      years: fcfs.length,
      label: "Nestabilan",
      detail: `Bar jedna od poslednjih ${fcfs.length} godina imala je negativan slobodan novčani tok — bez obzira na koeficijent varijacije, promena znaka sama po sebi znači nepredvidljivu gotovinu.`,
    };
  }
  if (cv == null) {
    return { coefficientOfVariation: null, years: fcfs.length, label: "Nedovoljno podataka", detail: "Prosečan FCF je nula ili nedostaje — koeficijent varijacije nije izračunljiv." };
  }

  const label: FcfStability["label"] = cv < 0.3 ? "Stabilan" : cv < 0.6 ? "Umereno stabilan" : "Nestabilan";
  const interpretation =
    label === "Stabilan"
      ? "godišnji FCF se drži blizu proseka — predvidljiva gotovina."
      : label === "Umereno stabilan"
        ? "primetna su kolebanja iz godine u godinu, ali bez promene znaka."
        : "velika kolebanja iz godine u godinu — teško je osloniti se na prosek kao vodič za budućnost.";
  return {
    coefficientOfVariation: cv,
    years: fcfs.length,
    label,
    detail: `Koeficijent varijacije ${cv.toFixed(2)} kroz ${fcfs.length} godina (standardna devijacija/prosek) — ${interpretation}`,
  };
}

export type MultipleTrend = "rastao" | "opadao" | "stabilan";

export interface MultipleTrendAnalysis {
  peAvg: number | null;
  pFcfAvg: number | null;
  peTrend: MultipleTrend | null;
  pFcfTrend: MultipleTrend | null;
}

function describeMultipleTrend(values: number[]): { avg: number; trend: MultipleTrend } | null {
  if (values.length < 2) return null;
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  const first = values[0];
  const last = values[values.length - 1];
  const trend: MultipleTrend = last > first * 1.1 ? "rastao" : last < first * 0.9 ? "opadao" : "stabilan";
  return { avg, trend };
}

// Poredi trenutne multiplikatore (P/E, P/FCF) sa sopstvenom istorijom
// kompanije poslednjih godina — da li je akcija trenutno skuplja ili
// jeftinija nego što je bila u odnosu na sopstvenu zaradu/novčani tok, a ne
// samo u odnosu na generičke pragove. Vraća strukturovane podatke (prosek +
// smer trenda) koje koristi buildMultiplesTable za jedinstvenu tabelu, umesto
// da svaki poziv sam sastavlja tekst.
export function analyzeHistoricalMultiples(
  historicalPE: HistoricalMultipleRow[],
  historicalPFcf: HistoricalMultipleRow[]
): MultipleTrendAnalysis {
  const peValues = historicalPE.map((r) => r.multiple).filter((v): v is number => v != null);
  const pFcfValues = historicalPFcf.map((r) => r.multiple).filter((v): v is number => v != null);

  const pe = describeMultipleTrend(peValues);
  const pFcf = describeMultipleTrend(pFcfValues);

  return { peAvg: pe?.avg ?? null, pFcfAvg: pFcf?.avg ?? null, peTrend: pe?.trend ?? null, pFcfTrend: pFcf?.trend ?? null };
}

// TTM slobodan novčani tok (financialData.freeCashflow sa Yahoo-a) često
// nedostaje — posebno kod evropskih tikera i finansijskih institucija (banke,
// osiguravajuća društva), gde Yahoo tu vrednost jednostavno ne popunjava.
// Kad nedostaje, koristi se FCF poslednje raspoložive fiskalne godine (isti
// izvor kao redovi u tabeli finansijskog trenda) kao razumna zamena —
// umesto da FCF prinos i P/FCF ostanu prazni za veliki deo tikera.
export function resolveFcfForYield(data: ModelData): number | null {
  if (data.fundamentals.freeCashflowTtm != null) return data.fundamentals.freeCashflowTtm;
  const rows = data.yearlyRows;
  return rows.length ? rows[rows.length - 1].fcf : null;
}

// ---------- Jedinstvena tabela multiplikatora (sistematizovano, sa objašnjenjem i ocenom svakog reda) ----------

export type MultipleReadingTone = "povoljno" | "neutralno" | "skupo" | "nedovoljno podataka";

export interface MultipleTableRow {
  metric: string;
  value: number | null;
  unit: "×" | "%";
  ownAverage: number | null;
  sectorBenchmark: number | null;
  trend: MultipleTrend | null;
  meaning: string;
  reading: string;
  tone: MultipleReadingTone;
}

function toneFromRatio(ratio: number | null): MultipleReadingTone {
  if (ratio == null) return "nedovoljno podataka";
  if (ratio < 0.85) return "povoljno";
  if (ratio > 1.15) return "skupo";
  return "neutralno";
}

function readingVsBenchmark(value: number | null, benchmark: number | null, benchmarkLabel: string, unit: "×" | "%"): { reading: string; tone: MultipleReadingTone } {
  if (value == null || benchmark == null || benchmark === 0) return { reading: "Nedovoljno podataka za poređenje.", tone: "nedovoljno podataka" };
  const ratio = value / benchmark;
  const tone = toneFromRatio(ratio);
  const diffPct = Math.abs(ratio - 1) * 100;
  const fmtVal = (v: number) => (unit === "%" ? `${(v * 100).toFixed(1)}%` : `${v.toFixed(1)}×`);
  if (tone === "povoljno") return { reading: `${diffPct.toFixed(0)}% ispod ${benchmarkLabel} (${fmtVal(benchmark)}) — jeftinije.`, tone };
  if (tone === "skupo") return { reading: `${diffPct.toFixed(0)}% iznad ${benchmarkLabel} (${fmtVal(benchmark)}) — skuplje.`, tone };
  return { reading: `Blizu ${benchmarkLabel} (${fmtVal(benchmark)}).`, tone };
}

// Poređenje samo sa sopstvenom istorijom (ili sektorom) ume da bude
// varljivo u OBA smera kad je referentna vrednost sama po sebi neobična:
// - akcija ispadne "povoljna" samo zato što je sopstvena istorija/sektor bila
//   JOŠ skuplja (npr. P/FCF od 128× kod kompanije čiji je sopstveni prosek
//   150×) — bez apsolutnog praga ovo je prošlo neopaženo za NVDA;
// - ili obrnuto: akcija ispadne "skupa" samo zato što je iznad sopstvene
//   (neobično niske) istorije, iako je apsolutno gledano jeftina (npr. P/E 10×
//   naspram sopstvenog proseka od 6× u depresiranom ciklusu).
// Zato apsolutni prag ima poslednju reč u OBA pravca: iznad gornje granice je
// UVEK "skupo", ispod donje granice je UVEK "povoljno", bez obzira šta kaže
// relativno poređenje. Samo kad vrednost padne IZMEĐU granica (nije ni
// očigledno jeftina ni očigledno skupa u apsolutnom smislu) koristi se
// relativno poređenje kao finija ocena.
function combineWithAbsoluteFloor(
  relative: { reading: string; tone: MultipleReadingTone },
  value: number | null,
  absoluteCheapBelow: number,
  absoluteExpensiveAbove: number,
  unit: "×" | "%"
): { reading: string; tone: MultipleReadingTone } {
  if (value == null) return relative;
  const fmtVal = (v: number) => (unit === "%" ? `${(v * 100).toFixed(1)}%` : `${v.toFixed(1)}×`);
  const prefix = relative.tone === "nedovoljno podataka" ? "" : `${relative.reading} `;
  if (value > absoluteExpensiveAbove && relative.tone !== "skupo") {
    return { reading: `${prefix}Iznad ${fmtVal(absoluteExpensiveAbove)} se smatra skupim bez obzira na istoriju ili sektor.`, tone: "skupo" };
  }
  if (value < absoluteCheapBelow && relative.tone !== "povoljno") {
    return { reading: `${prefix}Ispod ${fmtVal(absoluteCheapBelow)} se smatra povoljnim bez obzira na istoriju ili sektor.`, tone: "povoljno" };
  }
  return relative;
}

export function buildMultiplesTable(inputs: {
  peRatio: number | null;
  pegRatio: number | null;
  evToEbitda: number | null;
  currentPFcf: number | null;
  freeCashflowTtm: number | null;
  marketCap: number | null;
  ownHistoricalPeAvg: number | null;
  ownHistoricalPFcfAvg: number | null;
  peTrend: MultipleTrend | null;
  pFcfTrend: MultipleTrend | null;
  sectorPeMedian: number | null;
  sector: string | null;
}): MultipleTableRow[] {
  const rows: MultipleTableRow[] = [];
  const sectorLabel = `medijane sektora${inputs.sector ? ` (${inputs.sector})` : ""}`;

  // P/E — prvo poređenje sa sektorom (relevantnije za "da li je skupo u odnosu na slične kompanije"), a ako sektor nije poznat, sa sopstvenom istorijom.
  // Apsolutni prag (15×/40×) sprečava da P/E ispadne "povoljan" samo zato što
  // je sopstvena istorija ili sektor bila i sama preskupa.
  {
    const benchmark = inputs.sectorPeMedian ?? inputs.ownHistoricalPeAvg;
    const benchmarkLabel = inputs.sectorPeMedian != null ? sectorLabel : "sopstvenog istorijskog proseka";
    const { reading, tone } = combineWithAbsoluteFloor(readingVsBenchmark(inputs.peRatio, benchmark, benchmarkLabel, "×"), inputs.peRatio, 15, 40, "×");
    rows.push({
      metric: "P/E (cena/zarada)",
      value: inputs.peRatio,
      unit: "×",
      ownAverage: inputs.ownHistoricalPeAvg,
      sectorBenchmark: inputs.sectorPeMedian,
      trend: inputs.peTrend,
      meaning: "Koliko se plaća za svaku jedinicu godišnje neto dobiti.",
      reading,
      tone,
    });
  }

  // PEG — fiksni pragovi (isti kao u filteru valuacije): <0.5 vrlo jeftino, 0.5-2.0 u skladu sa rastom, >2.0 skupo.
  {
    const v = inputs.pegRatio;
    const tone: MultipleReadingTone = v == null ? "nedovoljno podataka" : v < 0.5 ? "povoljno" : v > 2.0 ? "skupo" : "neutralno";
    rows.push({
      metric: "PEG",
      value: v,
      unit: "×",
      ownAverage: null,
      sectorBenchmark: null,
      trend: null,
      meaning: "P/E podeljen procenjenom godišnjom stopom rasta zarade — da li cena prati rast.",
      reading: v == null ? "Nije dostupno." : v < 0.5 ? "Vrlo jeftino u odnosu na rast." : v > 2.0 ? "Skupo u odnosu na rast." : "U skladu sa rastom (poželjan raspon 0,5–2,0).",
      tone,
    });
  }

  // EV/EBITDA — fiksni pragovi: <15 razumno, 15-30 umereno povišeno (uobičajeno za kvalitetne kompanije koje brzo rastu), >30 uračunava skoro savršeno izvršenje.
  {
    const v = inputs.evToEbitda;
    const tone: MultipleReadingTone = v == null ? "nedovoljno podataka" : v < 15 ? "povoljno" : v > 30 ? "skupo" : "neutralno";
    rows.push({
      metric: "EV/EBITDA",
      value: v,
      unit: "×",
      ownAverage: null,
      sectorBenchmark: null,
      trend: null,
      meaning: "Vrednost kompanije (tržišna kapitalizacija + dug − gotovina) podeljena operativnom zaradom (EBITDA).",
      reading: v == null ? "Nije dostupno." : v < 15 ? "Razumna cena za operativnu zaradu." : v > 30 ? "Uračunava skoro savršeno izvršenje." : "Umereno povišeno — uobičajeno za kvalitetne kompanije sa bržim rastom.",
      tone,
    });
  }

  // P/FCF — poređenje samo sa sopstvenom istorijom (nema sektorske medijane za ovaj pokazatelj).
  // Isti apsolutni prag (15×/40×) kao kod P/E — bez njega je ranije NVDA-i
  // (P/FCF ~128×) ispadalo "povoljno" samo zato što joj je i sopstvena
  // istorija bila slično preskupa, što je zbunjujuće i pogrešno kao zaključak.
  {
    const { reading, tone } = combineWithAbsoluteFloor(
      readingVsBenchmark(inputs.currentPFcf, inputs.ownHistoricalPFcfAvg, "sopstvenog istorijskog proseka", "×"),
      inputs.currentPFcf,
      15,
      40,
      "×"
    );
    rows.push({
      metric: "P/FCF (cena/slobodan novčani tok)",
      value: inputs.currentPFcf,
      unit: "×",
      ownAverage: inputs.ownHistoricalPFcfAvg,
      sectorBenchmark: null,
      trend: inputs.pFcfTrend,
      meaning: "Cena akcije podeljena slobodnim novčanim tokom po akciji.",
      reading,
      tone,
    });
  }

  // FCF prinos — obrnuto od P/FCF, izraženo kao prinos (poput dividendnog prinosa): koliko gotovine kompanija godišnje generiše po uloženom novcu.
  // Pragovi kalibrisani prema realnoj raspodeli na tržištu (prosek tržišta je
  // otprilike 3-4%; kvalitetne kompanije koje brzo rastu često imaju niži
  // prinos jer ulažu gotovinu nazad u rast, ne zato što su nužno "skupe") —
  // raniji pragovi (8%/4%) su bili nerealno visoki i skoro svaku kompaniju
  // gurali u "skupo", bez obzira na stvarnu cenu.
  {
    const v = computeFcfYield(inputs.freeCashflowTtm, inputs.marketCap);
    const tone: MultipleReadingTone = v == null ? "nedovoljno podataka" : v < 0 ? "skupo" : v >= 0.06 ? "povoljno" : v >= 0.025 ? "neutralno" : "skupo";
    rows.push({
      metric: "FCF prinos",
      value: v,
      unit: "%",
      ownAverage: null,
      sectorBenchmark: null,
      trend: null,
      meaning: "Slobodan novčani tok (TTM) u odnosu na tržišnu kapitalizaciju — koliko gotovine kompanija generiše za svaki uloženi dinar cene.",
      reading:
        v == null
          ? "Nije dostupno."
          : v < 0
            ? "Negativno — kompanija trenutno troši više gotovine nego što generiše."
            : v >= 0.06
              ? "Visok prinos — generiše mnogo gotovine u odnosu na cenu."
              : v >= 0.025
                ? "Prosečan prinos, u skladu sa tržištem."
                : "Nizak prinos — ili je cena visoka u odnosu na gotovinu, ili kompanija ulaže gotovo sav novčani tok nazad u rast.",
      tone,
    });
  }

  return rows;
}

// Objedinjena 1-2 rečenice: šta PEG, P/E (naspram sopstvenog proseka),
// P/FCF (naspram sopstvenog proseka) i Dug/kapital zajedno govore o ceni
// akcije — ne samo pojedinačni pokazatelji odvojeno.
export function synthesizeValuationMultiples(
  pegRatio: number | null,
  currentPE: number | null,
  peAvg: number | null,
  currentPFcf: number | null,
  pFcfAvg: number | null,
  debtToEquity: number | null,
  sectorPeMedian: number | null,
  sector: string | null
): string {
  const readings: string[] = [];

  if (pegRatio != null) {
    const label = pegRatio < 0.5 ? "vrlo jeftina u odnosu na rast zarade" : pegRatio <= 2.0 ? "u skladu sa rastom zarade" : "skupa u odnosu na rast zarade";
    readings.push(`PEG od ${pegRatio.toFixed(2)} ukazuje da je cena ${label}`);
  }
  if (currentPE != null && peAvg != null && peAvg !== 0) {
    const diff = (currentPE / peAvg - 1) * 100;
    const label = diff > 15 ? `iznad sopstvenog proseka za ${diff.toFixed(0)}%` : diff < -15 ? `ispod sopstvenog proseka za ${Math.abs(diff).toFixed(0)}%` : "blizu sopstvenog proseka";
    readings.push(`P/E od ${currentPE.toFixed(1)}× je ${label}`);
  }
  if (currentPFcf != null && pFcfAvg != null && pFcfAvg !== 0) {
    const diff = (currentPFcf / pFcfAvg - 1) * 100;
    const label = diff > 15 ? `iznad proseka za ${diff.toFixed(0)}%` : diff < -15 ? `ispod proseka za ${Math.abs(diff).toFixed(0)}%` : "blizu proseka";
    readings.push(`P/FCF od ${currentPFcf.toFixed(1)}× je ${label}`);
  }

  const sentence1 = readings.length ? `${readings.join(", ")}.` : "";

  let sentence2 = "";
  if (debtToEquity != null) {
    const label = debtToEquity > 1.5 ? "relativno visoku zaduženost u odnosu na kapital" : debtToEquity > 0.6 ? "umerenu zaduženost" : "nisku zaduženost";
    sentence2 = `Dug/kapital od ${debtToEquity.toFixed(2)} ukazuje na ${label}.`;
  }

  let sentence3 = "";
  if (currentPE != null && sectorPeMedian != null) {
    const diff = (currentPE / sectorPeMedian - 1) * 100;
    const label = diff > 15 ? `iznad medijane sektora za ${diff.toFixed(0)}%` : diff < -15 ? `ispod medijane sektora za ${Math.abs(diff).toFixed(0)}%` : "blizu medijane sektora";
    sentence3 = `U odnosu na sektor${sector ? ` (${sector})` : ""}, P/E od ${currentPE.toFixed(1)}× je ${label} (medijana ${sectorPeMedian.toFixed(0)}×).`;
  }

  return [sentence1, sentence2, sentence3].filter(Boolean).join(" ") || "Nema dovoljno podataka o multiplikatorima za objedinjenu sintezu.";
}

// ---------- "Da li je akcija skupa?" — jednostavan zbir, bez reverse-engineering-a rasta ----------
//
// Prethodna verzija je iz trenutnih multiplikatora "unazad" računala koliki
// bi rast zarade bio potreban da se P/E vrati na normalu (reverse-DCF stil
// rasuđivanja) — matematički tačno, ali previše apstraktno za brz pregled.
// Ova verzija radi ono što bi uradio iskusan hobi investitor rukom: prebroji
// koliko pokazatelja iz tabele iznad čita "povoljno" naspram "skupo" i to
// jednostavno saopšti, bez procene budućeg rasta.

export interface MultiplesVerdict {
  verdict: "Izgleda jeftino" | "Izgleda skupo" | "Mešovito — nema jasnog signala" | "Nedovoljno podataka";
  summary: string;
}

export function summarizeMultiplesTable(rows: MultipleTableRow[]): MultiplesVerdict {
  const favorable = rows.filter((r) => r.tone === "povoljno").length;
  const expensive = rows.filter((r) => r.tone === "skupo").length;
  const known = rows.filter((r) => r.tone !== "nedovoljno podataka").length;

  if (known === 0) {
    return { verdict: "Nedovoljno podataka", summary: "Nema dovoljno podataka o multiplikatorima za zaključak." };
  }
  if (favorable > expensive) {
    return {
      verdict: "Izgleda jeftino",
      summary: `${favorable} od ${known} pokazatelja iznad čita "povoljno" (jeftinije od sopstvene istorije ili sektora), a samo ${expensive} čita "skupo".`,
    };
  }
  if (expensive > favorable) {
    return {
      verdict: "Izgleda skupo",
      summary: `${expensive} od ${known} pokazatelja iznad čita "skupo" (skuplje od sopstvene istorije ili sektora), a samo ${favorable} čita "povoljno".`,
    };
  }
  return {
    verdict: "Mešovito — nema jasnog signala",
    summary: `Pokazatelji su podeljeni (${favorable} povoljno, ${expensive} skupo) — nema jasnog signala da je akcija jeftina ili skupa.`,
  };
}

// ---------- Poređenje ukupnog prinosa sa SPY (S&P 500) na 3/5/10/20 godina ----------

export interface BenchmarkComparisonRow {
  years: number;
  stockReturn: number | null;
  benchmarkReturn: number | null;
  outperformance: number | null; // stockReturn - benchmarkReturn
  verdict: "Nadmašuje SPY" | "Ispod SPY" | "Nedovoljno podataka";
}

function findClosestPoint(points: HistoricalPricePoint[], targetTimestamp: number, toleranceDays: number): HistoricalPricePoint | null {
  let closest: HistoricalPricePoint | null = null;
  let closestDiff = Infinity;
  for (const p of points) {
    const diff = Math.abs(p.timestamp - targetTimestamp);
    if (diff < closestDiff) {
      closestDiff = diff;
      closest = p;
    }
  }
  if (!closest || closestDiff > toleranceDays * 86400) return null;
  return closest;
}

// Ukupan prinos (uz pretpostavku da su cene iz istorije prilagođene
// dividendama/podelama akcija — "adjusted close") za dati broj godina unazad
// od trenutka "now". Vraća null kad istorija ne seže dovoljno unazad (npr.
// kompanija je izašla na berzu pre manje od N godina) — bolje ne prikazati
// broj nego prikazati pogrešnu procenu.
export function computeTotalReturn(points: HistoricalPricePoint[], years: number, nowSeconds: number): number | null {
  if (points.length < 2) return null;
  const latest = points[points.length - 1];
  const targetTs = nowSeconds - years * 365.25 * 86400;
  const oldest = findClosestPoint(points, targetTs, 120);
  if (!oldest || oldest.close <= 0) return null;
  return latest.close / oldest.close - 1;
}

// Ukupan prinos od fiksnog datuma (npr. datum otvaranja portfelja) do danas —
// varijanta computeTotalReturn koja ne računa unazad "N godina" nego uzima
// tačan početni trenutak.
export function computeReturnSince(points: HistoricalPricePoint[], startSeconds: number, nowSeconds: number): number | null {
  if (points.length < 2) return null;
  const latest = points[points.length - 1];
  if (latest.timestamp < nowSeconds - 30 * 86400) return null; // istorija je zastarela više od mesec dana
  const start = findClosestPoint(points, startSeconds, 60);
  if (!start || start.close <= 0) return null;
  return latest.close / start.close - 1;
}

export function compareToBenchmark(
  stockPoints: HistoricalPricePoint[],
  benchmarkPoints: HistoricalPricePoint[],
  nowSeconds: number,
  horizons: number[] = [3, 5, 10, 20]
): BenchmarkComparisonRow[] {
  return horizons.map((years) => {
    const stockReturn = computeTotalReturn(stockPoints, years, nowSeconds);
    const benchmarkReturn = computeTotalReturn(benchmarkPoints, years, nowSeconds);
    if (stockReturn == null || benchmarkReturn == null) {
      return { years, stockReturn, benchmarkReturn, outperformance: null, verdict: "Nedovoljno podataka" };
    }
    const outperformance = stockReturn - benchmarkReturn;
    return { years, stockReturn, benchmarkReturn, outperformance, verdict: outperformance > 0 ? "Nadmašuje SPY" : "Ispod SPY" };
  });
}

// ---------- Sažete ocene 1-5 za prikaz kao "kartica na jednoj strani" (vidi /pregled) ----------
//
// Nije novi model — samo diskretna preslikavanja (1-5) već izračunatih,
// dokumentovanih rezultata iz computeModel (moat.score, growthPotential.tier,
// management.verdict, rizik, multiplesVerdict) da bi se moglo prikazati kao
// kompaktna traka ocena, kao na uzoru koji je korisnik poslao. Ne uvodi nijedan
// nov subjektivan sud — samo drugačiji prikaz istih pravila.

export interface DashboardScore {
  score: number | null; // 1-5, veće je bolje
  label: string;
}

export interface MoatDirectionScore extends DashboardScore {
  direction: "širi se" | "stabilan" | "sužava se" | "nepoznato";
}

export interface DashboardScores {
  business: DashboardScore;
  moat: DashboardScore;
  moatDirection: MoatDirectionScore;
  growth: DashboardScore;
  management: DashboardScore;
  risk: DashboardScore;
  valuation: DashboardScore;
  composite: number | null;
}

function clamp15(n: number): number {
  return Math.max(1, Math.min(5, Math.round(n)));
}

// Pravac konkurentske prednosti: trend operativne marže kroz dostupne
// godišnje izveštaje (operatingIncome/revenue) — jedino merljivo
// približenje "širenja/sužavanja jaza" iz finansijskih izveštaja, bez
// pripovedanja o brendu ili tržišnoj poziciji. Deljeno između
// buildDashboardScores (za /pregled) i computeModel (za obrazloženje moat
// ocene) da se isti pravac ne računa na dva mesta sa mogućnošću da se
// razmimoiđe.
function computeMoatMarginTrend(yearlyRows: YearlyFinancials[]): MoatDirectionScore["direction"] {
  const margins = yearlyRows
    .map((r) => (r.revenue && r.operatingIncome != null && r.revenue !== 0 ? r.operatingIncome / r.revenue : null))
    .filter((v): v is number => v != null);
  if (margins.length < 2) return "nepoznato";
  const first = margins[0];
  const last = margins[margins.length - 1];
  return last > first + 0.02 ? "širi se" : last < first - 0.02 ? "sužava se" : "stabilan";
}

export function buildDashboardScores(
  model: ComputedModel,
  qualityChecks: FilterCheck[],
  multiplesVerdict: MultiplesVerdict
): DashboardScores {
  const { moat, growthPotential, management, risks, data } = model;

  const applicable = qualityChecks.filter((c) => c.pass != null);
  const business: DashboardScore = applicable.length
    ? { score: clamp15(1 + (applicable.filter((c) => c.pass).length / applicable.length) * 4), label: `${applicable.filter((c) => c.pass).length}/${applicable.length} provera zadovoljeno` }
    : { score: null, label: "Nedovoljno podataka" };

  const moatScore: DashboardScore = {
    score: clamp15(moat.score / 2),
    label: moat.score >= 6 ? "Širok jaz" : moat.score <= 3 ? "Slab jaz" : "Umeren jaz",
  };

  const direction = computeMoatMarginTrend(data.yearlyRows);
  const moatDirection: MoatDirectionScore = {
    score: direction === "širi se" ? 5 : direction === "stabilan" ? 3 : direction === "sužava se" ? 1 : null,
    label: direction === "nepoznato" ? "Nedovoljno godišnjih izveštaja" : `Operativna marža ${direction}`,
    direction,
  };

  const growth: DashboardScore = {
    score:
      growthPotential.tier === "visok" ? 5 : growthPotential.tier === "umeren" ? 4 : growthPotential.tier === "nizak" ? 2 : growthPotential.tier === "upitan" ? 1 : null,
    label: growthPotential.label,
  };

  const managementScore: DashboardScore = {
    score: management.verdict === "izgleda pouzdano" ? 5 : management.verdict === "mešovito" ? 3 : management.verdict === "izgleda rizično" ? 1 : null,
    label: management.verdict === "nedovoljno podataka" ? "Nedovoljno podataka" : management.verdict,
  };

  const maxSeverity = risks[0]?.severity ?? null;
  const riskScore: DashboardScore = {
    score: maxSeverity != null ? clamp15(6 - maxSeverity) : null,
    label: maxSeverity != null ? (maxSeverity <= 2 ? "Nizak rizik" : maxSeverity === 3 ? "Umeren rizik" : "Visok rizik") : "Nedovoljno podataka",
  };

  const valuationScore: DashboardScore = {
    score:
      multiplesVerdict.verdict === "Izgleda jeftino" ? 5 : multiplesVerdict.verdict === "Mešovito — nema jasnog signala" ? 3 : multiplesVerdict.verdict === "Izgleda skupo" ? 1 : null,
    label: multiplesVerdict.verdict,
  };

  const scores = [business.score, moatScore.score, growth.score, managementScore.score, riskScore.score, valuationScore.score].filter(
    (v): v is number => v != null
  );
  const composite = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;

  return { business, moat: moatScore, moatDirection, growth, management: managementScore, risk: riskScore, valuation: valuationScore, composite };
}

// Zajednički put do ocena sa /pregled (uključujući kompozitni skor) — koriste
// ga i /pregled i /lista, da kompozitni skor bude tačno isti broj na obe
// stranice, računat istom funkcijom.
export function computeOwnHistoricalAverages(model: ComputedModel, monthlyPriceHistory: HistoricalPricePoint[]) {
  const shares = model.data.fundamentals.sharesOutstanding;
  const peRows = computeHistoricalPE(model.breakdown.rows, monthlyPriceHistory, shares);
  const pFcfRows = computeHistoricalPFcf(model.breakdown.rows, monthlyPriceHistory, shares);
  return { ...analyzeHistoricalMultiples(peRows, pFcfRows), peRows, pFcfRows };
}

export function computeOverviewScores(
  model: ComputedModel,
  ownAvg: ReturnType<typeof analyzeHistoricalMultiples> | null,
  fallbackFcf: number | null
) {
  const { data, moat, growthFilter } = model;
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
    ownHistoricalPeAvg: ownAvg?.peAvg ?? null,
    ownHistoricalPFcfAvg: ownAvg?.pFcfAvg ?? null,
    peTrend: ownAvg?.peTrend ?? null,
    pFcfTrend: ownAvg?.pFcfTrend ?? null,
    sectorPeMedian,
    sector: data.sector,
  });
  const multiplesVerdict = summarizeMultiplesTable(multiplesTable);

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
  const competitivePositionCheck: FilterCheck = {
    label: "Dominantna konkurentska pozicija (moat proxy 6+/10)",
    pass: moat.score >= 6 ? true : moat.score <= 3 ? false : null,
    detail: `Moat proxy skor ${moat.score}/10 (marže i prinos na kapital naspram cene kapitala).`,
  };
  const qualityChecks = [growthFilter.checks[0], pricingPowerCheck, recessionCheck, competitivePositionCheck].filter((c): c is FilterCheck => !!c);
  const scores = buildDashboardScores(model, qualityChecks, multiplesVerdict);

  return { resolvedFcf, currentPFcf, sectorPeMedian, multiplesTable, multiplesVerdict, qualityChecks, scores };
}

// ---------- Faza poslovnog ciklusa (1-5) ----------
//
// Aproksimacija petostepenog okvira (osnivanje → hiper-rast → operativna
// poluga → povraćaj kapitala → opadanje) iz fiksnih, dokumentovanih pragova
// nad merljivim podacima (rast prihoda, operativna marža, isplata
// dividende) — ne iz subjektivne procene "gde je kompanija u svom životnom
// ciklusu", jer ta ocena obično zahteva kvalitativni uvid koji finansijski
// izveštaji sami po sebi ne daju. Kad rast nije poznat, faza se ne pogađa.
export interface BusinessPhase {
  phase: 1 | 2 | 3 | 4 | 5 | null;
  label: string;
  detail: string;
}

// Vidljiva definicija svih 5 faza (isti princip kao VERDICT_RULES u
// lib/model.ts) — UI prikazuje CEO ovu tabelu sa istaknutim redom, umesto da
// korisnik vidi samo jednu rečenicu za trenutnu kompaniju bez konteksta šta
// znače ostale faze i zašto baš ova nije primenjena.
export interface BusinessPhaseDefinition {
  phase: 1 | 2 | 3 | 4 | 5;
  name: string;
  criterion: string;
  meaning: string;
}

export const BUSINESS_PHASE_DEFINITIONS: BusinessPhaseDefinition[] = [
  {
    phase: 1,
    name: "Osnivanje",
    criterion: "Operativna marža je negativna (bez obzira na rast prihoda)",
    meaning: "Poslovni model još nije dokazao da može profitabilno da posluje na operativnom nivou — prioritet je rast korisničke baze, ne profit.",
  },
  {
    phase: 2,
    name: "Hiper-rast",
    criterion: "Pozitivna operativna marža i rast prihoda preko 20% godišnje",
    meaning: "Kompanija brzo osvaja tržišni udeo; tipično reinvestira veći deo gotovine nazad u rast umesto da je vraća akcionarima.",
  },
  {
    phase: 3,
    name: "Operativna poluga",
    criterion: "Rast prihoda između 0% i 20% godišnje (bez doslednih dividendi)",
    meaning: "Poslovanje skalira — marže obično rastu brže od prihoda kako se fiksni troškovi razblažuju na veću bazu prihoda.",
  },
  {
    phase: 4,
    name: "Povraćaj kapitala",
    criterion: "Spor rast prihoda (0–5% godišnje) uz doslednu isplatu dividende",
    meaning: "Zrelo poslovanje sa ograničenim prostorom za dalji rast — kapital se vraća akcionarima (dividenda) umesto da se reinvestira.",
  },
  {
    phase: 5,
    name: "Opadanje",
    criterion: "Rast prihoda je nula ili negativan, bez doslednih dividendi",
    meaning: "Prihodi stagniraju ili opadaju bez znaka da se kapital sistematski vraća akcionarima — najrizičnija faza za ulaganje u rast.",
  },
];

export function classifyBusinessPhase(inputs: {
  revenueGrowthTtm: number | null;
  revenueCagr: number | null;
  operatingMargins: number | null;
  dividendPaidConsistently: boolean | null;
}): BusinessPhase {
  const growth = inputs.revenueGrowthTtm ?? inputs.revenueCagr;
  const growthSource = inputs.revenueGrowthTtm != null ? "rast prihoda u poslednjih 12 meseci" : "istorijski CAGR prihoda";

  if (inputs.operatingMargins != null && inputs.operatingMargins < 0) {
    return {
      phase: 1,
      label: "1 · Osnivanje",
      detail: `Operativna marža je negativna (${(inputs.operatingMargins * 100).toFixed(1)}%) — poslovanje trenutno gubi novac na samom jezgru delatnosti, ne samo zbog jednokratnih troškova. Dok se to ne promeni, rast prihoda sam po sebi ne dokazuje održiv poslovni model.`,
    };
  }
  if (growth == null) {
    return { phase: null, label: "Nepoznato", detail: "Nedovoljno podataka o rastu prihoda (ni g/g ni istorijski CAGR) za procenu faze." };
  }
  if (growth > 0.2) {
    return {
      phase: 2,
      label: "2 · Hiper-rast",
      detail: `${growthSource[0].toUpperCase()}${growthSource.slice(1)} je ${(growth * 100).toFixed(1)}% — iznad praga od 20% koji ovde deli "brzo osvajanje tržišta" od običnog skaliranja. Ovakav rast obično znači da se gotovina agresivno reinvestira, pa dividenda ili visok FCF prinos nisu očekivani u ovoj fazi.`,
    };
  }
  if (growth > 0.05) {
    return {
      phase: 3,
      label: "3 · Operativna poluga",
      detail: `${growthSource[0].toUpperCase()}${growthSource.slice(1)} je ${(growth * 100).toFixed(1)}% — umereno (između 5% i 20%), tipično za kompaniju koja već ima uspostavljeno tržište i sad skalira postojeće poslovanje umesto da ga tek gradi.`,
    };
  }
  if (inputs.dividendPaidConsistently) {
    return {
      phase: 4,
      label: "4 · Povraćaj kapitala",
      detail: `${growthSource[0].toUpperCase()}${growthSource.slice(1)} je spor (${(growth * 100).toFixed(1)}%), ali kompanija dosledno isplaćuje dividendu — kombinacija tipična za zrelo poslovanje koje više nema dovoljno prilika da reinvestira sav kapital uz dobar prinos, pa deo vraća akcionarima.`,
    };
  }
  if (growth <= 0) {
    return {
      phase: 5,
      label: "5 · Opadanje",
      detail: `${growthSource[0].toUpperCase()}${growthSource.slice(1)} je ${(growth * 100).toFixed(1)}% — stagnacija ili pad, bez doslednih dividendi koje bi ukazale na svesnu strategiju vraćanja kapitala. Ovo je faza koja zahteva najviše opreza.`,
    };
  }
  return {
    phase: 3,
    label: "3 · Operativna poluga",
    detail: `${growthSource[0].toUpperCase()}${growthSource.slice(1)} je ${(growth * 100).toFixed(1)}% — spor, ali pozitivan i bez doslednih dividendi, pa se ne svrstava ni u agresivan rast ni u zrelu fazu povraćaja kapitala.`,
  };
}

// ---------- Uzastopni kvartali rasta (prihod i neto dobit) ----------
//
// Yahoo-ov kvartalni modul obično vraća samo poslednja 4 kvartala, pa je
// ovo sekvencijalni (kvartal-na-kvartal) niz, ne godina-na-godinu — jasno
// obeleženo u UI da bi se izbegla zabuna sa sezonskim poređenjima.
export function computeConsecutiveGrowthStreak(values: number[]): number | null {
  if (values.length < 2) return null;
  let streak = 0;
  for (let i = values.length - 1; i > 0; i--) {
    if (values[i] > values[i - 1]) streak++;
    else break;
  }
  return streak;
}

// ---------- Kvalitet zarade: operativna naspram neto dobiti ----------
//
// Kad je neto dobit neuobičajeno daleko od operativne dobiti (van otprilike
// 50-110%, grubo nakon poreza i kamata), to je znak da jednokratne stavke
// (otpisi, dobici od prodaje imovine, poreske olakšice) menjaju sliku —
// upozorenje da treba pogledati "ispod" krajnjeg broja, ne konačan sud.
export interface QualityOfEarnings {
  ratio: number | null;
  label: "Uredno" | "Proveriti jednokratne stavke" | "Nedovoljno podataka";
  detail: string;
}

export function computeQualityOfEarnings(yearlyRows: YearlyFinancials[]): QualityOfEarnings {
  const last = yearlyRows[yearlyRows.length - 1];
  if (!last || last.operatingIncome == null || last.netIncome == null || last.operatingIncome <= 0) {
    return { ratio: null, label: "Nedovoljno podataka", detail: "Nedostaje operativna ili neto dobit za poslednju godinu, ili je operativna dobit negativna." };
  }
  const ratio = last.netIncome / last.operatingIncome;
  const inRange = ratio >= 0.5 && ratio <= 1.1;
  return {
    ratio,
    label: inRange ? "Uredno" : "Proveriti jednokratne stavke",
    detail: inRange
      ? `Neto dobit je ${(ratio * 100).toFixed(0)}% operativne dobiti za poslednju godinu — u očekivanom rasponu nakon poreza i kamata.`
      : `Neto dobit je ${(ratio * 100).toFixed(0)}% operativne dobiti za poslednju godinu — neuobičajeno ${ratio > 1.1 ? "visoko" : "nisko"}, moguće je da jednokratne stavke (otpisi, dobici od prodaje imovine, poreske olakšice) znatno menjaju sliku u odnosu na osnovno poslovanje.`,
  };
}

// ---------- Pojednostavljen Altman Z-score ----------
//
// Klasična formula (Altman, 1968) za javna proizvodna preduzeća. Namerno
// nije prilagođavana po sektoru (postoje posebne varijante za privatne i
// uslužne kompanije) — umesto toga se sektorima gde formula poznato slabo
// radi (finansije, nekretnine — bilans banke ili REIT-a nije uporediv sa
// proizvodnim preduzećem) dodaje eksplicitna napomena, da rezultat ne bi
// izgledao pouzdaniji nego što jeste.
export interface AltmanZScore {
  z: number | null;
  zone: "Sigurna zona" | "Siva zona" | "Zona rizika" | "Nedovoljno podataka";
  detail: string;
}

export function buildAltmanZScore(inputs: {
  totalAssets: number | null;
  totalLiabilities: number | null;
  totalCurrentAssets: number | null;
  totalCurrentLiabilities: number | null;
  retainedEarnings: number | null;
  operatingIncome: number | null;
  marketCap: number | null;
  revenue: number | null;
  sector: string | null;
}): AltmanZScore {
  const { totalAssets, totalLiabilities, totalCurrentAssets, totalCurrentLiabilities, retainedEarnings, operatingIncome, marketCap, revenue, sector } = inputs;
  if (
    totalAssets == null ||
    totalAssets <= 0 ||
    totalLiabilities == null ||
    totalCurrentAssets == null ||
    totalCurrentLiabilities == null ||
    retainedEarnings == null ||
    operatingIncome == null ||
    marketCap == null ||
    revenue == null
  ) {
    return { z: null, zone: "Nedovoljno podataka", detail: "Nedostaje bar jedna od pet komponenti formule (obrtni kapital, zadržana dobit, EBIT, tržišna vrednost/obaveze, promet/imovina)." };
  }
  const workingCapital = totalCurrentAssets - totalCurrentLiabilities;
  const a = workingCapital / totalAssets;
  const b = retainedEarnings / totalAssets;
  const c = operatingIncome / totalAssets;
  const d = totalLiabilities > 0 ? marketCap / totalLiabilities : 0;
  const e = revenue / totalAssets;
  const z = 1.2 * a + 1.4 * b + 3.3 * c + 0.6 * d + 1.0 * e;
  const zone: AltmanZScore["zone"] = z > 2.99 ? "Sigurna zona" : z > 1.81 ? "Siva zona" : "Zona rizika";
  const sectorCaveat = sector === "Financial Services" || sector === "Real Estate" ? ` Napomena: formula je manje pouzdana za sektor ${sector} jer struktura bilansa (depoziti, nekretnine) nije uporediva sa proizvodnim preduzećem za koje je formula izvorno razvijena.` : "";
  return {
    z,
    zone,
    detail: `Z-score ${z.toFixed(2)} — preko 2,99 sigurna zona, 1,81–2,99 siva zona, ispod 1,81 zona rizika od bankrotstva (klasična Altman formula iz 1968. za javna proizvodna preduzeća).${sectorCaveat}`,
  };
}

// ---------- Trend broja akcija u opticaju (dilucija naspram otkupa) ----------
export interface ShareCountTrend {
  cagr: number | null;
  direction: "opada (otkup)" | "raste (dilucija)" | "stabilno" | "nepoznato";
  years: number;
  detail: string;
}

export function computeShareCountTrend(history: { year: string; shares: number }[]): ShareCountTrend {
  if (history.length < 2) {
    return { cagr: null, direction: "nepoznato", years: history.length, detail: "Nedovoljno godina istorije broja akcija u opticaju." };
  }
  const first = history[0].shares;
  const last = history[history.length - 1].shares;
  const years = history.length - 1;
  if (first == null || last == null || first <= 0 || last <= 0 || years <= 0) {
    return { cagr: null, direction: "nepoznato", years, detail: "Neispravni podaci o broju akcija u opticaju." };
  }
  const cagr = Math.pow(last / first, 1 / years) - 1;
  const direction: ShareCountTrend["direction"] = cagr < -0.005 ? "opada (otkup)" : cagr > 0.005 ? "raste (dilucija)" : "stabilno";
  const explain =
    direction === "opada (otkup)"
      ? "kompanija smanjuje broj akcija u opticaju (otkup) — povećava učešće postojećih akcionara u budućoj dobiti."
      : direction === "raste (dilucija)"
        ? "broj akcija u opticaju raste (dilucija) — obično zbog emisije novih akcija ili akcijske kompenzacije zaposlenima."
        : "broj akcija u opticaju je stabilan.";
  return { cagr, direction, years, detail: `Broj akcija se menjao po stopi od ${(cagr * 100).toFixed(1)}% godišnje kroz ${years} godina — ${explain}` };
}

// ---------- Ukupni prinos akcionarima (dividenda + otkup) ----------
export function computeShareholderYield(dividendYield: number | null, shareCountCagr: number | null): number | null {
  if (dividendYield == null && shareCountCagr == null) return null;
  const buybackYield = shareCountCagr != null ? -shareCountCagr : 0;
  return (dividendYield ?? 0) + buybackYield;
}

// ---------- FCF prinos naspram bezrizične stope ----------
export function computeFcfYieldPremium(fcfYield: number | null, riskFreeRate: number): number | null {
  if (fcfYield == null) return null;
  return fcfYield - riskFreeRate;
}

// ---------- Istorijska volatilnost cene (anualizovana, iz mesečnih prinosa) ----------
export function computeHistoricalVolatility(priceHistory: HistoricalPricePoint[]): number | null {
  if (priceHistory.length < 13) return null;
  const returns: number[] = [];
  for (let i = 1; i < priceHistory.length; i++) {
    const prev = priceHistory[i - 1].close;
    const cur = priceHistory[i].close;
    if (prev > 0) returns.push(cur / prev - 1);
  }
  if (returns.length < 12) return null;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / returns.length;
  return Math.sqrt(variance) * Math.sqrt(12); // anualizovano iz mesečne standardne devijacije
}

// ---------- Neto dug / EBITDA ----------
//
// EBITDA je proxy (operativna dobit + amortizacija iz novčanog toka), ne
// tačna knjigovodstvena EBITDA — dovoljno za grubu ocenu zaduženosti.
export function computeNetDebtToEbitda(totalDebt: number | null, totalCash: number | null, operatingIncome: number | null, depreciation: number | null): number | null {
  if (totalDebt == null || totalCash == null || operatingIncome == null) return null;
  const ebitda = operatingIncome + (depreciation ?? 0);
  if (ebitda <= 0) return null;
  return (totalDebt - totalCash) / ebitda;
}

// ---------- Akcijska kompenzacija (SBC) kao % prihoda ----------
export function computeSbcPercent(sbc: number | null, revenue: number | null): number | null {
  if (sbc == null || revenue == null || revenue <= 0) return null;
  return sbc / revenue;
}

// ---------- Istorijska reakcija cene na izveštaje o rezultatima (aproksimacija) ----------
//
// VAŽNA NAPOMENA O TAČNOSTI: Yahoo-ov earningsHistory modul daje datum
// KRAJA FISKALNOG KVARTALA, ne datum OBJAVE rezultata — stvarna objava je
// obično 3-6 nedelja kasnije. Zato se ovde ne meri reakcija "na dan objave"
// (to bi zahtevalo tačan datum objave, koji ovaj izvor ne daje), nego
// promena cene u širokom prozoru od ~2 meseca posle kraja kvartala, koji bi
// trebalo da OBUHVATI datum objave za većinu kompanija. Ovo je gruba
// aproksimacija — prikazuje se sa jasnom napomenom, ne kao precizan broj.
export interface EarningsReaction {
  date: number;
  beat: boolean;
  reactionPercent: number | null;
}

export function computeEarningsReactions(
  earningsBeats: { beat: boolean; date: number | null }[] | null,
  dailyPriceHistory: HistoricalPricePoint[]
): EarningsReaction[] {
  if (!earningsBeats || !dailyPriceHistory.length) return [];
  return earningsBeats
    .filter((e): e is { beat: boolean; date: number } => e.date != null)
    .map((e) => {
      const before = findClosestPoint(dailyPriceHistory, e.date, 10);
      const after = findClosestPoint(dailyPriceHistory, e.date + 60 * 86400, 15);
      const reactionPercent = before && after && before.close > 0 ? after.close / before.close - 1 : null;
      return { date: e.date, beat: e.beat, reactionPercent };
    });
}

export function computeModel(data: ModelData, assumptions: Assumptions = DEFAULT_ASSUMPTIONS): ComputedModel {
  const f = data.fundamentals;
  const wacc = estimateWacc(f, assumptions);
  const suggestedGrowth = estimateFcfCagr(f.fcfHistory) ?? (f.revenueGrowth != null ? Math.max(-0.1, Math.min(0.3, f.revenueGrowth)) : assumptions.growthRateY1to5);
  // Ciljni P/E za relativnu valuaciju MORA biti nezavisan od trenutnog P/E
  // akcije (ranije je ovde stajalo f.trailingPE) — u suprotnom je
  // relativeValue ≈ forwardEps × trailingPE ≈ currentPrice × (forwardEps/
  // trailingEps), što samo preračunava trenutnu cenu kroz očekivani rast i
  // NIKAD ne može da pokaže da je akcija precenjena/potcenjena, bez obzira
  // koliko je njen sopstveni multiplikator ekstreman — cela poenta ove noge
  // procene je poređenje sa spoljnim orijentirom, ne sa samom sobom.
  const valuationAssumptions = { ...assumptions, growthRateY1to5: suggestedGrowth, targetPE: getSectorPeMedian(data.sector) ?? assumptions.targetPE };
  const dcf = computeDcf(f, valuationAssumptions, wacc);
  const ddm = computeDdm(f, valuationAssumptions);
  const relative = computeRelativeValuation(f, valuationAssumptions);
  const lynchValue = computeLynchValuation(f, valuationAssumptions.growthRateY1to5 * 100, (data.dividendYield ?? 0) * 100);
  const modelValues = [dcf.intrinsicValuePerShare, ddm, relative, lynchValue].filter((v): v is number => v != null);
  const avgIntrinsicValue = modelValues.length ? modelValues.reduce((a, b) => a + b, 0) / modelValues.length : null;
  const valuationUpside = summarizeUpside(f.currentPrice, avgIntrinsicValue);
  const shortTermUpside = summarizeUpside(f.currentPrice, data.targetMeanPrice);

  const breakdown = buildFinancialBreakdown(data.yearlyRows);
  const currentDebtToEquity = data.debtToEquity != null ? data.debtToEquity / 100 : null; // Yahoo vraća debtToEquity kao procenat
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
  const moatNarrative = buildMoatNarrative({
    moatScore: moat.score,
    grossMargin: data.grossMargin,
    operatingMargins: data.operatingMargins,
    returnOnEquity: data.returnOnEquity,
    wacc,
    direction: computeMoatMarginTrend(data.yearlyRows),
    marketCap: data.marketCap,
    sector: data.sector,
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
    sectorPeMedian: getSectorPeMedian(data.sector),
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

  const fundamentalsRating = rateFundamentals({
    revenueCagr: breakdown.revenueCagr,
    patCagr: breakdown.patCagr,
    grossMargin: data.grossMargin,
    operatingMargins: data.operatingMargins,
    returnOnEquity: data.returnOnEquity,
    debtToEquity: currentDebtToEquity,
    currentRatio: data.currentRatio,
    moatScore: moat.score,
  });

  const latestFcf = data.yearlyRows.length ? data.yearlyRows[data.yearlyRows.length - 1].fcf : null;
  const analystDispersionPercent =
    data.targetHighPrice != null && data.targetLowPrice != null && data.targetMeanPrice != null && data.targetMeanPrice > 0
      ? ((data.targetHighPrice - data.targetLowPrice) / data.targetMeanPrice) * 100
      : null;
  const redFlags = identifyRedFlags({
    latestFcf,
    operatingMargins: data.operatingMargins,
    debtToEquity: currentDebtToEquity,
    currentRatio: data.currentRatio,
    payoutRatio: data.payoutRatio,
    insiderNetPercentShares: data.insiderNetPercentShares,
    shortPercentOfFloat: data.shortPercentOfFloat,
    pegRatio: data.pegRatio,
    revenueGrowthTtm: data.revenueGrowthTtm,
    analystDispersionPercent,
  });
  const fcfStability = computeFcfStability(data.yearlyRows);
  const consecutiveRevenueQuarters = computeConsecutiveGrowthStreak(data.quarterlyRevenue);
  const consecutiveEarningsQuarters = computeConsecutiveGrowthStreak(data.quarterlyNetIncome);
  const qualityOfEarnings = computeQualityOfEarnings(data.yearlyRows);
  const lastRowForZ = data.yearlyRows[data.yearlyRows.length - 1];
  const altmanZScore = buildAltmanZScore({
    totalAssets: data.totalAssets,
    totalLiabilities: data.totalLiabilities,
    totalCurrentAssets: data.totalCurrentAssets,
    totalCurrentLiabilities: data.totalCurrentLiabilities,
    retainedEarnings: data.retainedEarnings,
    operatingIncome: lastRowForZ?.operatingIncome ?? null,
    marketCap: data.marketCap,
    revenue: lastRowForZ?.revenue ?? null,
    sector: data.sector,
  });
  const shareCountTrend = computeShareCountTrend(data.sharesOutstandingHistory);
  const shareholderYield = computeShareholderYield(data.dividendYield, shareCountTrend.cagr);
  const netDebtToEbitda = computeNetDebtToEbitda(data.fundamentals.totalDebt, data.fundamentals.totalCash, lastRowForZ?.operatingIncome ?? null, data.latestDepreciation);
  const sbcPercent = computeSbcPercent(data.latestStockBasedCompensation, lastRowForZ?.revenue ?? data.revenueTtm);

  const bullBear = buildBullBear({
    financialTrendVerdict: breakdown.verdict,
    revenueCagr: breakdown.revenueCagr,
    growthTier: growthPotential.tier,
    growthEstimateRange: growthPotential.estimateRange,
    pricedForPerfection: valuationFilter.pricedForPerfection,
    pegRatio: data.pegRatio,
    moatScore: moat.score,
    debtToEquity: currentDebtToEquity,
    managementVerdict: management.verdict,
    dividendYield: data.dividendYield,
    dividendPaidConsistently: data.dividendPaidConsistently,
    topRisk: risks[0] ?? null,
    redFlagCount: redFlags.length,
  });

  return {
    data,
    wacc,
    avgIntrinsicValue,
    lynchValue,
    shortTermUpside,
    valuationUpside,
    breakdown,
    growthFilter,
    valuationFilter,
    moat,
    moatNarrative,
    growthPotential,
    risks,
    management,
    bullBear,
    finalVerdict,
    fundamentalsRating,
    redFlags,
    fcfStability,
    consecutiveRevenueQuarters,
    consecutiveEarningsQuarters,
    qualityOfEarnings,
    altmanZScore,
    shareCountTrend,
    shareholderYield,
    netDebtToEbitda,
    sbcPercent,
  };
}
