// Objektivni, merljivi kvalitativni pokazatelji — bez subjektivnih ocena
// ("dobar menadžment", "jak brend" i sl.). Svaki pokazatelj dolazi direktno
// iz finansijskih izveštaja ili konsenzusa analitičara, sa jasnim pragovima.

export interface QualitativeInputs {
  currentRatio: number | null;
  quickRatio: number | null;
  debtToEquity: number | null; // Yahoo ovo vraća kao procenat (npr. 45.2 = 0.452), pa se deli sa 100 pre poređenja
  returnOnEquity: number | null;
  returnOnAssets: number | null;
  grossMargins: number | null;
  operatingMargins: number | null;
  profitMargins: number | null;
  revenueGrowth: number | null;
  earningsGrowth: number | null;
  revenueHistory: number[]; // hronološki, najstarije prvo (iz incomeStatementHistory)
  targetMeanPrice: number | null;
  currentPrice: number;
  recommendation: {
    strongBuy: number;
    buy: number;
    hold: number;
    sell: number;
    strongSell: number;
  } | null;
}

export type Verdict = "pozitivno" | "neutralno" | "negativno";

export interface ScoredDimension {
  label: string;
  verdict: Verdict;
  detail: string;
}

export function scoreFinancialHealth(f: QualitativeInputs): ScoredDimension {
  const cr = f.currentRatio;
  const de = f.debtToEquity != null ? f.debtToEquity / 100 : null;
  if (cr == null && de == null) {
    return { label: "Finansijsko zdravlje", verdict: "neutralno", detail: "Podaci o likvidnosti/zaduženosti nisu dostupni." };
  }
  let points = 0;
  const parts: string[] = [];
  if (cr != null) {
    parts.push(`Current ratio ${cr.toFixed(2)}`);
    if (cr >= 1.5) points += 1;
    else if (cr < 1) points -= 1;
  }
  if (de != null) {
    parts.push(`Debt/Equity ${de.toFixed(2)}`);
    if (de < 0.5) points += 1;
    else if (de > 1.5) points -= 1;
  }
  const verdict: Verdict = points > 0 ? "pozitivno" : points < 0 ? "negativno" : "neutralno";
  return { label: "Finansijsko zdravlje", verdict, detail: parts.join(", ") || "Nedovoljno podataka." };
}

export function scoreProfitability(f: QualitativeInputs): ScoredDimension {
  if (f.returnOnEquity == null && f.operatingMargins == null) {
    return { label: "Profitabilnost", verdict: "neutralno", detail: "Podaci o profitabilnosti nisu dostupni." };
  }
  let points = 0;
  const parts: string[] = [];
  if (f.returnOnEquity != null) {
    parts.push(`ROE ${(f.returnOnEquity * 100).toFixed(1)}%`);
    if (f.returnOnEquity > 0.15) points += 1;
    else if (f.returnOnEquity < 0.05) points -= 1;
  }
  if (f.operatingMargins != null) {
    parts.push(`Operativna marža ${(f.operatingMargins * 100).toFixed(1)}%`);
    if (f.operatingMargins > 0.15) points += 1;
    else if (f.operatingMargins < 0.05) points -= 1;
  }
  const verdict: Verdict = points > 0 ? "pozitivno" : points < 0 ? "negativno" : "neutralno";
  return { label: "Profitabilnost", verdict, detail: parts.join(", ") || "Nedovoljno podataka." };
}

export function scoreGrowth(f: QualitativeInputs): ScoredDimension {
  if (f.revenueGrowth == null && f.revenueHistory.length < 3) {
    return { label: "Rast", verdict: "neutralno", detail: "Podaci o rastu nisu dostupni." };
  }
  let points = 0;
  const parts: string[] = [];
  if (f.revenueGrowth != null) {
    parts.push(`Rast prihoda (g/g) ${(f.revenueGrowth * 100).toFixed(1)}%`);
    if (f.revenueGrowth > 0.1) points += 1;
    else if (f.revenueGrowth < 0) points -= 1;
  }
  if (f.revenueHistory.length >= 3) {
    let consistentYears = 0;
    for (let i = 1; i < f.revenueHistory.length; i++) {
      if (f.revenueHistory[i] > f.revenueHistory[i - 1]) consistentYears++;
    }
    const total = f.revenueHistory.length - 1;
    parts.push(`Prihod rastao ${consistentYears}/${total} poslednjih godina`);
    if (consistentYears === total) points += 1;
    else if (consistentYears === 0) points -= 1;
  }
  const verdict: Verdict = points > 0 ? "pozitivno" : points < 0 ? "negativno" : "neutralno";
  return { label: "Rast i njegova doslednost", verdict, detail: parts.join(", ") || "Nedovoljno podataka." };
}

export function scoreAnalystConsensus(f: QualitativeInputs): ScoredDimension {
  const rec = f.recommendation;
  const hasRec = rec && (rec.strongBuy + rec.buy + rec.hold + rec.sell + rec.strongSell) > 0;
  if (!hasRec && f.targetMeanPrice == null) {
    return { label: "Konsenzus analitičara", verdict: "neutralno", detail: "Podaci o preporukama analitičara nisu dostupni." };
  }
  let points = 0;
  const parts: string[] = [];
  if (hasRec && rec) {
    const total = rec.strongBuy + rec.buy + rec.hold + rec.sell + rec.strongSell;
    const score = (rec.strongBuy * 1 + rec.buy * 2 + rec.hold * 3 + rec.sell * 4 + rec.strongSell * 5) / total;
    const label = score <= 2 ? "Kupovina" : score <= 2.6 ? "Blaga kupovina" : score <= 3.4 ? "Držanje" : "Prodaja";
    parts.push(`Prosečna preporuka: ${label} (${total} analitičara)`);
    if (score <= 2.6) points += 1;
    else if (score > 3.4) points -= 1;
  }
  if (f.targetMeanPrice != null) {
    const upside = f.targetMeanPrice / f.currentPrice - 1;
    parts.push(`Prosečna ciljna cena implicira ${upside >= 0 ? "+" : ""}${(upside * 100).toFixed(1)}%`);
    if (upside > 0.1) points += 1;
    else if (upside < -0.05) points -= 1;
  }
  const verdict: Verdict = points > 0 ? "pozitivno" : points < 0 ? "negativno" : "neutralno";
  return { label: "Konsenzus analitičara", verdict, detail: parts.join(", ") || "Nedovoljno podataka." };
}

export interface QualitativeSummary {
  dimensions: ScoredDimension[];
  overallScore: number; // -1 do 1
  overallLabel: string;
}

export function summarizeQualitative(f: QualitativeInputs): QualitativeSummary {
  const dimensions = [
    scoreFinancialHealth(f),
    scoreProfitability(f),
    scoreGrowth(f),
    scoreAnalystConsensus(f),
  ];
  const weights: Record<Verdict, number> = { pozitivno: 1, neutralno: 0, negativno: -1 };
  const scored = dimensions.filter((d) => d.detail !== "Nedovoljno podataka." && !d.detail.includes("nisu dostupni"));
  const overallScore = scored.length ? scored.reduce((sum, d) => sum + weights[d.verdict], 0) / scored.length : 0;
  const overallLabel =
    overallScore > 0.4 ? "Solidni fundamenti" :
    overallScore > 0 ? "Uglavnom pozitivni fundamenti" :
    overallScore === 0 ? "Mešoviti/neutralni fundamenti" :
    overallScore > -0.4 ? "Uglavnom slabiji fundamenti" :
    "Slabi fundamenti";
  return { dimensions, overallScore, overallLabel };
}

export function combineVerdict(
  quantitativeUpside: number | null,
  qualitative: QualitativeSummary
): { label: string; detail: string } {
  if (quantitativeUpside == null) {
    return {
      label: qualitative.overallLabel,
      detail: "Kvantitativna procena vrednosti nije dostupna (nedostaju podaci za DCF/relativnu procenu) — sud se zasniva samo na fundamentalnim pokazateljima.",
    };
  }
  const valuationLabel =
    quantitativeUpside > 0.2 ? "znatno potcenjena" :
    quantitativeUpside > 0.05 ? "blago potcenjena" :
    quantitativeUpside > -0.05 ? "otprilike fer vrednovana" :
    quantitativeUpside > -0.2 ? "blago precenjena" :
    "znatno precenjena";

  let synthesis: string;
  if (quantitativeUpside > 0.05 && qualitative.overallScore > 0) {
    synthesis = "Kvantitativni modeli i fundamentalni pokazatelji se slažu u pozitivnom pravcu — ovo je najjači tip signala u ovoj analizi (iako i dalje ne garantuje budući rezultat).";
  } else if (quantitativeUpside < -0.05 && qualitative.overallScore < 0) {
    synthesis = "Kvantitativni modeli i fundamentalni pokazatelji se slažu u negativnom pravcu.";
  } else {
    synthesis = "Kvantitativna procena i fundamentalni pokazatelji NISU usaglašeni — ovo je znak da treba dublje istražiti pre donošenja zaključka, pretpostavke u modelu su možda previše optimistične/pesimistične, ili fundamenti ne prate trenutnu cenu.";
  }

  return {
    label: `${valuationLabel.charAt(0).toUpperCase() + valuationLabel.slice(1)} — ${qualitative.overallLabel.toLowerCase()}`,
    detail: synthesis,
  };
}
