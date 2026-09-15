// Logika za "Moj portfolio" — objedinjuje već postojeći sveobuhvatni model
// (po pojedinačnoj akciji) sa analizom na nivou celog portfelja: koncentracija,
// stres-test i poređenje sa SPY. Ista filozofija kao ostatak sajta: fiksna,
// proverljiva pravila, bez slobodnog AI teksta.

export interface PortfolioHolding {
  id: string;
  ticker: string | null; // Yahoo simbol — null za fondove bez pouzdanog tikera i za gotovinu
  name: string;
  category: "akcija" | "fond" | "gotovina";
  shares: number;
  currency: string;
  marketValueNok: number; // iz izveštaja brokera — može se ručno ažurirati, ne preuzima se uživo (izbegava se FX konverzija)
  region?: string; // samo za fondove/gotovinu bez tikera, gde se zemlja ne može preuzeti iz Yahoo profila
}

// Prefilled iz stvarnog izveštaja korisnika (Nordnet, 4.9.2026, dva računa) —
// samo početna tačka, korisnik može dodati/ukloniti/izmeniti pozicije.
export const DEFAULT_HOLDINGS: PortfolioHolding[] = [
  { id: "eqnr", ticker: "EQNR.OL", name: "Equinor", category: "akcija", shares: 46, currency: "NOK", marketValueNok: 18105.6 },
  { id: "mpcc", ticker: "MPCC.OL", name: "MPC Container Ships", category: "akcija", shares: 300, currency: "NOK", marketValueNok: 8235.0 },
  { id: "orkla", ticker: "ORK.OL", name: "Orkla", category: "akcija", shares: 40, currency: "NOK", marketValueNok: 3730.0 },
  { id: "parb", ticker: "PARB.OL", name: "Pareto Bank", category: "akcija", shares: 50, currency: "NOK", marketValueNok: 2875.0 },
  { id: "nong", ticker: "NONG.OL", name: "SpareBank 1 Nord-Norge", category: "akcija", shares: 50, currency: "NOK", marketValueNok: 8575.0 },
  { id: "stb", ticker: "STB.OL", name: "Storebrand", category: "akcija", shares: 15, currency: "NOK", marketValueNok: 3084.0 },
  { id: "var", ticker: "VAR.OL", name: "Vår Energi", category: "akcija", shares: 200, currency: "NOK", marketValueNok: 10016.0 },
  { id: "klp-asia", ticker: null, name: "KLP AksjeAsia Indeks N", category: "fond", shares: 3.19, currency: "NOK", marketValueNok: 5453.16, region: "Azija (razvijena tržišta)" },
  { id: "nn-em", ticker: null, name: "Nordnet Emerging Markets Indeks", category: "fond", shares: 102.77, currency: "NOK", marketValueNok: 17357.49, region: "Tržišta u razvoju" },
  { id: "googl", ticker: "GOOGL", name: "Alphabet A", category: "akcija", shares: 4, currency: "USD", marketValueNok: 12584.93 },
  { id: "amzn", ticker: "AMZN", name: "Amazon.com", category: "akcija", shares: 8, currency: "USD", marketValueNok: 19224.32 },
  { id: "axp", ticker: "AXP", name: "American Express", category: "akcija", shares: 2, currency: "USD", marketValueNok: 6063.79 },
  { id: "ko", ticker: "KO", name: "Coca-Cola", category: "akcija", shares: 18, currency: "USD", marketValueNok: 14736.15 },
  { id: "invea", ticker: "INVE-A.ST", name: "Investor A", category: "akcija", shares: 18, currency: "SEK", marketValueNok: 7080.93 },
  { id: "ma", ticker: "MA", name: "Mastercard", category: "akcija", shares: 3, currency: "USD", marketValueNok: 16152.54 },
  { id: "mrk", ticker: "MRK", name: "Merck & Co", category: "akcija", shares: 14, currency: "USD", marketValueNok: 19563.98 },
  { id: "meta", ticker: "META", name: "Meta Platforms A", category: "akcija", shares: 3, currency: "USD", marketValueNok: 17199.99 },
  { id: "msft", ticker: "MSFT", name: "Microsoft", category: "akcija", shares: 10, currency: "USD", marketValueNok: 46450.77 },
  { id: "nvda", ticker: "NVDA", name: "NVIDIA", category: "akcija", shares: 14, currency: "USD", marketValueNok: 29979.11 },
  { id: "tsm", ticker: "TSM", name: "Taiwan Semiconductor ADR", category: "akcija", shares: 3, currency: "USD", marketValueNok: 11961.1 },
  { id: "v", ticker: "V", name: "Visa", category: "akcija", shares: 5, currency: "USD", marketValueNok: 17432.75 },
  { id: "klp-global", ticker: null, name: "KLP AksjeGlobal Indeks N", category: "fond", shares: 0.52, currency: "NOK", marketValueNok: 984.11, region: "Globalno (razvijena tržišta)" },
  { id: "cash", ticker: null, name: "Gotovina", category: "gotovina", shares: 0, currency: "NOK", marketValueNok: 233.35, region: "—" },
];

export function totalValueNok(holdings: PortfolioHolding[]): number {
  return holdings.reduce((sum, h) => sum + (h.marketValueNok || 0), 0);
}

// ---------- Koncentracija i diverzifikacija ----------

export interface WeightRow {
  label: string;
  weight: number; // 0-1
  valueNok: number;
}

export interface ConcentrationFlag {
  label: string;
  severity: 1 | 2 | 3;
  detail: string;
}

export interface ConcentrationResult {
  positionWeights: WeightRow[];
  sectorWeights: WeightRow[];
  currencyWeights: WeightRow[];
  categoryWeights: WeightRow[];
  flags: ConcentrationFlag[];
}

function toWeightRows(valuesByLabel: Map<string, number>, total: number): WeightRow[] {
  return Array.from(valuesByLabel.entries())
    .map(([label, valueNok]) => ({ label, valueNok, weight: total > 0 ? valueNok / total : 0 }))
    .sort((a, b) => b.weight - a.weight);
}

export function analyzeConcentration(
  holdings: PortfolioHolding[],
  sectorByTicker: Map<string, string | null>
): ConcentrationResult {
  const total = totalValueNok(holdings);
  const flags: ConcentrationFlag[] = [];

  const positionWeights = toWeightRows(
    new Map(holdings.map((h) => [h.name, h.marketValueNok])),
    total
  );

  const sectorMap = new Map<string, number>();
  const currencyMap = new Map<string, number>();
  const categoryMap = new Map<string, number>();
  for (const h of holdings) {
    const sector = (h.ticker && sectorByTicker.get(h.ticker)) || (h.category === "fond" ? h.region || "Fond (sektor N/A)" : h.category === "gotovina" ? "Gotovina" : "Nepoznat sektor");
    sectorMap.set(sector, (sectorMap.get(sector) || 0) + h.marketValueNok);
    currencyMap.set(h.currency, (currencyMap.get(h.currency) || 0) + h.marketValueNok);
    const catLabel = h.category === "akcija" ? "Pojedinačne akcije" : h.category === "fond" ? "Fondovi" : "Gotovina";
    categoryMap.set(catLabel, (categoryMap.get(catLabel) || 0) + h.marketValueNok);
  }
  const sectorWeights = toWeightRows(sectorMap, total);
  const currencyWeights = toWeightRows(currencyMap, total);
  const categoryWeights = toWeightRows(categoryMap, total);

  for (const p of positionWeights) {
    if (p.weight > 0.2) {
      flags.push({ label: `Velika koncentracija u jednoj poziciji: ${p.label}`, severity: 3, detail: `${(p.weight * 100).toFixed(1)}% portfelja — pad ove jedne akcije nesrazmerno utiče na ceo portfolio.` });
    } else if (p.weight > 0.12) {
      flags.push({ label: `Povišena koncentracija: ${p.label}`, severity: 2, detail: `${(p.weight * 100).toFixed(1)}% portfelja.` });
    }
  }
  for (const s of sectorWeights) {
    if (s.weight > 0.35 && s.label !== "Gotovina") {
      flags.push({ label: `Sektorska koncentracija: ${s.label}`, severity: s.weight > 0.5 ? 3 : 2, detail: `${(s.weight * 100).toFixed(1)}% portfelja u jednom sektoru — slabije diverzifikovano od širokog tržišnog indeksa.` });
    }
  }
  const nokWeight = currencyMap.get("NOK") || 0;
  if (total > 0 && nokWeight / total > 0.5) {
    flags.push({ label: "Visoka izloženost norveškoj kruni (NOK)", severity: 2, detail: `${((nokWeight / total) * 100).toFixed(1)}% portfelja u NOK-denominovanoj imovini — koncentrisano na jednu malu, energetski zavisnu ekonomiju.` });
  }

  return { positionWeights, sectorWeights, currencyWeights, categoryWeights, flags: flags.sort((a, b) => b.severity - a.severity) };
}

// ---------- Stres-test (beta-ponderisan scenario, deterministički) ----------

export interface StressScenario {
  label: string;
  marketMovePercent: number; // npr. -10
  portfolioImpactPercent: number | null;
  portfolioImpactNok: number | null;
}

const DEFAULT_SCENARIOS: { label: string; movePercent: number }[] = [
  { label: "Korekcija tržišta -10%", movePercent: -10 },
  { label: "Medveđe tržište -20%", movePercent: -20 },
  { label: "Ozbiljan pad -35%", movePercent: -35 },
];

// Beta akcijskih fondova se aproksimira na 1 (široko diverzifikovani, prate
// tržište), gotovina na 0 (ne reaguje na pad tržišta) — pojedinačne akcije
// koriste stvarnu beta vrednost iz modela, kad je dostupna.
export function stressTestPortfolio(
  holdings: PortfolioHolding[],
  betaByTicker: Map<string, number | null>,
  scenarios: { label: string; movePercent: number }[] = DEFAULT_SCENARIOS
): { scenarios: StressScenario[]; portfolioBeta: number | null } {
  const total = totalValueNok(holdings);
  if (total <= 0) return { scenarios: scenarios.map((s) => ({ label: s.label, marketMovePercent: s.movePercent, portfolioImpactPercent: null, portfolioImpactNok: null })), portfolioBeta: null };

  let weightedBeta = 0;
  for (const h of holdings) {
    const weight = h.marketValueNok / total;
    const knownBeta = h.ticker ? betaByTicker.get(h.ticker) : null;
    const beta = h.category === "gotovina" ? 0 : h.category === "fond" ? 1 : knownBeta ?? 1;
    weightedBeta += weight * beta;
  }

  const results = scenarios.map((s) => {
    const impactPercent = weightedBeta * s.movePercent;
    return {
      label: s.label,
      marketMovePercent: s.movePercent,
      portfolioImpactPercent: impactPercent,
      portfolioImpactNok: (impactPercent / 100) * total,
    };
  });

  return { scenarios: results, portfolioBeta: weightedBeta };
}

// ---------- Tehnički snimak (deterministički, iz mesečne istorije cena) ----------

export interface HistoricalPoint {
  timestamp: number;
  close: number;
}

export interface TechnicalSnapshot {
  trend: "rastući" | "opadajući" | "bočni" | "nepoznato";
  detail: string;
}

export function computeTechnicalSnapshot(points: HistoricalPoint[]): TechnicalSnapshot {
  if (points.length < 4) {
    return { trend: "nepoznato", detail: "Nedovoljno istorijskih podataka o ceni." };
  }
  const current = points[points.length - 1].close;
  const last3 = points.slice(-3);
  const last12 = points.slice(-12);
  const sma3 = last3.reduce((a, p) => a + p.close, 0) / last3.length;
  const sma12 = last12.reduce((a, p) => a + p.close, 0) / last12.length;

  let trend: TechnicalSnapshot["trend"];
  if (current > sma3 && sma3 > sma12 * 1.02) {
    trend = "rastući";
  } else if (current < sma3 && sma3 < sma12 * 0.98) {
    trend = "opadajući";
  } else {
    trend = "bočni";
  }
  return {
    trend,
    detail: `Cena ${current.toFixed(2)} naspram proseka poslednja ~3 meseca (${sma3.toFixed(2)}) i ~12 meseci (${sma12.toFixed(2)}).`,
  };
}
