// Procena "da li je cena atraktivna" za listu praćenih akcija (/watchlist) —
// namerno DRUGAČIJA mehanika od ostalih valuacionih modela na sajtu:
//
// - Za razliku od lib/buyAttractiveness.ts (napravljen za portfolio, gde je
//   P/E naspram SEKTORSKE medijane glavni oslonac, uz posebne korekcije za
//   ciklične sektore i holding kompanije), ovde je oslonac multiplesTable iz
//   lib/buildModel.ts — isti koji se prikazuje na /model — čije P/E i P/FCF
//   redovi prvo porede cenu sa SOPSTVENOM ISTORIJSKOM PROSEČNOM vrednošću te
//   kompanije (ne sa konkurencijom), uz sektor i apsolutne pragove kao
//   dopunu. Pitanje ovde nije "da li je jeftinije od konkurencije" nego "da
//   li je jeftinije nego što je ova konkretna kompanija obično bila".
// - Verdikt je namerno BINARAN (Atraktivno / Skupo — sačekaj), bez srednje
//   kategorije — eksplicitan zahtev korisnika da "fer vrednovano" zbunjuje
//   kod liste za praćenje. Kad je broj povoljnih i skupih redova izjednačen,
//   odlučuje potencijal rasta (scoreGrowthPotential iz lib/model.ts): visok
//   rast prevagne ka "Atraktivno", sve ostalo (uključujući nepoznat rast)
//   ostaje konzervativno na "Skupo — sačekaj" — kod nerešenog rezultata,
//   podrazumevano se ne juri cena.

import type { MultipleTableRow } from "@/lib/buildModel";
import type { GrowthPotentialResult } from "@/lib/model";

export interface WatchlistVerdict {
  verdict: "Atraktivno" | "Skupo — sačekaj";
  favorableCount: number;
  expensiveCount: number;
  knownCount: number;
  growthPotential: GrowthPotentialResult;
  reasons: string[]; // konkretni redovi (metrika + čitanje) iza verdikta
  tieBreakByGrowth: boolean; // true kad su povoljni/skupi redovi izjednačeni i presudio je rast
}

export function evaluateWatchlistTicker(multiplesTable: MultipleTableRow[], growthPotential: GrowthPotentialResult): WatchlistVerdict {
  const known = multiplesTable.filter((r) => r.tone !== "nedovoljno podataka");
  const favorable = known.filter((r) => r.tone === "povoljno");
  const expensive = known.filter((r) => r.tone === "skupo");

  let verdict: WatchlistVerdict["verdict"];
  let tieBreakByGrowth = false;
  if (favorable.length > expensive.length) {
    verdict = "Atraktivno";
  } else if (expensive.length > favorable.length) {
    verdict = "Skupo — sačekaj";
  } else {
    tieBreakByGrowth = true;
    verdict = growthPotential.tier === "visok" ? "Atraktivno" : "Skupo — sačekaj";
  }

  const reasons = known.map((r) => `${r.metric}: ${r.reading}`);
  reasons.push(`Potencijal rasta: ${growthPotential.label}`);

  return {
    verdict,
    favorableCount: favorable.length,
    expensiveCount: expensive.length,
    knownCount: known.length,
    growthPotential,
    reasons,
    tieBreakByGrowth,
  };
}
