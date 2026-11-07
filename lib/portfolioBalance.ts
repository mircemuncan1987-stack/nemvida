// Balans portfelja: rast naspram zaštite u korekcijama — nov alat koji
// meri da li je portfelj preterano agresivan (jako pada u korekcijama) ili
// preterano odbrambeni (zaostaje za tržištem u usponima), i predlaže KOJE
// POSTOJEĆE pozicije dokupiti da se balans pomeri ka cilju.
//
// Rizik se meri PREKO BETE, ne sektorskih nalepnica — beta direktno meri
// koliko pozicija prati tržište, što je tačno ono što određuje ponašanje u
// korekciji, i već je proverljiv broj koji stres-test (vidi
// stressTestPortfolio u ovom fajlu) koristi. Ista konvencija za rezoluciju
// bete kao u stres-testu, da se isti broj ne računa na dva mesta sa
// mogućnošću da se razmimoiđe: gotovina = 0, fond = 1 (široko
// diverzifikovan, prati tržište), akcija = stvarna beta ili 1 ako nije
// poznata.
//
// Fiksne, dokumentovane granice:
//   - "Zaštitna" pozicija: beta < 0.8
//   - "Neutralna" pozicija: beta 0,8-1,15 (uključuje fondove, beta=1)
//   - "Rastuća/ciklična" pozicija: beta > 1,15
//
// Ciljni raspon bete CELOG portfelja: 0,90-1,10 ("balansiran"). Ovo nije
// univerzalno "ispravna" vrednost za svakog investitora — to je fiksna,
// umerena referentna tačka (ni agresivno rastuća, ni defanzivna) koja daje
// merljiv, ponovljiv osnov za predlog umesto subjektivne procene. Van tog
// raspona, predlog je dokup POSTOJEĆIH pozicija sa suprotne strane
// neravnoteže, rangiran po tome koliko je ta pozicija trenutno POVOLJNA za
// dokup (buyVerdict iz lib/buyAttractiveness.ts) — da predlog ne gura dokup
// nečega skupog samo zato što mu beta odgovara.

export type RiskTier = "zaštitna" | "neutralna" | "rastuća";
export type BuyVerdict = "Atraktivno za dokupovanje" | "Fer vrednovano" | "Skupo" | "Nedovoljno podataka" | null;

export interface BalanceInputPosition {
  id: string;
  name: string;
  ticker: string | null;
  weight: number; // 0-1 od ukupnog portfelja
  category: "akcija" | "fond" | "gotovina";
  beta: number | null; // samo za akcije — null ako nije poznata (tretira se kao 1, isto kao stres-test)
  buyVerdict: BuyVerdict; // iz buildBuyRecommendation, ako je pozicija deo te analize
}

export interface BalanceSuggestion {
  id: string;
  name: string;
  ticker: string | null;
  tier: RiskTier;
  weight: number;
  resolvedBeta: number;
  buyVerdict: BuyVerdict;
  reason: string;
}

export interface PortfolioBalanceResult {
  portfolioBeta: number | null;
  weightByTier: { tier: RiskTier; weight: number }[];
  targetBetaRange: [number, number];
  verdict: "Previše agresivan — nedovoljno zaštite" | "Previše odbrambeni — nedovoljno rasta" | "Balansiran" | "Nedovoljno podataka";
  suggestions: BalanceSuggestion[];
}

const TARGET_BETA_RANGE: [number, number] = [0.9, 1.1];

function resolveBeta(p: BalanceInputPosition): number {
  if (p.category === "gotovina") return 0;
  if (p.category === "fond") return 1;
  return p.beta ?? 1;
}

function classifyTier(resolvedBeta: number): RiskTier {
  if (resolvedBeta < 0.8) return "zaštitna";
  if (resolvedBeta > 1.15) return "rastuća";
  return "neutralna";
}

// Niže = povoljnije za dokup — koristi se kao tie-breaker da predlog
// favorizuje pozicije koje su i cenovno atraktivne, ne samo da imaju
// odgovarajuću betu.
function verdictRank(v: BuyVerdict): number {
  if (v === "Atraktivno za dokupovanje") return 0;
  if (v === "Fer vrednovano") return 1;
  if (v === "Nedovoljno podataka") return 2;
  return 3; // "Skupo"
}

export function analyzePortfolioBalance(positions: BalanceInputPosition[]): PortfolioBalanceResult {
  if (positions.length === 0) {
    return { portfolioBeta: null, weightByTier: [], targetBetaRange: TARGET_BETA_RANGE, verdict: "Nedovoljno podataka", suggestions: [] };
  }

  const totalWeight = positions.reduce((s, p) => s + p.weight, 0);
  if (totalWeight <= 0) {
    return { portfolioBeta: null, weightByTier: [], targetBetaRange: TARGET_BETA_RANGE, verdict: "Nedovoljno podataka", suggestions: [] };
  }

  const resolved = positions.map((p) => ({ position: p, resolvedBeta: resolveBeta(p), tier: classifyTier(resolveBeta(p)) }));

  const portfolioBeta = resolved.reduce((s, r) => s + r.position.weight * r.resolvedBeta, 0) / totalWeight;

  const tierWeights: Record<RiskTier, number> = { "zaštitna": 0, "neutralna": 0, "rastuća": 0 };
  for (const r of resolved) tierWeights[r.tier] += r.position.weight / totalWeight;
  const weightByTier = (["rastuća", "neutralna", "zaštitna"] as RiskTier[]).map((tier) => ({ tier, weight: tierWeights[tier] }));

  let verdict: PortfolioBalanceResult["verdict"];
  if (portfolioBeta > TARGET_BETA_RANGE[1]) verdict = "Previše agresivan — nedovoljno zaštite";
  else if (portfolioBeta < TARGET_BETA_RANGE[0]) verdict = "Previše odbrambeni — nedovoljno rasta";
  else verdict = "Balansiran";

  const targetTier: RiskTier | null = verdict === "Previše agresivan — nedovoljno zaštite" ? "zaštitna" : verdict === "Previše odbrambeni — nedovoljno rasta" ? "rastuća" : null;

  let suggestions: BalanceSuggestion[] = [];
  if (targetTier) {
    suggestions = resolved
      .filter((r) => r.tier === targetTier)
      .sort((a, b) => {
        const rankDiff = verdictRank(a.position.buyVerdict) - verdictRank(b.position.buyVerdict);
        if (rankDiff !== 0) return rankDiff;
        // Jača beta u traženom pravcu je jači "povučak" ka cilju.
        return targetTier === "zaštitna" ? a.resolvedBeta - b.resolvedBeta : b.resolvedBeta - a.resolvedBeta;
      })
      .slice(0, 3)
      .map((r) => ({
        id: r.position.id,
        name: r.position.name,
        ticker: r.position.ticker,
        tier: r.tier,
        weight: r.position.weight / totalWeight,
        resolvedBeta: r.resolvedBeta,
        buyVerdict: r.position.buyVerdict,
        reason:
          targetTier === "zaštitna"
            ? `Beta ${r.resolvedBeta.toFixed(2)} — dokupovanjem povlači ukupnu betu portfelja naniže, ka cilju ${TARGET_BETA_RANGE[0].toFixed(1)}–${TARGET_BETA_RANGE[1].toFixed(1)}.`
            : `Beta ${r.resolvedBeta.toFixed(2)} — dokupovanjem povlači ukupnu betu portfelja naviše, ka cilju ${TARGET_BETA_RANGE[0].toFixed(1)}–${TARGET_BETA_RANGE[1].toFixed(1)}.`,
      }));
  }

  return { portfolioBeta, weightByTier, targetBetaRange: TARGET_BETA_RANGE, verdict, suggestions };
}
