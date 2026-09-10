// Sveobuhvatni finansijski model za američke i evropske akcije.
//
// Prati istu filozofiju kao lib/qualitative.ts i lib/valuation.ts: svaka
// dimenzija se izvodi iz merljivih podataka sa fiksnim, unapred određenim
// pragovima — nema slobodnog AI teksta niti subjektivnih ocena koje se ne
// mogu proveriti iz podataka. Kad podatak nedostaje, to se jasno kaže umesto
// da se nagađa.

export interface YearlyFinancials {
  label: string; // npr. "2021", ili "Pre 3 god." ako godina nije dostupna
  revenue: number | null;
  netIncome: number | null; // PAT
  operatingIncome: number | null;
  totalEquity: number | null;
  totalDebt: number | null;
  fcf: number | null;
}

function cagr(first: number, last: number, years: number): number | null {
  if (first <= 0 || last <= 0 || years <= 0) return null;
  return Math.pow(last / first, 1 / years) - 1;
}

function countDirectional(values: number[]): { up: number; down: number; total: number } {
  let up = 0;
  let down = 0;
  for (let i = 1; i < values.length; i++) {
    if (values[i] > values[i - 1]) up++;
    else if (values[i] < values[i - 1]) down++;
  }
  return { up, down, total: values.length - 1 };
}

// ---------- Prompt: Deep Financial Breakdown ----------

export interface FinancialBreakdownResult {
  rows: YearlyFinancials[];
  revenueCagr: number | null;
  patCagr: number | null;
  verdict: "jača" | "slabija" | "mešovita" | "nedovoljno podataka";
  detail: string;
}

export function buildFinancialBreakdown(rows: YearlyFinancials[]): FinancialBreakdownResult {
  const revenues = rows.map((r) => r.revenue).filter((v): v is number => v != null);
  const netIncomes = rows.map((r) => r.netIncome).filter((v): v is number => v != null);
  const debts = rows.map((r) => r.totalDebt).filter((v): v is number => v != null);
  const fcfs = rows.map((r) => r.fcf).filter((v): v is number => v != null);

  if (revenues.length < 2 && netIncomes.length < 2) {
    return {
      rows,
      revenueCagr: null,
      patCagr: null,
      verdict: "nedovoljno podataka",
      detail: "Nema dovoljno istorijskih godišnjih izveštaja za ovaj tiker da bi se izračunao trend.",
    };
  }

  const revenueCagr = revenues.length >= 2 ? cagr(revenues[0], revenues[revenues.length - 1], revenues.length - 1) : null;
  const patCagr = netIncomes.length >= 2 ? cagr(netIncomes[0], netIncomes[netIncomes.length - 1], netIncomes.length - 1) : null;

  let points = 0;
  const parts: string[] = [];
  if (revenueCagr != null) {
    parts.push(`CAGR prihoda ${(revenueCagr * 100).toFixed(1)}%`);
    points += revenueCagr > 0 ? 1 : -1;
  }
  if (patCagr != null) {
    parts.push(`CAGR neto dobiti (PAT) ${(patCagr * 100).toFixed(1)}%`);
    points += patCagr > 0 ? 1 : -1;
  }
  if (debts.length >= 2) {
    const debtTrend = countDirectional(debts);
    if (debtTrend.total > 0) {
      const growingDebt = debtTrend.up > debtTrend.down;
      parts.push(`Dug ${growingDebt ? "raste" : "opada ili je stabilan"}`);
      points += growingDebt ? -1 : 1;
    }
  }
  if (fcfs.length >= 2) {
    const fcfTrend = countDirectional(fcfs);
    if (fcfTrend.total > 0) {
      const growingFcf = fcfTrend.up >= fcfTrend.down;
      parts.push(`Slobodan novčani tok ${growingFcf ? "raste" : "opada"}`);
      points += growingFcf ? 1 : -1;
    }
  }

  const verdict: FinancialBreakdownResult["verdict"] = points > 0 ? "jača" : points < 0 ? "slabija" : "mešovita";
  return { rows, revenueCagr, patCagr, verdict, detail: parts.join(", ") || "Nedovoljno podataka za sve pokazatelje." };
}

// ---------- Prompt: Competitive Moat Analysis (objektivni proxy) ----------

export interface MoatInputs {
  grossMargin: number | null; // trenutna (TTM) vrednost — Yahoo ne pruža pouzdanu godišnju istoriju ovog pokazatelja
  operatingMargins: number | null;
  returnOnInvestedCapitalProxy: number | null; // ROE korišćen kao proxy za ROIC kad ROIC nije dostupan
  wacc: number | null;
  marketCap: number | null;
}

export interface MoatResult {
  score: number; // 1-10
  detail: string;
}

export function scoreMoat(inputs: MoatInputs): MoatResult {
  let score = 5;
  const parts: string[] = [];

  if (inputs.grossMargin != null && Number.isFinite(inputs.grossMargin)) {
    parts.push(`Bruto marža ${(inputs.grossMargin * 100).toFixed(1)}%`);
    if (inputs.grossMargin > 0.4) score += 1;
    if (inputs.grossMargin > 0.6) score += 1;
    if (inputs.grossMargin < 0.2) score -= 1;
  } else {
    parts.push("Bruto marža nije dostupna za ovaj tiker.");
  }

  if (inputs.operatingMargins != null) {
    parts.push(`Operativna marža ${(inputs.operatingMargins * 100).toFixed(1)}%`);
    if (inputs.operatingMargins > 0.2) score += 1;
    else if (inputs.operatingMargins < 0.05) score -= 1;
  }

  if (inputs.returnOnInvestedCapitalProxy != null && inputs.wacc != null) {
    const spread = inputs.returnOnInvestedCapitalProxy - inputs.wacc;
    parts.push(`ROE−WACC spread ${(spread * 100).toFixed(1)}p.p.`);
    if (spread > 0.1) score += 1;
    else if (spread < 0) score -= 2;
  }

  score = Math.max(1, Math.min(10, Math.round(score)));
  return {
    score,
    detail:
      parts.join(", ") +
      ". Ovo je objektivni proxy (marže i prinos na kapital u odnosu na cenu kapitala) — ne meri direktno brend, distribuciju ili troškove prelaska, jer ti podaci nisu merljivi iz finansijskih izveštaja.",
  };
}

// ---------- Prompt: Growth Filter (kvantitativni skrining) ----------

export interface GrowthFilterInputs {
  revenueHistory: number[]; // hronološki
  netIncomeHistory: number[]; // hronološki
  ttmRevenueGrowth: number | null;
}

export interface FilterCheck {
  label: string;
  pass: boolean | null; // null = nema podataka
  detail: string;
}

export interface GrowthFilterResult {
  checks: FilterCheck[];
  passCount: number;
  totalApplicable: number;
}

export function runGrowthFilter(inputs: GrowthFilterInputs): GrowthFilterResult {
  const checks: FilterCheck[] = [];
  const rev = inputs.revenueHistory.filter((v) => v != null && Number.isFinite(v));
  const ni = inputs.netIncomeHistory.filter((v) => v != null && Number.isFinite(v));

  const revCagr = rev.length >= 2 ? cagr(rev[0], rev[rev.length - 1], rev.length - 1) : null;
  checks.push({
    label: "5-god. CAGR prihoda iznad razumnog praga (>8%)",
    pass: revCagr == null ? null : revCagr > 0.08,
    detail: revCagr != null ? `${(revCagr * 100).toFixed(1)}%` : "Nedovoljno godišnjih izveštaja.",
  });

  const niCagr = ni.length >= 2 ? cagr(ni[0], ni[ni.length - 1], ni.length - 1) : null;
  checks.push({
    label: "CAGR neto dobiti prati ili prevazilazi CAGR prihoda",
    pass: revCagr != null && niCagr != null ? niCagr >= revCagr : null,
    detail: revCagr != null && niCagr != null ? `Prihod ${(revCagr * 100).toFixed(1)}% vs dobit ${(niCagr * 100).toFixed(1)}%` : "Nedovoljno podataka.",
  });

  checks.push({
    label: "Pozitivan rast prihoda u poslednjih 12 meseci (g/g)",
    pass: inputs.ttmRevenueGrowth == null ? null : inputs.ttmRevenueGrowth > 0,
    detail: inputs.ttmRevenueGrowth != null ? `${(inputs.ttmRevenueGrowth * 100).toFixed(1)}%` : "Nije dostupno.",
  });

  if (rev.length >= 3) {
    const last = rev[rev.length - 1];
    const prevAvg = rev.slice(0, -1).reduce((a, b) => a + b, 0) / (rev.length - 1);
    const oneTimeSpike = last > prevAvg * 1.5;
    checks.push({
      label: "Rast nije rezultat jedne izuzetne godine (bez naglog skoka)",
      pass: !oneTimeSpike,
      detail: oneTimeSpike ? "Poslednja godina znatno odudara od proseka prethodnih godina — proveriti da li je taj skok jednokratan." : "Rast izgleda postepen.",
    });
  } else {
    checks.push({ label: "Rast nije rezultat jedne izuzetne godine", pass: null, detail: "Nedovoljno godina za proveru." });
  }

  if (revCagr != null && niCagr != null) {
    const profitGrewSalesFlat = niCagr > 0.05 && revCagr < 0.02;
    checks.push({
      label: "Upozorenje: dobit raste dok prihodi stagniraju",
      pass: !profitGrewSalesFlat,
      detail: profitGrewSalesFlat ? "Dobit raste uglavnom kroz uštede i marže, a ne kroz rast prihoda — proveriti održivost." : "Nije detektovano.",
    });
  }

  const applicable = checks.filter((c) => c.pass != null);
  return { checks, passCount: applicable.filter((c) => c.pass).length, totalApplicable: applicable.length };
}

// ---------- Prompt: The Valuation Filter ----------

export interface ValuationFilterInputs {
  peRatio: number | null;
  pegRatio: number | null;
  evToEbitda: number | null;
  priceToBook: number | null;
  returnOnEquity: number | null;
  dividendYield: number | null;
}

export function runValuationFilter(inputs: ValuationFilterInputs): GrowthFilterResult & { pricedForPerfection: boolean } {
  const checks: FilterCheck[] = [];

  checks.push({
    label: "PEG u razumnom rasponu za ponuđeni rast (0.5–2.0)",
    pass: inputs.pegRatio == null ? null : inputs.pegRatio > 0.5 && inputs.pegRatio < 2.0,
    detail: inputs.pegRatio != null ? inputs.pegRatio.toFixed(2) : "PEG nije dostupan.",
  });

  checks.push({
    label: "EV/EBITDA razuman (<15×, zavisi od sektora)",
    pass: inputs.evToEbitda == null ? null : inputs.evToEbitda < 15,
    detail: inputs.evToEbitda != null ? `${inputs.evToEbitda.toFixed(1)}×` : "Nije dostupno.",
  });

  const pbOk =
    inputs.priceToBook != null && inputs.returnOnEquity != null
      ? inputs.priceToBook < 1.5 || inputs.returnOnEquity > 0.15
      : null;
  checks.push({
    label: "P/B opravdan visinom ROE (nisko P/B ili visok ROE)",
    pass: pbOk,
    detail:
      inputs.priceToBook != null && inputs.returnOnEquity != null
        ? `P/B ${inputs.priceToBook.toFixed(2)}, ROE ${(inputs.returnOnEquity * 100).toFixed(1)}%`
        : "Nedostaje P/B ili ROE.",
  });

  checks.push({
    label: "Dividendni prinos kao kontrolna provera (ako postoji, >1%)",
    pass: inputs.dividendYield == null ? null : inputs.dividendYield > 0.01,
    detail: inputs.dividendYield != null ? `${(inputs.dividendYield * 100).toFixed(2)}%` : "Akcija ne isplaćuje dividendu — nije nužno loše.",
  });

  const pricedForPerfection = (inputs.pegRatio != null && inputs.pegRatio > 2.5) || (inputs.evToEbitda != null && inputs.evToEbitda > 25);
  checks.push({
    label: "Cena ne pretpostavlja savršeno izvršenje",
    pass: !pricedForPerfection,
    detail: pricedForPerfection ? "Multiplikator implicira vrlo visoka očekivanja — svaki propust u izvršenju mogao bi oštro srušiti cenu." : "Multiplikatori ne ukazuju na ekstremna očekivanja.",
  });

  const applicable = checks.filter((c) => c.pass != null);
  return { checks, passCount: applicable.filter((c) => c.pass).length, totalApplicable: applicable.length, pricedForPerfection };
}

// ---------- Prompt: Growth Potential Analysis ----------

export interface GrowthPotentialInputs {
  historicalRevenueCagr: number | null;
  analystLongTermGrowth: number | null; // konsenzus rasta EPS-a naredne 5 god. (earningsTrend, +5y)
  revenueGrowthTtm: number | null;
}

// Diskretna ocena rasta, odvojena od teksta prikazanog korisniku — na nju se
// oslanja finalna presuda (buildFinalVerdict), umesto na fragilno poređenje
// prikazanog teksta.
export type GrowthTier = "visok" | "umeren" | "nizak" | "upitan" | "nepoznat";

// Pragovi (godišnja stopa rasta):
//   visok  → preko 15%
//   umeren → između 5% i 15%
//   nizak  → između 0% i 5%
//   upitan → 0% ili manje (procena je negativna ili stagnira)
const GROWTH_TIER_THRESHOLDS = { visok: 0.15, umeren: 0.05, nizak: 0 } as const;

export interface GrowthPotentialResult {
  tier: GrowthTier;
  label: string;
  estimateRange: string;
  detail: string;
}

export function scoreGrowthPotential(inputs: GrowthPotentialInputs): GrowthPotentialResult {
  const values = [inputs.historicalRevenueCagr, inputs.analystLongTermGrowth, inputs.revenueGrowthTtm].filter(
    (v): v is number => v != null
  );
  if (values.length === 0) {
    return {
      tier: "nepoznat",
      label: "Nedovoljno podataka o rastu",
      estimateRange: "—",
      detail: "Nema ni istorijskih podataka ni konsenzus procene analitičara o rastu za ovaj tiker.",
    };
  }
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  let tier: GrowthTier;
  let label: string;
  if (avg > GROWTH_TIER_THRESHOLDS.visok) {
    tier = "visok";
    label = "Visok potencijal rasta (procena preko 15% godišnje)";
  } else if (avg > GROWTH_TIER_THRESHOLDS.umeren) {
    tier = "umeren";
    label = "Umeren potencijal rasta (procena između 5% i 15% godišnje)";
  } else if (avg > GROWTH_TIER_THRESHOLDS.nizak) {
    tier = "nizak";
    label = "Nizak potencijal rasta (procena između 0% i 5% godišnje)";
  } else {
    tier = "upitan";
    label = "Rast pod znakom pitanja (procena je 0% ili negativna)";
  }
  const low = Math.max(-0.1, avg - 0.05);
  const high = avg + 0.05;
  const parts: string[] = [];
  if (inputs.historicalRevenueCagr != null) parts.push(`istorijski CAGR prihoda ${(inputs.historicalRevenueCagr * 100).toFixed(1)}%`);
  if (inputs.analystLongTermGrowth != null) parts.push(`konsenzus analitičara o dugoročnom rastu ${(inputs.analystLongTermGrowth * 100).toFixed(1)}%`);
  if (inputs.revenueGrowthTtm != null) parts.push(`rast prihoda u poslednjih 12 meseci ${(inputs.revenueGrowthTtm * 100).toFixed(1)}%`);
  return {
    tier,
    label,
    estimateRange: `${(low * 100).toFixed(0)}%–${(high * 100).toFixed(0)}% godišnje`,
    detail: `Procena je prosek dostupnih pokazatelja (${parts.join(", ")}). Ovo je samo analiza — nije poziv na kupovinu ili prodaju.`,
  };
}

// ---------- Prompt: Risk Analysis ----------

export interface RiskInputs {
  debtToEquity: number | null;
  currentRatio: number | null;
  beta: number | null;
  peRatio: number | null;
  sectorPeMedian: number | null; // ako nije dostupno, koristi se generički prag
  analystDispersion: { high: number; low: number; mean: number } | null;
}

export interface RiskItem {
  label: string;
  severity: 1 | 2 | 3 | 4 | 5;
  detail: string;
}

export function rankRisks(inputs: RiskInputs): RiskItem[] {
  const risks: RiskItem[] = [];

  if (inputs.debtToEquity != null) {
    const de = inputs.debtToEquity / 100; // Yahoo vraća kao procenat
    risks.push({
      label: "Zaduženost (finansijski rizik)",
      severity: de > 2 ? 5 : de > 1.2 ? 4 : de > 0.6 ? 2 : 1,
      detail: `Debt/Equity ${de.toFixed(2)}`,
    });
  }

  if (inputs.currentRatio != null) {
    risks.push({
      label: "Likvidnost (kratkoročni rizik)",
      severity: inputs.currentRatio < 1 ? 4 : inputs.currentRatio < 1.3 ? 2 : 1,
      detail: `Current ratio ${inputs.currentRatio.toFixed(2)}`,
    });
  }

  if (inputs.beta != null) {
    risks.push({
      label: "Tržišna volatilnost",
      severity: inputs.beta > 1.8 ? 4 : inputs.beta > 1.3 ? 3 : inputs.beta > 0.8 ? 2 : 1,
      detail: `Beta ${inputs.beta.toFixed(2)}`,
    });
  }

  if (inputs.peRatio != null) {
    const threshold = inputs.sectorPeMedian ?? 25;
    const ratio = inputs.peRatio / threshold;
    risks.push({
      label: "Rizik precenjenosti",
      severity: ratio > 1.8 ? 5 : ratio > 1.3 ? 3 : ratio > 1 ? 2 : 1,
      detail: `P/E ${inputs.peRatio.toFixed(1)} u odnosu na referentnu vrednost od ${threshold.toFixed(0)}`,
    });
  }

  if (inputs.analystDispersion) {
    const { high, low, mean } = inputs.analystDispersion;
    if (mean > 0) {
      const spread = (high - low) / mean;
      risks.push({
        label: "Neizvesnost procena analitičara",
        severity: spread > 0.8 ? 4 : spread > 0.4 ? 2 : 1,
        detail: `Raspon ciljnih cena ${(spread * 100).toFixed(0)}% oko proseka`,
      });
    }
  }

  return risks.sort((a, b) => b.severity - a.severity);
}

// ---------- Prompt: Management Quality Analysis (objektivni proxy) ----------

export interface ManagementInputs {
  heldPercentInsiders: number | null;
  heldPercentInstitutions: number | null;
  insiderNetPercentShares: number | null; // pozitivno = neto kupovina insajdera
  shortPercentOfFloat: number | null;
  dividendPaidConsistently: boolean | null;
}

export interface ManagementQualityResult {
  verdict: "izgleda pouzdano" | "izgleda rizično" | "mešovito" | "nedovoljno podataka";
  details: string[];
}

export function scoreManagementQuality(inputs: ManagementInputs): ManagementQualityResult {
  const details: string[] = [];
  let points = 0;
  let signals = 0;

  if (inputs.heldPercentInsiders != null) {
    signals++;
    details.push(`Udeo akcija u vlasništvu insajdera i osnivača: ${(inputs.heldPercentInsiders * 100).toFixed(1)}%`);
    if (inputs.heldPercentInsiders > 0.05) points += 1; // "skin in the game"
    if (inputs.heldPercentInsiders > 0.5) points -= 1; // koncentracija kontrole = rizik korporativnog upravljanja
  }

  if (inputs.insiderNetPercentShares != null) {
    signals++;
    const buying = inputs.insiderNetPercentShares > 0;
    details.push(`Neto insajderske transakcije u poslednjem periodu: ${buying ? "kupovina" : "prodaja"} (${(inputs.insiderNetPercentShares * 100).toFixed(2)}%)`);
    points += buying ? 1 : -1;
  }

  if (inputs.shortPercentOfFloat != null) {
    signals++;
    details.push(`Short interes: ${(inputs.shortPercentOfFloat * 100).toFixed(1)}% slobodnih akcija`);
    if (inputs.shortPercentOfFloat > 0.15) points -= 1;
  }

  if (inputs.heldPercentInstitutions != null) {
    signals++;
    details.push(`Udeo institucionalnih investitora: ${(inputs.heldPercentInstitutions * 100).toFixed(1)}%`);
    if (inputs.heldPercentInstitutions > 0.6) points += 1; // signal poverenja profesionalaca
  }

  if (inputs.dividendPaidConsistently != null) {
    signals++;
    details.push(inputs.dividendPaidConsistently ? "Dosledna isplata dividende — signal discipline u alokaciji kapitala." : "Nema dosledne isplate dividende (nije nužno negativno).");
    if (inputs.dividendPaidConsistently) points += 1;
  }

  if (signals === 0) {
    return { verdict: "nedovoljno podataka", details: ["Podaci o vlasničkoj strukturi i insajderskim transakcijama nisu dostupni za ovaj tiker."] };
  }

  const verdict: ManagementQualityResult["verdict"] = points > 0 ? "izgleda pouzdano" : points < 0 ? "izgleda rizično" : "mešovito";
  details.push("Napomena: 'kvalitet menadžmenta' se ovde meri isključivo kroz proverljive podatke (vlasnička struktura, insajderske transakcije, disciplina isplate dividende) — ne kroz reputaciju ili medijski utisak.");
  return { verdict, details };
}

// ---------- Prompt: Bull vs Bear Debate (strukturirano, iz već izračunatih dimenzija) ----------

export interface DimensionSignal {
  label: string;
  positive: boolean;
  detail: string;
}

export interface BullBearResult {
  bull: string[];
  bear: string[];
  conclusion: string;
}

export function buildBullBear(signals: DimensionSignal[]): BullBearResult {
  const bull = signals.filter((s) => s.positive).map((s) => `${s.label}: ${s.detail}`);
  const bear = signals.filter((s) => !s.positive).map((s) => `${s.label}: ${s.detail}`);
  let conclusion: string;
  if (bull.length > bear.length * 1.5) {
    conclusion = "Bikovski argumenti brojčano preovlađuju, ali svaki pojedinačni pokazatelj treba proveriti — brojčana prevaga ne znači automatski da je akcija dobra kupovina.";
  } else if (bear.length > bull.length * 1.5) {
    conclusion = "Medveđi argumenti brojčano preovlađuju — vredi razumeti da li su to strukturni problemi ili privremene poteškoće.";
  } else {
    conclusion = "Argumenti su podeljeni otprilike podjednako — ovo je znak da odluka zavisi od ličnog horizonta i tolerancije na rizik, ne od jasnog konsenzusa podataka.";
  }
  return { bull, bear, conclusion };
}

// ---------- Prompt: Should I Buy This Stock? (finalna sinteza) ----------

export interface FinalVerdictInputs {
  shortTermUpside: number | null; // implicira prosečna ciljna cena analitičara (1 god.)
  growthTier: GrowthTier; // iz Growth Potential Analysis — stvarna procena rasta poslovanja, ne procena vrednosti
  growthLabel: string;
  growthDetail: string;
  catalysts: string[];
  risks: string[];
  pricedForPerfection: boolean;
}

export interface FinalVerdict {
  shortTermLabel: string;
  growthLabel: string;
  verdict: "Kupovina" | "Držanje" | "Izbegavanje" | "Nedovoljno podataka";
  detail: string;
}

function outlookLabel(upside: number | null): string {
  if (upside == null) return "Nedovoljno podataka";
  if (upside > 0.15) return "Pozitivan";
  if (upside > -0.05) return "Neutralan";
  return "Negativan";
}

function growthScore(tier: GrowthTier): number | null {
  if (tier === "visok") return 2;
  if (tier === "umeren") return 1;
  if (tier === "nizak") return 0;
  if (tier === "upitan") return -1;
  return null; // "nepoznat"
}

export function buildFinalVerdict(inputs: FinalVerdictInputs): FinalVerdict {
  const shortTermLabel = outlookLabel(inputs.shortTermUpside);
  const gScore = growthScore(inputs.growthTier);

  if (gScore == null) {
    return {
      shortTermLabel,
      growthLabel: inputs.growthLabel,
      verdict: "Nedovoljno podataka",
      detail: "Nema dovoljno podataka o rastu za konačan sud.",
    };
  }

  let verdict: FinalVerdict["verdict"];
  let reasoning: string;
  if (gScore <= 0) {
    verdict = "Izbegavanje";
    reasoning =
      "Zašto izbegavanje: poslovanje samo po sebi ne raste dovoljno (ili je rast upitan) — a kad osnovni biznis ne raste, nijedna cena to dugoročno ne kompenzuje, pa se dalja analiza valuacije ne isplati.";
  } else if (inputs.pricedForPerfection) {
    verdict = "Držanje";
    reasoning =
      "Zašto držanje: poslovanje ima dovoljno dobar rast da opravda dalje praćenje, ali trenutna cena već pretpostavlja gotovo savršeno izvršenje (visok PEG i/ili EV/EBITDA) — svaki propust bi je oštro pogodio, pa je razumnije sačekati bolju cenu za ulazak nego kupovati odmah.";
  } else {
    verdict = "Kupovina";
    reasoning =
      "Zašto kupovina: poslovanje pokazuje dovoljno dobar rast, a cena ne pretpostavlja ekstremno savršeno izvršenje (multiplikatori nisu u zoni upozorenja) — kombinacija rasta i razumne cene ovde je najjača.";
  }

  const detail = [
    reasoning,
    `Kratkoročno (1 god., prema konsenzusu analitičara): ${shortTermLabel}.`,
    `Dugoročni izgled rasta (5+ god., iz istorijskog rasta i konsenzusa analitičara o rastu — ne iz modela procene vrednosti): ${inputs.growthLabel}. ${inputs.growthDetail}`,
    inputs.catalysts.length ? `Ključni katalizatori: ${inputs.catalysts.join("; ")}.` : "",
    inputs.risks.length ? `Najveći rizici: ${inputs.risks.join("; ")}.` : "",
    inputs.pricedForPerfection ? "Upozorenje: cena akcije pretpostavlja gotovo savršeno izvršenje — i najmanji propust mogao bi je oštro pogoditi." : "",
    "Ovo NIJE finansijski savet — sud je automatski izveden iz pretpostavki koje si uneo/la u modelu.",
  ]
    .filter(Boolean)
    .join(" ");

  return { shortTermLabel, growthLabel: inputs.growthLabel, verdict, detail };
}
