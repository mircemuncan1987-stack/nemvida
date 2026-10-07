// "Šta sledeće dokupiti?" — nezavisna valuacija napravljena SAMO za poređenje
// pozicija UNUTAR portfelja kad se ulaže svež mesečni kapital, odvojena od
// postojećeg sveobuhvatnog modela (lib/model.ts / lib/buildModel.ts) koji
// odlučuje "kupi/drži/izbegavaj" za pojedinačnu akciju na /model i /lista.
//
// Razlog za poseban model, a ne recikliranje postojećeg skora: cilj ovde nije
// "da li je ovo dobra akcija za bilo koga", nego uži i specifičniji zadatak —
// "od desetak akcija koje korisnik VEĆ poseduje i smatra dovoljno dobrim da
// bude u portfelju, koja je trenutno najjeftinija u odnosu na svoj sektor i
// svoj potencijal rasta". Zato su pragovi ovde stroži i uže podešeni za
// rangiranje MALOG, već provereno-kvalitetnog skupa akcija, ne za filtriranje
// celog tržišta.
//
// Isti princip kao svuda na sajtu: fiksni, dokumentovani pragovi nad
// proverljivim brojevima, nema slobodne AI procene.

export interface BuyCandidateInput {
  ticker: string;
  name: string;
  sector: string | null;
  peRatio: number | null;
  pegRatio: number | null;
  evToEbitda: number | null;
  freeCashflowTtm: number | null;
  marketCap: number | null;
  analystLongTermGrowth: number | null; // Yahoo earningsTrend +5y, decimalno (0.12 = 12%)
  revenueGrowthTtm: number | null; // decimalno
  sectorPeMedian: number | null; // orijentaciona medijana P/E za sektor (ista tabela kao ostatak sajta)
  weightInPortfolio: number; // 0-1, trenutni udeo u portfelju — samo informativno, ne utiče na rang
}

export type BuyComponentTone = "povoljno" | "neutralno" | "skupo" | "nepoznato";

export interface BuyComponent {
  label: string;
  value: string;
  tone: BuyComponentTone;
  detail: string;
}

export interface BuyCandidateResult {
  ticker: string;
  name: string;
  sector: string | null;
  weightInPortfolio: number;
  valuationComponents: BuyComponent[];
  growthComponent: BuyComponent;
  cheapnessScore: number | null; // -1..+1, prosek dostupnih valuacionih komponenti
  growthScore: number | null; // -1..+1
  combinedScore: number | null; // -1..+1, cheapness*0.6 + growth*0.4
  verdict: "Atraktivno za dokupovanje" | "Fer vrednovano" | "Skupo" | "Nedovoljno podataka";
  dataCoverage: number; // broj dostupnih valuacionih komponenti (0-4), za prikaz pouzdanosti
}

export interface BuyRecommendation {
  verdict: "Postoji atraktivna prilika" | "Sve pozicije su trenutno skupe ili fer vrednovane — razmisli o čekanju" | "Nedovoljno podataka";
  topPick: BuyCandidateResult | null;
  ranked: BuyCandidateResult[];
  note: string;
}

function fcfYield(fcf: number | null, marketCap: number | null): number | null {
  if (fcf == null || marketCap == null || marketCap <= 0) return null;
  return fcf / marketCap;
}

// Komponenta 1 — P/E u odnosu na sektor (ili na generički prag 20× ako
// medijana sektora nije poznata). Namerno BLAŽI apsolutni prag od sektorske
// medijane (±15%) nego kod opšteg modela, jer ovde upoređujemo akcije koje su
// već prošle kvalitativnu proveru — razlike od par procenata nisu bitne,
// bitno je ko je JASNO jeftiniji od ostalih.
function scorePe(peRatio: number | null, sectorPeMedian: number | null): BuyComponent {
  if (peRatio == null) return { label: "P/E naspram sektora", value: "—", tone: "nepoznato", detail: "P/E nije dostupan." };
  const benchmark = sectorPeMedian ?? 20;
  const benchmarkLabel = sectorPeMedian != null ? "medijane sektora" : "generičkog praga (sektor nepoznat)";
  const ratio = peRatio / benchmark;
  if (ratio < 0.85) {
    return { label: "P/E naspram sektora", value: `${peRatio.toFixed(1)}×`, tone: "povoljno", detail: `${((1 - ratio) * 100).toFixed(0)}% ispod ${benchmarkLabel} (${benchmark.toFixed(0)}×).` };
  }
  if (ratio > 1.15) {
    return { label: "P/E naspram sektora", value: `${peRatio.toFixed(1)}×`, tone: "skupo", detail: `${((ratio - 1) * 100).toFixed(0)}% iznad ${benchmarkLabel} (${benchmark.toFixed(0)}×).` };
  }
  return { label: "P/E naspram sektora", value: `${peRatio.toFixed(1)}×`, tone: "neutralno", detail: `Blizu ${benchmarkLabel} (${benchmark.toFixed(0)}×).` };
}

// Komponenta 2 — PEG. Pragovi stroži nego opšti filter valuacije na sajtu
// (0,5/2,0) — ovde je 0,5/1,5, jer se rangira uži skup već odabranih
// kompanija pa se traži jasnija razlika da bi poredak imao smisla.
function scorePeg(pegRatio: number | null): BuyComponent {
  if (pegRatio == null) return { label: "PEG", value: "—", tone: "nepoznato", detail: "PEG nije dostupan." };
  if (pegRatio < 0.5) return { label: "PEG", value: pegRatio.toFixed(2), tone: "povoljno", detail: "Ispod 0,5 — cena jasno ispod procenjenog rasta zarade." };
  if (pegRatio > 1.5) return { label: "PEG", value: pegRatio.toFixed(2), tone: "skupo", detail: "Iznad 1,5 — cena je napred u odnosu na procenjeni rast zarade." };
  return { label: "PEG", value: pegRatio.toFixed(2), tone: "neutralno", detail: "Između 0,5 i 1,5 — cena je u skladu sa rastom." };
}

// Komponenta 3 — EV/EBITDA. Takođe stroži pragovi (12×/20×) nego opšti model
// (15×/30×), iz istog razloga kao kod PEG-a iznad.
function scoreEvEbitda(evToEbitda: number | null): BuyComponent {
  if (evToEbitda == null) return { label: "EV/EBITDA", value: "—", tone: "nepoznato", detail: "EV/EBITDA nije dostupan." };
  if (evToEbitda < 12) return { label: "EV/EBITDA", value: `${evToEbitda.toFixed(1)}×`, tone: "povoljno", detail: "Ispod 12× — razumna cena za operativnu zaradu." };
  if (evToEbitda > 20) return { label: "EV/EBITDA", value: `${evToEbitda.toFixed(1)}×`, tone: "skupo", detail: "Iznad 20× — uračunava solidno izvršenje unapred." };
  return { label: "EV/EBITDA", value: `${evToEbitda.toFixed(1)}×`, tone: "neutralno", detail: "Između 12× i 20× — umereno." };
}

// Komponenta 4 — FCF prinos (slobodan novčani tok / tržišna kapitalizacija).
// Pragovi 5%/2% — malo stroži od opšteg modela (6%/2,5%) na gornjoj strani.
function scoreFcfYield(yieldValue: number | null): BuyComponent {
  if (yieldValue == null) return { label: "FCF prinos", value: "—", tone: "nepoznato", detail: "Slobodan novčani tok ili tržišna kapitalizacija nisu dostupni." };
  const pct = `${(yieldValue * 100).toFixed(1)}%`;
  if (yieldValue < 0) return { label: "FCF prinos", value: pct, tone: "skupo", detail: "Negativan — kompanija trenutno troši više gotovine nego što generiše." };
  if (yieldValue >= 0.05) return { label: "FCF prinos", value: pct, tone: "povoljno", detail: "5% ili više — generiše mnogo gotovine u odnosu na cenu." };
  if (yieldValue >= 0.02) return { label: "FCF prinos", value: pct, tone: "neutralno", detail: "Između 2% i 5% — prosečno." };
  return { label: "FCF prinos", value: pct, tone: "skupo", detail: "Ispod 2% — nizak prinos u odnosu na cenu." };
}

// Rast — koristi analitičarsku petogodišnju procenu rasta zarade kao primarni
// izvor (direktno gleda unapred), a rast prihoda (TTM) kao rezervu kad
// procena analitičara nije dostupna. Pragovi 12%/4% — fiksni, ne zavise od
// sektora (rast se ovde tretira kao apsolutna poželjna brzina, ne relativna
// prema industriji).
function scoreGrowth(analystLongTermGrowth: number | null, revenueGrowthTtm: number | null): BuyComponent {
  const growth = analystLongTermGrowth ?? revenueGrowthTtm;
  const source = analystLongTermGrowth != null ? "procena analitičara (5G)" : revenueGrowthTtm != null ? "rast prihoda (TTM)" : null;
  if (growth == null || source == null) {
    return { label: "Potencijal rasta", value: "—", tone: "nepoznato", detail: "Ni procena analitičara ni rast prihoda nisu dostupni." };
  }
  const pct = `${(growth * 100).toFixed(1)}%`;
  if (growth >= 0.12) return { label: "Potencijal rasta", value: pct, tone: "povoljno", detail: `${pct} (${source}) — iznad 12%, visok potencijal rasta.` };
  if (growth >= 0.04) return { label: "Potencijal rasta", value: pct, tone: "neutralno", detail: `${pct} (${source}) — umeren rast, između 4% i 12%.` };
  return { label: "Potencijal rasta", value: pct, tone: "skupo", detail: `${pct} (${source}) — ispod 4%, slab potencijal rasta.` };
}

function toneToNumber(tone: BuyComponentTone): number | null {
  if (tone === "povoljno") return 1;
  if (tone === "skupo") return -1;
  if (tone === "neutralno") return 0;
  return null;
}

export function evaluateBuyCandidate(input: BuyCandidateInput): BuyCandidateResult {
  const components = [
    scorePe(input.peRatio, input.sectorPeMedian),
    scorePeg(input.pegRatio),
    scoreEvEbitda(input.evToEbitda),
    scoreFcfYield(fcfYield(input.freeCashflowTtm, input.marketCap)),
  ];
  const growthComponent = scoreGrowth(input.analystLongTermGrowth, input.revenueGrowthTtm);

  const cheapnessValues = components.map((c) => toneToNumber(c.tone)).filter((v): v is number => v != null);
  const cheapnessScore = cheapnessValues.length ? cheapnessValues.reduce((a, b) => a + b, 0) / cheapnessValues.length : null;
  const growthScore = toneToNumber(growthComponent.tone);

  let combinedScore: number | null = null;
  if (cheapnessScore != null && growthScore != null) {
    combinedScore = cheapnessScore * 0.6 + growthScore * 0.4;
  } else if (cheapnessScore != null) {
    combinedScore = cheapnessScore * 0.6; // nepotpuno, ali bolje nego ništa — dataCoverage ispod prikazuje da rastu podatak nedostaje
  }

  const dataCoverage = cheapnessValues.length;

  let verdict: BuyCandidateResult["verdict"];
  if (dataCoverage < 2 || combinedScore == null) {
    verdict = "Nedovoljno podataka";
  } else if (combinedScore >= 0.35) {
    verdict = "Atraktivno za dokupovanje";
  } else if (combinedScore < -0.15) {
    verdict = "Skupo";
  } else {
    verdict = "Fer vrednovano";
  }

  return {
    ticker: input.ticker,
    name: input.name,
    sector: input.sector,
    weightInPortfolio: input.weightInPortfolio,
    valuationComponents: components,
    growthComponent,
    cheapnessScore,
    growthScore,
    combinedScore,
    verdict,
    dataCoverage,
  };
}

// Rangira sve pozicije i bira preporuku. Ne uzima u obzir trenutnu težinu u
// portfelju pri rangiranju (korisnik je tražio isključivo cenu/multiplikatore
// i rast) — težina se nosi kroz rezultat samo kao informacija prikazana uz
// ime pozicije.
export function buildBuyRecommendation(candidates: BuyCandidateInput[]): BuyRecommendation {
  const evaluated = candidates.map(evaluateBuyCandidate);
  const ranked = evaluated
    .filter((c) => c.combinedScore != null)
    .sort((a, b) => (b.combinedScore ?? -Infinity) - (a.combinedScore ?? -Infinity));

  if (ranked.length === 0) {
    return {
      verdict: "Nedovoljno podataka",
      topPick: null,
      ranked: evaluated,
      note: "Nema dovoljno podataka o multiplikatorima za pozicije u portfelju da bi se formirala preporuka.",
    };
  }

  const best = ranked[0];
  if (best.verdict === "Atraktivno za dokupovanje") {
    return {
      verdict: "Postoji atraktivna prilika",
      topPick: best,
      ranked: evaluated,
      note: `${best.name} trenutno najbolje spaja povoljnu cenu (naspram sektora i sopstvenih multiplikatora) i potencijal rasta među pozicijama u portfelju.`,
    };
  }

  return {
    verdict: "Sve pozicije su trenutno skupe ili fer vrednovane — razmisli o čekanju",
    topPick: null,
    ranked: evaluated,
    note: `Ni jedna pozicija trenutno ne ispunjava prag za "atraktivno za dokupovanje" (najbolja je ${best.name}, ocena ${best.verdict.toLowerCase()}) — razmisli da sveži kapital ovog meseca ostane u gotovini/fondu dok se cene ne povoljnije poravnaju, umesto da se dokupuje po trenutnim cenama.`,
  };
}
