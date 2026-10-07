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
// Dve posebne korekcije, obe dodate nakon konkretne primedbe korisnika:
//
// 1. CIKLIČNI RIZIK (scoreCyclicalRisk) — kod ciklično osetljivih sektora
//    (energetika, sirovine) nizak trailing P/E na VRHU ciklusa cena robe ne
//    znači da je akcija jeftina, već da je zarada privremeno naduvana cenom
//    robe ("value trap"). Konkretan primer: Vår Energi je naftna kompanija
//    čiji je trailing P/E nizak upravo zato što su cene nafte/akcija blizu
//    rekordnih nivoa, ne zato što je akcija stvarno povoljna. Zato se
//    posebno proverava da li je cena blizu višegodišnjeg maksimuma, i ako je
//    sektor ciklično osetljiv, pozicija NE MOŽE biti "Atraktivno za
//    dokupovanje" bez obzira na ostale multiplikatore.
//
// 2. NAV ZA HOLDING KOMPANIJE (scoreNavDiscount) — za Aker ASA i Investor AB,
//    P/E, PEG i EV/EBITDA NISU merodavni, jer je njihova "zarada" uglavnom
//    računovodstveni dobitak/gubitak na portfolio ulaganja, ne operativni
//    poslovni rezultat. Standardna, ispravna mera za holding kompanije je
//    diskont/premija cene akcije na NAV (Net Asset Value) po akciji koji
//    kompanija sama objavljuje kvartalno. Pošto ne postoji besplatan, javni
//    API koji vraća NAV za ove dve kompanije, vrednosti su REČNO UNETE iz
//    njihovih poslednjih objavljenih kvartalnih izveštaja (vidi
//    HOLDING_COMPANY_NAV ispod) — baš kao DEFAULT_HOLDINGS u lib/portfolio.ts,
//    ovo zahteva ručno ažuriranje kad kompanija objavi sledeći kvartalni
//    izveštaj (Aker ASA i Investor AB izveštavaju NAV kvartalno).
//
// Isti princip kao svuda na sajtu: fiksni, dokumentovani pragovi nad
// proverljivim brojevima, nema slobodne AI procene.

export interface BuyCandidateInput {
  ticker: string;
  name: string;
  sector: string | null;
  currentPrice: number | null;
  peRatio: number | null;
  pegRatio: number | null;
  evToEbitda: number | null;
  freeCashflowTtm: number | null;
  marketCap: number | null;
  analystLongTermGrowth: number | null; // Yahoo earningsTrend +5y, decimalno (0.12 = 12%)
  revenueGrowthTtm: number | null; // decimalno
  sectorPeMedian: number | null; // orijentaciona medijana P/E za sektor (ista tabela kao ostatak sajta)
  historicalHighPrice: number | null; // maksimum zatvaranja iz raspoložive (mesečne, "max" range) cenovne istorije
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
  isHoldingCompany: boolean;
  valuationComponents: BuyComponent[];
  growthComponent: BuyComponent;
  cyclicalWarning: boolean; // true kad je cikličan rizik oborio ocenu na "Fer vrednovano" ili niže
  narrative: BuyNarrative; // tri konkretna dela (cena/rast/zaključak) — ne nov sud, samo strukturiran tekstualni spoj već izračunatih brojeva
  cheapnessScore: number | null; // -1..+1, prosek dostupnih valuacionih komponenti
  growthScore: number | null; // -1..+1
  combinedScore: number | null; // -1..+1, cheapness*0.6 + growth*0.4
  verdict: "Atraktivno za dokupovanje" | "Fer vrednovano" | "Skupo" | "Nedovoljno podataka";
  dataCoverage: number; // broj dostupnih valuacionih komponenti, za prikaz pouzdanosti
}

export interface BuyRecommendation {
  verdict: "Postoji atraktivna prilika" | "Sve pozicije su trenutno skupe ili fer vrednovane — razmisli o čekanju" | "Nedovoljno podataka";
  topPick: BuyCandidateResult | null;
  ranked: BuyCandidateResult[];
  note: string;
}

// ---------- NAV za holding kompanije (ručno ažurirano iz kvartalnih izveštaja) ----------
//
// IZVOR I DATUM SU DEO PODATKA — kad kompanija objavi sledeći kvartal, ove
// brojke treba ručno osvežiti (isti princip kao portfolio PDF uvoz).
const HOLDING_COMPANY_NAV: Record<string, { navPerShare: number; currency: string; asOf: string; source: string }> = {
  "AKER.OL": { navPerShare: 1429, currency: "NOK", asOf: "30.6.2026 (2. kvartal 2026)", source: "Aker ASA, kvartalni izveštaj" },
  "INVE-A.ST": { navPerShare: 397, currency: "SEK", asOf: "30.6.2026 (2. kvartal 2026)", source: "Investor AB, kvartalni izveštaj" },
  "INVE-B.ST": { navPerShare: 397, currency: "SEK", asOf: "30.6.2026 (2. kvartal 2026)", source: "Investor AB, kvartalni izveštaj" },
};

// Yahoo/GICS sektori čija je zarada direktno vezana za cenu robe (nafta, gas,
// metali, rudarstvo) — kod ovih sektora trailing multiplikatori na vrhu
// ciklusa cena robe sistematski izgledaju "jeftino" iako nisu.
const CYCLICAL_COMMODITY_SECTORS = new Set(["Energy", "Basic Materials"]);

function fcfYield(fcf: number | null, marketCap: number | null): number | null {
  if (fcf == null || marketCap == null || marketCap <= 0) return null;
  return fcf / marketCap;
}

// Komponenta — P/E u odnosu na sektor (ili na generički prag 20× ako medijana
// sektora nije poznata). Namerno BLAŽI apsolutni prag od sektorske medijane
// (±15%) nego kod opšteg modela, jer ovde upoređujemo akcije koje su već
// prošle kvalitativnu proveru — razlike od par procenata nisu bitne, bitno je
// ko je JASNO jeftiniji od ostalih.
function scorePe(peRatio: number | null, sectorPeMedian: number | null): BuyComponent {
  if (peRatio == null) return { label: "P/E naspram sektora", value: "—", tone: "nepoznato", detail: "P/E nije dostupan." };
  const benchmark = sectorPeMedian ?? 20;
  const benchmarkLabel = sectorPeMedian != null ? "medijane sektora" : "generičkog praga (sektor nepoznat)";
  const ratio = peRatio / benchmark;
  if (ratio < 0.85) {
    return { label: "P/E naspram sektora", value: `${peRatio.toFixed(1)}×`, tone: "povoljno", detail: `P/E ${peRatio.toFixed(1)}× je ${((1 - ratio) * 100).toFixed(0)}% ispod ${benchmarkLabel} (${benchmark.toFixed(0)}×).` };
  }
  if (ratio > 1.15) {
    return { label: "P/E naspram sektora", value: `${peRatio.toFixed(1)}×`, tone: "skupo", detail: `P/E ${peRatio.toFixed(1)}× je ${((ratio - 1) * 100).toFixed(0)}% iznad ${benchmarkLabel} (${benchmark.toFixed(0)}×).` };
  }
  return { label: "P/E naspram sektora", value: `${peRatio.toFixed(1)}×`, tone: "neutralno", detail: `P/E ${peRatio.toFixed(1)}× je blizu ${benchmarkLabel} (${benchmark.toFixed(0)}×).` };
}

// PEG — pragovi stroži nego opšti filter valuacije na sajtu (0,5/2,0) — ovde
// je 0,5/1,5, jer se rangira uži skup već odabranih kompanija pa se traži
// jasnija razlika da bi poredak imao smisla.
function scorePeg(pegRatio: number | null): BuyComponent {
  if (pegRatio == null) return { label: "PEG", value: "—", tone: "nepoznato", detail: "PEG nije dostupan." };
  if (pegRatio < 0.5) return { label: "PEG", value: pegRatio.toFixed(2), tone: "povoljno", detail: `PEG ${pegRatio.toFixed(2)} je ispod 0,5 — cena je jasno ispod procenjenog rasta zarade.` };
  if (pegRatio > 1.5) return { label: "PEG", value: pegRatio.toFixed(2), tone: "skupo", detail: `PEG ${pegRatio.toFixed(2)} je iznad 1,5 — cena je napred u odnosu na procenjeni rast zarade.` };
  return { label: "PEG", value: pegRatio.toFixed(2), tone: "neutralno", detail: `PEG ${pegRatio.toFixed(2)} je između 0,5 i 1,5 — cena je u skladu sa rastom.` };
}

// EV/EBITDA — takođe stroži pragovi (12×/20×) nego opšti model (15×/30×), iz
// istog razloga kao kod PEG-a iznad.
function scoreEvEbitda(evToEbitda: number | null): BuyComponent {
  if (evToEbitda == null) return { label: "EV/EBITDA", value: "—", tone: "nepoznato", detail: "EV/EBITDA nije dostupan." };
  if (evToEbitda < 12) return { label: "EV/EBITDA", value: `${evToEbitda.toFixed(1)}×`, tone: "povoljno", detail: `EV/EBITDA ${evToEbitda.toFixed(1)}× je ispod 12× — razumna cena za operativnu zaradu.` };
  if (evToEbitda > 20) return { label: "EV/EBITDA", value: `${evToEbitda.toFixed(1)}×`, tone: "skupo", detail: `EV/EBITDA ${evToEbitda.toFixed(1)}× je iznad 20× — uračunava solidno izvršenje unapred.` };
  return { label: "EV/EBITDA", value: `${evToEbitda.toFixed(1)}×`, tone: "neutralno", detail: `EV/EBITDA ${evToEbitda.toFixed(1)}× je između 12× i 20× — umereno.` };
}

// FCF prinos (slobodan novčani tok / tržišna kapitalizacija). Pragovi 5%/2% —
// malo stroži od opšteg modela (6%/2,5%) na gornjoj strani.
function scoreFcfYield(yieldValue: number | null): BuyComponent {
  if (yieldValue == null) return { label: "FCF prinos", value: "—", tone: "nepoznato", detail: "Slobodan novčani tok ili tržišna kapitalizacija nisu dostupni." };
  const pct = `${(yieldValue * 100).toFixed(1)}%`;
  if (yieldValue < 0) return { label: "FCF prinos", value: pct, tone: "skupo", detail: "FCF prinos je negativan — kompanija trenutno troši više gotovine nego što generiše." };
  if (yieldValue >= 0.05) return { label: "FCF prinos", value: pct, tone: "povoljno", detail: `FCF prinos od ${pct} (5% ili više) — kompanija generiše mnogo gotovine u odnosu na cenu.` };
  if (yieldValue >= 0.02) return { label: "FCF prinos", value: pct, tone: "neutralno", detail: `FCF prinos od ${pct} — prosečno, između 2% i 5%.` };
  return { label: "FCF prinos", value: pct, tone: "skupo", detail: `FCF prinos od ${pct} je ispod 2% — nizak prinos u odnosu na cenu.` };
}

// Ciklični rizik — SAMO upozorenje (nikad "povoljno"): proverava da li je
// cena blizu višegodišnjeg maksimuma kod ciklično osetljivog sektora. Prag
// 90% maksimuma je fiksan i dokumentovan — iznad njega se trailing
// multiplikatori ne smatraju pouzdanim signalom jeftine cene.
function scoreCyclicalRisk(sector: string | null, currentPrice: number | null, historicalHighPrice: number | null): BuyComponent | null {
  if (!sector || !CYCLICAL_COMMODITY_SECTORS.has(sector) || currentPrice == null || historicalHighPrice == null || historicalHighPrice <= 0) {
    return null;
  }
  const pctOfHigh = currentPrice / historicalHighPrice;
  const pctLabel = `${(pctOfHigh * 100).toFixed(0)}% maksimuma`;
  if (pctOfHigh >= 0.9) {
    return {
      label: "Ciklični rizik",
      value: pctLabel,
      tone: "skupo",
      detail: `Cena je na ${pctLabel} iz raspoložive istorije, u sektoru (${sector}) čija je zarada direktno vezana za cenu robe — nizak trailing P/E na vrhu ciklusa često znači da je zarada privremeno naduvana cenom robe, ne da je akcija stvarno jeftina (klasična "value trap" zamka).`,
    };
  }
  return {
    label: "Ciklični rizik",
    value: pctLabel,
    tone: "neutralno",
    detail: `Ciklično osetljiv sektor (${sector}), ali cena nije blizu višegodišnjeg maksimuma (${pctLabel}) — manji rizik da trailing multiplikatori lažno izgledaju jeftino zbog vrha ciklusa.`,
  };
}

// NAV diskont/premija za holding kompanije — zamenjuje P/E/PEG/EV-EBITDA za
// tikere iz HOLDING_COMPANY_NAV. Pragovi (20%/5%) odražavaju tipičan raspon
// diskonta kod nordijskih holding kompanija — diskont ispod 5% (ili premija)
// je neobično uzak/skup, iznad 20% je neobično širok/povoljan.
function scoreNavDiscount(ticker: string, currentPrice: number | null): BuyComponent | null {
  const nav = HOLDING_COMPANY_NAV[ticker];
  if (!nav || currentPrice == null) return null;
  const discount = (nav.navPerShare - currentPrice) / nav.navPerShare; // pozitivno = cena ispod NAV
  const discountPct = `${(discount * 100).toFixed(0)}%`;
  const tone: BuyComponentTone = discount > 0.2 ? "povoljno" : discount >= 0.05 ? "neutralno" : "skupo";
  const detail =
    discount >= 0
      ? `Cena je ${discountPct} ispod NAV od ${nav.navPerShare} ${nav.currency}/akciju (stanje na ${nav.asOf}, izvor: ${nav.source}) — standardna mera vrednosti za holding kompanije, umesto P/E koji za ovaj tip kompanije nije merodavan.`
      : `Cena je ${Math.abs(discount * 100).toFixed(0)}% IZNAD NAV od ${nav.navPerShare} ${nav.currency}/akciju (stanje na ${nav.asOf}, izvor: ${nav.source}) — neobično za holding kompaniju, koje po pravilu trguju sa diskontom na NAV.`;
  return { label: "Popust/premija na NAV", value: discountPct, tone, detail };
}

// Rast — OBE veličine su već godišnje (anualizovane) stope, ne kumulativne
// za ceo period: Yahoo-va "+5y" procena (earningsTrend) je analitičarska
// procena PROSEČNOG GODIŠNJEG rasta zarade kroz narednih 5 godina (ne rast
// "ukupno za 5 godina"), a rast prihoda (TTM) je rast u odnosu na prethodnih
// 12 meseci — takođe godišnja stopa. Prva se koristi kao primarni izvor
// (direktno gleda unapred), druga kao rezerva kad procena analitičara nije
// dostupna. Pragovi 12%/4% — fiksni, ne zavise od sektora (rast se ovde
// tretira kao apsolutna poželjna brzina, ne relativna prema industriji).
function scoreGrowth(analystLongTermGrowth: number | null, revenueGrowthTtm: number | null): BuyComponent {
  const growth = analystLongTermGrowth ?? revenueGrowthTtm;
  const source = analystLongTermGrowth != null ? "procena analitičara, prosečno godišnje kroz 5 godina" : revenueGrowthTtm != null ? "rast prihoda, godišnje (TTM)" : null;
  if (growth == null || source == null) {
    return { label: "Potencijal rasta", value: "—", tone: "nepoznato", detail: "Ni procena analitičara ni rast prihoda nisu dostupni." };
  }
  const pct = `${(growth * 100).toFixed(1)}%`;
  if (growth >= 0.12) return { label: "Potencijal rasta", value: pct, tone: "povoljno", detail: `Potencijal rasta ${pct} godišnje (${source}) je iznad 12% — visok potencijal rasta.` };
  if (growth >= 0.04) return { label: "Potencijal rasta", value: pct, tone: "neutralno", detail: `Potencijal rasta ${pct} godišnje (${source}) je umeren, između 4% i 12%.` };
  return { label: "Potencijal rasta", value: pct, tone: "skupo", detail: `Potencijal rasta ${pct} godišnje (${source}) je ispod 4% — slab potencijal rasta.` };
}

// Za holding kompanije analitičarska procena rasta ZARADE (EPS) nije
// merodavna — iz istog razloga zbog kog P/E/PEG/EV-EBITDA nisu merodavni
// (scoreNavDiscount iznad): "zarada" holding kompanije uglavnom odražava
// računovodstvene dobitke/gubitke na portfolio ulaganja, ne operativni
// poslovni rast, pa bi prikazivanje tog broja kao "potencijal rasta" bilo
// zavaravajuće (konkretan povod: Investor AB je u jednom trenutku ispadao sa
// VIŠIM potencijalom rasta od NVIDIA-e, upravo zbog ovog izvora podataka).
function holdcoGrowthComponent(): BuyComponent {
  return {
    label: "Potencijal rasta",
    value: "N/P",
    tone: "nepoznato",
    detail:
      "Analitičarska procena rasta zarade i rast prihoda nisu merodavni za holding kompaniju — zarada uglavnom odražava računovodstvene dobitke/gubitke na portfolio ulaganja, ne operativni rast — zato ocena ove pozicije zavisi samo od diskonta/premije na NAV iznad.",
  };
}

function toneToNumber(tone: BuyComponentTone): number | null {
  if (tone === "povoljno") return 1;
  if (tone === "skupo") return -1;
  if (tone === "neutralno") return 0;
  return null;
}

// Tri jasno razdvojena, konkretna dela umesto jednog pasusa — svaki kaže
// nešto što chip-ovi (koji već nose iste brojeve, samo kao tooltip) sami ne
// pokazuju: KAKO se komponente slažu (ili sudaraju) i ZAŠTO je verdikt baš
// takav. Nema generičkih rečenica tipa "većina multiplikatora čita povoljno"
// — svaka linija imenuje konkretnu meru i broj.
export interface BuyNarrative {
  pricing: string;
  growth: string;
  conclusion: string;
}

function buildPricingNarrative(isHoldco: boolean, components: BuyComponent[], cyclicalComponent: BuyComponent | null): string {
  if (isHoldco) return components[0].detail;

  if (cyclicalComponent?.tone === "skupo") return cyclicalComponent.detail;

  // Samo komponente koje stvarno nose signal (povoljno/skupo) — neutralne i
  // nepoznate ne dodaju ništa korisno u tekst, dovoljno im je mesto u chip-ovima.
  const decisive = components.filter((c) => (c.tone === "povoljno" || c.tone === "skupo") && c.label !== "Ciklični rizik");
  if (decisive.length === 0) return "Ključni multiplikatori su u uobičajenom rasponu, bez jasnog signala u ni jednom pravcu.";
  return decisive.map((c) => c.detail).join(" ");
}

function buildConclusionNarrative(name: string, verdict: BuyCandidateResult["verdict"], cyclicalWarning: boolean): string {
  if (verdict === "Atraktivno za dokupovanje") {
    return `${name} je ovde ocenjen kao atraktivan za dokupovanje — cena i potencijal rasta su trenutno povoljniji nego kod ostalih pozicija u portfelju.`;
  }
  if (verdict === "Skupo") {
    return cyclicalWarning
      ? `${name} je ocenjen kao skup uprkos niskom trailing P/E — cena blizu višegodišnjeg maksimuma u ciklično osetljivom sektoru nadjačava taj signal.`
      : `${name} je ocenjen kao skup — trenutna cena ne ostavlja mnogo prostora za grešku.`;
  }
  if (verdict === "Fer vrednovano") {
    return cyclicalWarning
      ? `${name} bi po trailing multiplikatorima bio "atraktivan", ali ciklični rizik (cena blizu višegodišnjeg maksimuma) ga ovde drži na fer vrednovano.`
      : `${name} je fer vrednovan — cena je razumna, ali ne izrazito povoljna u odnosu na ostale pozicije.`;
  }
  return `Nema dovoljno podataka o multiplikatorima ili rastu za pouzdan zaključak o ${name}.`;
}

function buildNarrative(
  name: string,
  isHoldco: boolean,
  components: BuyComponent[],
  growthComponent: BuyComponent,
  cyclicalComponent: BuyComponent | null,
  verdict: BuyCandidateResult["verdict"],
  cyclicalWarning: boolean
): BuyNarrative {
  return {
    pricing: buildPricingNarrative(isHoldco, components, cyclicalComponent),
    growth: growthComponent.detail,
    conclusion: buildConclusionNarrative(name, verdict, cyclicalWarning),
  };
}

export function evaluateBuyCandidate(input: BuyCandidateInput): BuyCandidateResult {
  const navComponent = scoreNavDiscount(input.ticker, input.currentPrice);
  const isHoldco = navComponent != null;
  const cyclicalComponent = isHoldco ? null : scoreCyclicalRisk(input.sector, input.currentPrice, input.historicalHighPrice);

  const components: BuyComponent[] = isHoldco
    ? [navComponent, scoreFcfYield(fcfYield(input.freeCashflowTtm, input.marketCap))]
    : [
        scorePe(input.peRatio, input.sectorPeMedian),
        scorePeg(input.pegRatio),
        scoreEvEbitda(input.evToEbitda),
        scoreFcfYield(fcfYield(input.freeCashflowTtm, input.marketCap)),
        ...(cyclicalComponent ? [cyclicalComponent] : []),
      ];

  const growthComponent = isHoldco ? holdcoGrowthComponent() : scoreGrowth(input.analystLongTermGrowth, input.revenueGrowthTtm);

  const cheapnessValues = components.map((c) => toneToNumber(c.tone)).filter((v): v is number => v != null);
  const cheapnessScore = cheapnessValues.length ? cheapnessValues.reduce((a, b) => a + b, 0) / cheapnessValues.length : null;
  const growthScore = toneToNumber(growthComponent.tone);

  let combinedScore: number | null = null;
  if (cheapnessScore != null && growthScore != null) {
    combinedScore = cheapnessScore * 0.6 + growthScore * 0.4;
  } else if (cheapnessScore != null && isHoldco) {
    combinedScore = cheapnessScore; // rast NIJE slučajno nedostajuć podatak kod holdinga, nego strukturno neprimenljiv — ne penalizuje se skaliranjem
  } else if (cheapnessScore != null) {
    combinedScore = cheapnessScore * 0.6; // nepotpuno, ali bolje nego ništa — dataCoverage ispod prikazuje da rastu podatak nedostaje
  }

  const dataCoverage = cheapnessValues.length;

  let verdict: BuyCandidateResult["verdict"];
  if (dataCoverage < 1 || combinedScore == null) {
    verdict = "Nedovoljno podataka";
  } else if (combinedScore >= 0.35) {
    verdict = "Atraktivno za dokupovanje";
  } else if (combinedScore < -0.15) {
    verdict = "Skupo";
  } else {
    verdict = "Fer vrednovano";
  }

  // Ciklični rizik je samo upozorenje, ne nagrada — ako je cena blizu
  // višegodišnjeg maksimuma u ciklično osetljivom sektoru, pozicija ne može
  // biti "atraktivna za dokupovanje" bez obzira na ostale multiplikatore
  // (konkretan primer koji je doveo do ovog pravila: Vår Energi — nizak P/E
  // dok su cene nafte i akcije blizu rekordnih nivoa).
  let cyclicalWarning = false;
  if (cyclicalComponent?.tone === "skupo" && verdict === "Atraktivno za dokupovanje") {
    verdict = "Fer vrednovano";
    cyclicalWarning = true;
  }

  const narrative = buildNarrative(input.name, isHoldco, components, growthComponent, cyclicalComponent, verdict, cyclicalWarning);

  return {
    ticker: input.ticker,
    name: input.name,
    sector: input.sector,
    weightInPortfolio: input.weightInPortfolio,
    isHoldingCompany: isHoldco,
    valuationComponents: components,
    growthComponent,
    cyclicalWarning,
    narrative,
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
      note: `${best.name} trenutno najbolje spaja povoljnu cenu (naspram sektora i sopstvenih multiplikatora, ili naspram NAV za holding kompanije) i potencijal rasta među pozicijama u portfelju.`,
    };
  }

  return {
    verdict: "Sve pozicije su trenutno skupe ili fer vrednovane — razmisli o čekanju",
    topPick: null,
    ranked: evaluated,
    note: `Ni jedna pozicija trenutno ne ispunjava prag za "atraktivno za dokupovanje" (najbolja je ${best.name}, ocena ${best.verdict.toLowerCase()}) — razmisli da sveži kapital ovog meseca ostane u gotovini/fondu dok se cene ne povoljnije poravnaju, umesto da se dokupuje po trenutnim cenama.`,
  };
}
