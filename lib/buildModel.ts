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
  fundamentalsRating: ReturnType<typeof rateFundamentals>;
  redFlags: string[];
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
    if (!closest) return { year: r.label, multiple: null };
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
  {
    const benchmark = inputs.sectorPeMedian ?? inputs.ownHistoricalPeAvg;
    const benchmarkLabel = inputs.sectorPeMedian != null ? sectorLabel : "sopstvenog istorijskog proseka";
    const { reading, tone } = readingVsBenchmark(inputs.peRatio, benchmark, benchmarkLabel, "×");
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
  {
    const { reading, tone } = readingVsBenchmark(inputs.currentPFcf, inputs.ownHistoricalPFcfAvg, "sopstvenog istorijskog proseka", "×");
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

  return { data, wacc, avgIntrinsicValue, lynchValue, shortTermUpside, valuationUpside, breakdown, growthFilter, valuationFilter, moat, growthPotential, risks, management, bullBear, finalVerdict, fundamentalsRating, redFlags };
}
