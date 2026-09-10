// Čisti proračuni za procenu unutrašnje (intrinsične) vrednosti akcije.
// Nema mrežnih poziva ovde — samo matematika nad već preuzetim fundamentalima.

export interface Fundamentals {
  companyName: string;
  currency: string;
  currentPrice: number;
  sharesOutstanding: number | null;
  trailingEps: number | null;
  forwardEps: number | null;
  bookValuePerShare: number | null;
  trailingPE: number | null;
  forwardPE: number | null;
  dividendRate: number | null;
  beta: number | null;
  totalDebt: number | null;
  totalCash: number | null;
  freeCashflowTtm: number | null;
  fcfHistory: number[]; // hronološki, najstarije prvo
  revenueGrowth: number | null; // yoy, kao decimalni broj (0.1 = 10%)
}

export interface Assumptions {
  growthRateY1to5: number; // decimalno, npr 0.10 = 10%
  terminalGrowthRate: number;
  riskFreeRate: number;
  equityRiskPremium: number;
  costOfDebt: number;
  taxRate: number;
  dividendGrowthRate: number;
  targetPE: number;
}

export function estimateFcfCagr(fcfHistory: number[]): number | null {
  const positive = fcfHistory.filter((v) => v != null && Number.isFinite(v));
  if (positive.length < 2) return null;
  const first = positive[0];
  const last = positive[positive.length - 1];
  if (first <= 0 || last <= 0) return null;
  const years = positive.length - 1;
  const cagr = Math.pow(last / first, 1 / years) - 1;
  // ograniči na razuman opseg da ne izbaci ekstremne pretpostavke
  return Math.max(-0.2, Math.min(0.35, cagr));
}

export function costOfEquity(beta: number | null, riskFreeRate: number, equityRiskPremium: number): number {
  const b = beta != null && Number.isFinite(beta) ? beta : 1;
  return riskFreeRate + b * equityRiskPremium;
}

export function estimateWacc(
  fundamentals: Fundamentals,
  assumptions: Assumptions
): number {
  const ke = costOfEquity(fundamentals.beta, assumptions.riskFreeRate, assumptions.equityRiskPremium);
  const marketCap = (fundamentals.sharesOutstanding || 0) * fundamentals.currentPrice;
  const debt = fundamentals.totalDebt || 0;
  const total = marketCap + debt;
  if (total <= 0) return ke;
  const weightEquity = marketCap / total;
  const weightDebt = debt / total;
  const kd = assumptions.costOfDebt * (1 - assumptions.taxRate);
  return weightEquity * ke + weightDebt * kd;
}

export interface DcfResult {
  intrinsicValuePerShare: number | null;
  enterpriseValue: number | null;
  equityValue: number | null;
  wacc: number;
  projectedFcf: number[];
  error?: string;
}

export function computeDcf(
  fundamentals: Fundamentals,
  assumptions: Assumptions,
  waccOverride?: number
): DcfResult {
  const baseFcf = fundamentals.freeCashflowTtm;
  const shares = fundamentals.sharesOutstanding;
  const wacc = waccOverride ?? estimateWacc(fundamentals, assumptions);

  if (!baseFcf || baseFcf <= 0) {
    return { intrinsicValuePerShare: null, enterpriseValue: null, equityValue: null, wacc, projectedFcf: [], error: "Slobodan novčani tok (FCF) je negativan ili nedostupan — DCF nije primenjiv bez dodatnih pretpostavki." };
  }
  if (!shares) {
    return { intrinsicValuePerShare: null, enterpriseValue: null, equityValue: null, wacc, projectedFcf: [], error: "Broj akcija u opticaju nije dostupan." };
  }
  if (wacc <= assumptions.terminalGrowthRate) {
    return { intrinsicValuePerShare: null, enterpriseValue: null, equityValue: null, wacc, projectedFcf: [], error: "Diskontna stopa mora biti veća od terminalne stope rasta." };
  }

  const projectedFcf: number[] = [];
  let pvSum = 0;
  let fcf = baseFcf;
  for (let y = 1; y <= 5; y++) {
    fcf = fcf * (1 + assumptions.growthRateY1to5);
    projectedFcf.push(fcf);
    pvSum += fcf / Math.pow(1 + wacc, y);
  }
  const terminalValue = (projectedFcf[4] * (1 + assumptions.terminalGrowthRate)) / (wacc - assumptions.terminalGrowthRate);
  const pvTerminal = terminalValue / Math.pow(1 + wacc, 5);
  const enterpriseValue = pvSum + pvTerminal;
  const netDebt = (fundamentals.totalDebt || 0) - (fundamentals.totalCash || 0);
  const equityValue = enterpriseValue - netDebt;
  const intrinsicValuePerShare = equityValue / shares;

  return { intrinsicValuePerShare, enterpriseValue, equityValue, wacc, projectedFcf };
}

export function computeReverseDcfGrowth(
  fundamentals: Fundamentals,
  assumptions: Assumptions,
  waccOverride?: number
): number | null {
  const baseFcf = fundamentals.freeCashflowTtm;
  const shares = fundamentals.sharesOutstanding;
  const wacc = waccOverride ?? estimateWacc(fundamentals, assumptions);
  if (!baseFcf || baseFcf <= 0 || !shares) return null;

  const targetEquityValue = fundamentals.currentPrice * shares;
  const netDebt = (fundamentals.totalDebt || 0) - (fundamentals.totalCash || 0);
  const targetEnterpriseValue = targetEquityValue + netDebt;

  const evForGrowth = (g: number) => {
    let pvSum = 0;
    let fcf = baseFcf;
    for (let y = 1; y <= 5; y++) {
      fcf = fcf * (1 + g);
      pvSum += fcf / Math.pow(1 + wacc, y);
    }
    if (wacc <= assumptions.terminalGrowthRate) return Infinity;
    const terminalValue = (fcf * (1 + assumptions.terminalGrowthRate)) / (wacc - assumptions.terminalGrowthRate);
    const pvTerminal = terminalValue / Math.pow(1 + wacc, 5);
    return pvSum + pvTerminal;
  };

  // bisekcija u razumnom opsegu rasta
  let lo = -0.5, hi = 1.0;
  let loVal = evForGrowth(lo) - targetEnterpriseValue;
  const hiVal = evForGrowth(hi) - targetEnterpriseValue;
  if (loVal > 0 || hiVal < 0) return null; // van opsega, ne može se rešiti pouzdano

  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const midVal = evForGrowth(mid) - targetEnterpriseValue;
    if (Math.abs(midVal) < 1) return mid;
    if ((midVal > 0) === (loVal > 0)) {
      lo = mid;
      loVal = midVal;
    } else {
      hi = mid;
    }
  }
  return (lo + hi) / 2;
}

// Peter Lynch-ova "fer P/E" heuristika (iz "One Up On Wall Street"): fer P/E
// multiplikator treba da odgovara stopi rasta zarade (u procentnim
// poenima), uvećanoj za dividendni prinos — kompanija koja raste 15%
// godišnje sa 2% dividende "zaslužuje" P/E od otprilike 17. Za razliku od
// Grahamovog broja (kalibrisanog za akcije sa visokom knjigovodstvenom
// vrednošću), ovo eksplicitno uzima rast u obzir, pa ostaje relevantno i za
// savremene, kapitalno-lake kompanije.
export function computeLynchValuation(
  fundamentals: Fundamentals,
  growthRatePercent: number,
  dividendYieldPercent: number
): number | null {
  const eps = fundamentals.forwardEps ?? fundamentals.trailingEps;
  if (!eps || eps <= 0) return null;
  const fairPE = growthRatePercent + dividendYieldPercent;
  if (fairPE <= 0) return null;
  return eps * fairPE;
}

export function computeDdm(fundamentals: Fundamentals, assumptions: Assumptions): number | null {
  const d0 = fundamentals.dividendRate;
  if (!d0 || d0 <= 0) return null;
  const ke = costOfEquity(fundamentals.beta, assumptions.riskFreeRate, assumptions.equityRiskPremium);
  const g = assumptions.dividendGrowthRate;
  if (ke <= g) return null;
  const d1 = d0 * (1 + g);
  return d1 / (ke - g);
}

export function computeRelativeValuation(fundamentals: Fundamentals, assumptions: Assumptions): number | null {
  const eps = fundamentals.forwardEps ?? fundamentals.trailingEps;
  if (!eps || eps <= 0 || !assumptions.targetPE) return null;
  return eps * assumptions.targetPE;
}

export interface ValuationSummaryRow {
  label: string;
  value: number | null;
  note?: string;
}

export function summarizeUpside(currentPrice: number, value: number | null): number | null {
  if (value == null) return null;
  return value / currentPrice - 1;
}
