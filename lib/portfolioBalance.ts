// Balans portfelja: rast naspram zaštite u korekcijama, I izloženost
// pojedinačnoj kompaniji — dva nezavisna, ravnopravna kriterijuma balansa:
//
// 1. RIZIK (beta) — da li portfelj preterano pada u korekcijama ili
//    preterano zaostaje u usponima.
// 2. KONCENTRACIJA (udeo jedne pozicije) — portfelj može imati savršenu
//    betu, a opet biti loše izbalansiran ako je 25% u jednoj akciji: pad te
//    jedne kompanije (bilo iz kog razloga — skandal, loš izveštaj, gubitak
//    patenta) nesrazmerno pogađa ceo portfolio, bez obzira na njenu betu.
//
// Rizik (beta) se meri istom konvencijom kao stres-test — vidi
// lib/portfolio.ts (stressTestPortfolio): gotovina = 0, fond = 1 (široko
// diverzifikovan, prati tržište), akcija = stvarna beta ili 1 ako nije
// poznata.
//
// Fiksne, dokumentovane granice:
//   - "Zaštitna" pozicija: beta < 0.8
//   - "Neutralna" pozicija: beta 0,8-1,15 (uključuje fondove, beta=1)
//   - "Rastuća/ciklična" pozicija: beta > 1,15
//   - Ciljni raspon bete CELOG portfelja: 0,90-1,10 ("balansiran")
//
// Koncentracija koristi ISTE pragove kao "Koncentracija i diverzifikacija"
// sekcija (lib/portfolio.ts, analyzeConcentration) — namerno isti brojevi
// (20%/12%) na oba mesta, da se ne pojave dva različita praga za "previše
// jedne akcije" na istoj strani: preko 20% = ozbiljna koncentracija, preko
// 12% = povišena.
//
// Prioritet kad oba problema postoje istovremeno: koncentracija u jednoj
// kompaniji se tretira kao OZBILJNIJI, strukturni rizik od blage neravnoteže
// bete — specifičan rizik pojedinačne kompanije (skandal, promašen kvartal,
// gubitak patenta) ne može se ublažiti diversifikacijom unutar iste akcije,
// dok je beta neravnoteža blaža i lakše se ispravlja tokom vremena.
//
// Predlog dokupovanja je uvek SAMO među pozicijama koje korisnik VEĆ
// poseduje, rangiran i time da li je pozicija trenutno povoljna za dokup
// (buyVerdict iz lib/buyAttractiveness.ts) — da predlog ne gura dokup nečega
// skupog samo zato što mu beta/udeo odgovara. Nikad se ne predlaže dokup
// pozicije koja je već preko granice ozbiljne koncentracije (20%), čak ni
// kad bi to ispravilo betu.

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

export type BalanceVerdict =
  | "Nedovoljno diverzifikovan — prevelika izloženost jednoj kompaniji"
  | "Previše agresivan — nedovoljno zaštite"
  | "Previše odbrambeni — nedovoljno rasta"
  | "Balansiran"
  | "Nedovoljno podataka";

export interface PortfolioBalanceResult {
  portfolioBeta: number | null;
  weightByTier: { tier: RiskTier; weight: number }[];
  targetBetaRange: [number, number];
  verdict: BalanceVerdict;
  concentratedPositions: { name: string; weight: number }[]; // preko 20% — isti prag kao analyzeConcentration
  suggestions: BalanceSuggestion[];
}

const TARGET_BETA_RANGE: [number, number] = [0.9, 1.1];
const SEVERE_CONCENTRATION_THRESHOLD = 0.2; // isto kao lib/portfolio.ts (analyzeConcentration)
const ELEVATED_CONCENTRATION_THRESHOLD = 0.12;

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
// odgovarajuću betu/udeo.
function verdictRank(v: BuyVerdict): number {
  if (v === "Atraktivno za dokupovanje") return 0;
  if (v === "Fer vrednovano") return 1;
  if (v === "Nedovoljno podataka") return 2;
  return 3; // "Skupo"
}

export function analyzePortfolioBalance(positions: BalanceInputPosition[]): PortfolioBalanceResult {
  const empty = (verdict: BalanceVerdict): PortfolioBalanceResult => ({
    portfolioBeta: null,
    weightByTier: [],
    targetBetaRange: TARGET_BETA_RANGE,
    verdict,
    concentratedPositions: [],
    suggestions: [],
  });
  if (positions.length === 0) return empty("Nedovoljno podataka");

  const totalWeight = positions.reduce((s, p) => s + p.weight, 0);
  if (totalWeight <= 0) return empty("Nedovoljno podataka");

  const resolved = positions.map((p) => {
    const normWeight = p.weight / totalWeight;
    const resolvedBeta = resolveBeta(p);
    return { position: p, normWeight, resolvedBeta, tier: classifyTier(resolvedBeta) };
  });

  const portfolioBeta = resolved.reduce((s, r) => s + r.normWeight * r.resolvedBeta, 0);

  const tierWeights: Record<RiskTier, number> = { "zaštitna": 0, "neutralna": 0, "rastuća": 0 };
  for (const r of resolved) tierWeights[r.tier] += r.normWeight;
  const weightByTier = (["rastuća", "neutralna", "zaštitna"] as RiskTier[]).map((tier) => ({ tier, weight: tierWeights[tier] }));

  const concentratedPositions = resolved
    .filter((r) => r.normWeight > SEVERE_CONCENTRATION_THRESHOLD)
    .map((r) => ({ name: r.position.name, weight: r.normWeight }))
    .sort((a, b) => b.weight - a.weight);

  let verdict: BalanceVerdict;
  if (concentratedPositions.length > 0) {
    verdict = "Nedovoljno diverzifikovan — prevelika izloženost jednoj kompaniji";
  } else if (portfolioBeta > TARGET_BETA_RANGE[1]) {
    verdict = "Previše agresivan — nedovoljno zaštite";
  } else if (portfolioBeta < TARGET_BETA_RANGE[0]) {
    verdict = "Previše odbrambeni — nedovoljno rasta";
  } else {
    verdict = "Balansiran";
  }

  let suggestions: BalanceSuggestion[] = [];

  if (verdict === "Nedovoljno diverzifikovan — prevelika izloženost jednoj kompaniji") {
    // Ne predlaže se dokup bilo čega što bi uvećalo postojeću koncentraciju
    // — cilj je razblažiti je, pa se biraju pozicije sa NAJMANJIM trenutnim
    // udelom (svež kapital tu ima najveći uticaj na smanjenje koncentracije),
    // uz cenovnu atraktivnost kao tie-breaker.
    const concentratedNames = concentratedPositions.map((c) => c.name).join(", ");
    suggestions = resolved
      .filter((r) => r.normWeight <= SEVERE_CONCENTRATION_THRESHOLD)
      .sort((a, b) => {
        const rankDiff = verdictRank(a.position.buyVerdict) - verdictRank(b.position.buyVerdict);
        if (rankDiff !== 0) return rankDiff;
        return a.normWeight - b.normWeight;
      })
      .slice(0, 3)
      .map((r) => ({
        id: r.position.id,
        name: r.position.name,
        ticker: r.position.ticker,
        tier: r.tier,
        weight: r.normWeight,
        resolvedBeta: r.resolvedBeta,
        buyVerdict: r.position.buyVerdict,
        reason: `Trenutno čini samo ${(r.normWeight * 100).toFixed(1)}% portfelja — dokupovanjem ovde razblažuješ izloženost ${concentratedNames} umesto da je dodatno povećavaš.`,
      }));
  } else {
    const targetTier: RiskTier | null =
      verdict === "Previše agresivan — nedovoljno zaštite" ? "zaštitna" : verdict === "Previše odbrambeni — nedovoljno rasta" ? "rastuća" : null;

    if (targetTier) {
      suggestions = resolved
        .filter((r) => r.tier === targetTier)
        // Nikad ne predlaže dokup pozicije koja bi time prešla u ozbiljnu
        // koncentraciju (preko 20%) — beta cilj ne sme da pogorša drugi
        // kriterijum balansa.
        .filter((r) => r.normWeight <= SEVERE_CONCENTRATION_THRESHOLD)
        .sort((a, b) => {
          const rankDiff = verdictRank(a.position.buyVerdict) - verdictRank(b.position.buyVerdict);
          if (rankDiff !== 0) return rankDiff;
          // Jača beta u traženom pravcu je jači "povučak" ka cilju.
          return targetTier === "zaštitna" ? a.resolvedBeta - b.resolvedBeta : b.resolvedBeta - a.resolvedBeta;
        })
        .slice(0, 3)
        .map((r) => {
          const concentrationNote =
            r.normWeight > ELEVATED_CONCENTRATION_THRESHOLD
              ? ` Napomena: već čini ${(r.normWeight * 100).toFixed(1)}% portfelja — razmisli o manjem iznosu, da se ne doda previše na postojeću koncentraciju.`
              : "";
          return {
            id: r.position.id,
            name: r.position.name,
            ticker: r.position.ticker,
            tier: r.tier,
            weight: r.normWeight,
            resolvedBeta: r.resolvedBeta,
            buyVerdict: r.position.buyVerdict,
            reason:
              (targetTier === "zaštitna"
                ? `Beta ${r.resolvedBeta.toFixed(2)} — dokupovanjem povlači ukupnu betu portfelja naniže, ka cilju ${TARGET_BETA_RANGE[0].toFixed(1)}–${TARGET_BETA_RANGE[1].toFixed(1)}.`
                : `Beta ${r.resolvedBeta.toFixed(2)} — dokupovanjem povlači ukupnu betu portfelja naviše, ka cilju ${TARGET_BETA_RANGE[0].toFixed(1)}–${TARGET_BETA_RANGE[1].toFixed(1)}.`) + concentrationNote,
          };
        });
    }
  }

  return { portfolioBeta, weightByTier, targetBetaRange: TARGET_BETA_RANGE, verdict, concentratedPositions, suggestions };
}
