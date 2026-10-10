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

// Prefilled iz stvarnog izveštaja korisnika (Nordnet, 9.10.2026, dva računa) —
// samo početna tačka, korisnik može dodati/ukloniti/izmeniti pozicije. Jedina
// stvarna promena pozicije od prethodnog izveštaja (2.10.2026): American
// Express je dokupljen (2 → 5 akcija). Ostale razlike u vrednosti su samo
// pomeranje cena; KLP AksjeAsia i Nordnet Emerging Markets Indeks imaju
// malo više jedinica (automatska mesečna kupovina/reinvestirana dividenda).
// Gotovina je zbir oba računa (ASK 26,77 + Investeringskonto Zero 1 404,90).
export const DEFAULT_HOLDINGS: PortfolioHolding[] = [
  { id: "aker", ticker: "AKER.OL", name: "Aker", category: "akcija", shares: 6, currency: "NOK", marketValueNok: 8160.0 },
  { id: "eqnr", ticker: "EQNR.OL", name: "Equinor", category: "akcija", shares: 46, currency: "NOK", marketValueNok: 19223.4 },
  { id: "nong", ticker: "NONG.OL", name: "SpareBank 1 Nord-Norge", category: "akcija", shares: 50, currency: "NOK", marketValueNok: 8413.0 },
  { id: "var", ticker: "VAR.OL", name: "Vår Energi", category: "akcija", shares: 200, currency: "NOK", marketValueNok: 10640.0 },
  { id: "klp-asia", ticker: null, name: "KLP AksjeAsia Indeks N", category: "fond", shares: 5.89, currency: "NOK", marketValueNok: 10106.78, region: "Azija (razvijena tržišta)" },
  { id: "nn-em", ticker: null, name: "Nordnet Emerging Markets Indeks", category: "fond", shares: 129.52, currency: "NOK", marketValueNok: 22264.66, region: "Tržišta u razvoju" },
  { id: "googl", ticker: "GOOGL", name: "Alphabet A", category: "akcija", shares: 4, currency: "USD", marketValueNok: 13450.7 },
  { id: "amzn", ticker: "AMZN", name: "Amazon.com", category: "akcija", shares: 8, currency: "USD", marketValueNok: 20075.45 },
  { id: "axp", ticker: "AXP", name: "American Express", category: "akcija", shares: 5, currency: "USD", marketValueNok: 14734.05 },
  { id: "ko", ticker: "KO", name: "Coca-Cola", category: "akcija", shares: 18, currency: "USD", marketValueNok: 15155.27 },
  { id: "invea", ticker: "INVE-A.ST", name: "Investor A", category: "akcija", shares: 18, currency: "SEK", marketValueNok: 6986.3 },
  { id: "ma", ticker: "MA", name: "Mastercard", category: "akcija", shares: 3, currency: "USD", marketValueNok: 16900.58 },
  { id: "mrk", ticker: "MRK", name: "Merck & Co", category: "akcija", shares: 14, currency: "USD", marketValueNok: 19491.77 },
  { id: "meta", ticker: "META", name: "Meta Platforms A", category: "akcija", shares: 3, currency: "USD", marketValueNok: 20616.39 },
  { id: "msft", ticker: "MSFT", name: "Microsoft", category: "akcija", shares: 10, currency: "USD", marketValueNok: 51164.93 },
  { id: "nvda", ticker: "NVDA", name: "NVIDIA", category: "akcija", shares: 14, currency: "USD", marketValueNok: 30694.18 },
  { id: "tsm", ticker: "TSM", name: "Taiwan Semiconductor ADR", category: "akcija", shares: 3, currency: "USD", marketValueNok: 13004.04 },
  { id: "v", ticker: "V", name: "Visa", category: "akcija", shares: 5, currency: "USD", marketValueNok: 18428.92 },
  { id: "klp-global", ticker: null, name: "KLP AksjeGlobal Indeks N", category: "fond", shares: 1.71, currency: "NOK", marketValueNok: 3266.87, region: "Globalno (razvijena tržišta)" },
  { id: "cash", ticker: null, name: "Gotovina", category: "gotovina", shares: 0, currency: "NOK", marketValueNok: 1431.67, region: "—" },
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

// ---------- Zaključak o kvalitetu portfelja kao celini (deterministički) ----------
//
// Ne nov, nezavisan sud — samo agregacija već izračunatih brojeva (ponderisana
// ocena KVALITETA KOMPANIJA — poslovanje/moat/menadžment, namerno bez rasta,
// rizika i valuacije — ponderisana izloženost crvenim zastavicama, upozorenja
// o koncentraciji, beta/stres-test) u jedan kratak, citirajući zaključak, plus
// jedan konkretan predlog za poboljšanje izveden iz tih istih brojeva.

export interface PortfolioPositionQuality {
  name: string;
  weight: number; // 0-1, udeo u ukupnoj vrednosti portfelja
  rating: string; // FundamentalsRating kao string ("Jaki"/"Osrednji"/"Slabi"/"Nedovoljno podataka")
  qualityScore: number | null;
}

export interface PortfolioConclusionInput {
  qualityScore: number | null;
  qualityCoveredWeight: number;
  flaggedWeight: number;
  weightedRedFlags: number;
  concentrationFlags: ConcentrationFlag[];
  portfolioBeta: number | null;
  bearMarketImpactPercent: number | null; // iz scenarija -20%
  positions: PortfolioPositionQuality[];
}

export interface PortfolioConclusion {
  verdict: "Snažan portfolio" | "Solidan portfolio, uz par tačaka pažnje" | "Portfolio zahteva pažnju" | "Nedovoljno podataka";
  points: string[];
  suggestion: string;
}

// Minimalni udeo pozicije da bi uopšte bila kandidat za konkretan predlog —
// slaba pozicija koja čini 0,3% portfelja nije prioritet za akciju.
const MIN_WEIGHT_FOR_SUGGESTION = 0.02;

function buildSuggestion(
  severeConcentration: ConcentrationFlag[],
  flaggedWeight: number,
  positions: PortfolioPositionQuality[]
): string {
  if (severeConcentration.length > 0) {
    const f = severeConcentration[0];
    return `Prioritet: smanji izloženost gde upozorenje stoji najjače — ${f.label} (${f.detail}). Ovo je trenutno najveći strukturni rizik, pre nego kvalitet bilo koje pojedinačne kompanije.`;
  }

  const weakCandidates = positions
    .filter((p) => p.weight >= MIN_WEIGHT_FOR_SUGGESTION && (p.rating === "Slabi" || (p.qualityScore != null && p.qualityScore <= 2)))
    .sort((a, b) => b.weight - a.weight);
  if (weakCandidates.length > 0) {
    const w = weakCandidates[0];
    return `Razmisli da preispitaš poziciju ${w.name} (${(w.weight * 100).toFixed(1)}% portfelja) — fundamenti su ocenjeni kao "${w.rating}"${
      w.qualityScore != null ? ` (ocena kvaliteta kompanije ${w.qualityScore.toFixed(1)}/5)` : ""
    }, najslabija pozicija u portfelju po ovom kriterijumu. Ne mora značiti prodaju — prvo pogledaj detalje na Pregledu te kompanije i proveri da li se slabost odnosi na privremen problem ili strukturnu promenu.`;
  }

  if (flaggedWeight > 0.3) {
    return `Nema pojedinačne pozicije ocenjene kao "Slabi" po kvalitetu, ali ${(flaggedWeight * 100).toFixed(
      0
    )}% portfelja ima bar jednu ozbiljnu ili umerenu crvenu zastavicu (ne čisto informativnu) — pregledaj tabelu "Sud po poziciji" i prioritizuj pozicije sa najviše zastavica.`;
  }

  const bestOsrednji = positions
    .filter((p) => p.rating === "Osrednji" && p.weight >= MIN_WEIGHT_FOR_SUGGESTION)
    .sort((a, b) => b.weight - a.weight)[0];
  if (bestOsrednji) {
    return `Nema hitnih slabosti — najveća pozicija sa samo osrednjim fundamentima je ${bestOsrednji.name} (${(bestOsrednji.weight * 100).toFixed(
      1
    )}% portfelja). Nije nužno zameniti, ali je kandidat da se prati pažljivije od pozicija ocenjenih kao "Jaki".`;
  }

  return "Nema očiglednog slabog člana po kvalitetu kompanije — fokus trenutno može biti na redovnom praćenju (nove crvene zastavice, promene fundamenata) umesto na zameni postojećih pozicija.";
}

export function buildPortfolioConclusion(input: PortfolioConclusionInput): PortfolioConclusion {
  const { qualityScore, qualityCoveredWeight, flaggedWeight, weightedRedFlags, concentrationFlags, portfolioBeta, bearMarketImpactPercent, positions } = input;

  if (qualityScore == null || qualityCoveredWeight === 0) {
    return {
      verdict: "Nedovoljno podataka",
      points: ["Nema dovoljno pokrivenih pozicija (sa tikerom i uspešnom analizom) da bi se izveo zaključak o kvalitetu portfelja kao celine."],
      suggestion: "Pokreni analizu portfelja da bi se izračunala ocena kvaliteta kompanija i dobio konkretan predlog.",
    };
  }

  const severeConcentration = concentrationFlags.filter((f) => f.severity >= 3);
  const moderateConcentration = concentrationFlags.filter((f) => f.severity === 2);

  let points = 0;
  if (qualityScore >= 4) points += 2;
  else if (qualityScore >= 3) points += 1;
  else points -= 1;

  if (flaggedWeight <= 0.1) points += 1;
  else if (flaggedWeight > 0.4) points -= 1;

  if (severeConcentration.length > 0) points -= 1;

  const verdict: PortfolioConclusion["verdict"] =
    points >= 3 ? "Snažan portfolio" : points >= 1 ? "Solidan portfolio, uz par tačaka pažnje" : "Portfolio zahteva pažnju";

  const sentences: string[] = [];

  sentences.push(
    `Ponderisana ocena kvaliteta kompanija u portfelju (poslovanje, moat, menadžment — bez rasta/rizika/valuacije) je ${qualityScore.toFixed(1)}/5 (pokriva ${(qualityCoveredWeight * 100).toFixed(0)}% portfelja po vrednosti) — ${
      qualityScore >= 4
        ? "u proseku kompanije visokog kvaliteta po sveobuhvatnom modelu."
        : qualityScore >= 3
          ? "u proseku solidne, ali ne izuzetne kompanije."
          : "u proseku kompanije slabijeg kvaliteta — vredi preispitati najslabije karike u tabeli \"Sud po poziciji\"."
    }`
  );

  if (flaggedWeight > 0) {
    sentences.push(
      `${(flaggedWeight * 100).toFixed(0)}% portfelja (po vrednosti, od pokrivenog dela) ima bar jednu ozbiljnu ili umerenu crvenu zastavicu iz modela (čisto informativne napomene se ne broje), ponderisano ${weightedRedFlags.toFixed(2)} zastavice po poziciji — ${
        flaggedWeight > 0.4
          ? "značajan deo portfelja trenutno nosi bar jedan konkretan, modelom detektovan rizik."
          : "ograničeno na manji deo portfelja."
      }`
    );
  } else {
    sentences.push("Nijedna pozicija sa dostupnim podacima trenutno ne nosi ozbiljnu ili umerenu crvenu zastavicu iz modela (čisto informativne napomene ne računaju se kao rizik).");
  }

  if (severeConcentration.length > 0) {
    sentences.push(
      `${severeConcentration.length === 1 ? "Postoji jedno ozbiljno upozorenje" : `Postoje ${severeConcentration.length} ozbiljna upozorenja`} o koncentraciji (${severeConcentration
        .map((f) => f.label)
        .join(", ")}) — ovo je trenutno najveći strukturni rizik portfelja, nezavisno od kvaliteta pojedinačnih kompanija.`
    );
  } else if (moderateConcentration.length > 0) {
    sentences.push(`Postoji ${moderateConcentration.length} povišeno (ne ozbiljno) upozorenje o koncentraciji — vredi pratiti, ali nije hitno.`);
  } else {
    sentences.push("Nema upozorenja o koncentraciji iznad pragova modela — portfolio je razumno diverzifikovan po pozicijama, sektorima i valuti.");
  }

  if (portfolioBeta != null && bearMarketImpactPercent != null) {
    sentences.push(
      `Ponderisana beta portfelja je ${portfolioBeta.toFixed(2)} — u scenariju medveđeg tržišta od -20% model procenjuje uticaj od otprilike ${bearMarketImpactPercent.toFixed(
        0
      )}% na ukupnu vrednost portfelja (detalji u stres-testu iznad).`
    );
  }

  const suggestion = buildSuggestion(severeConcentration, flaggedWeight, positions);

  return { verdict, points: sentences, suggestion };
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
