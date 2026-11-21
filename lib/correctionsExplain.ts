// Objašnjenje razloga korekcija cene (Claude). Korekcije su već pronađene
// determinističkom logikom (lib/corrections.ts); ovde se samo traži KOJI su
// razlozi. Poziva se isključivo klikom na dugme (štedi API kredit).
//
// Izvori razloga: (1) naslovi vesti iz Google News pretrage ograničene na
// datume oko vrha i dna korekcije (najbolji pokušaj, često prazno za starije
// periode), (2) opšte znanje modela o tom događaju. Svaki razlog nosi oznaku
// osnove ("vesti" ili "znanje") i pouzdanosti, da se ne predstavlja kao
// sigurno ono što to nije.

import { unstable_cache } from "next/cache";
import { callClaude, describeClaudeError, diagnoseMissingKey, resolveApiKey } from "@/lib/newsDigest";
import { fetchGoogleNewsFeed } from "@/lib/rss";

export interface CorrectionInput {
  peakTs: number;
  troughTs: number;
  depth: number; // negativan razlomak
  marketChange: number | null;
}

export interface CorrectionReason {
  index: number; // redni broj ulazne korekcije
  cause: string; // 1–2 rečenice: šta je izazvalo pad
  category: "makro" | "sektor" | "kompanija" | "mesovito";
  basis: "vesti" | "znanje";
  confidence: "visoka" | "srednja" | "niska";
  // Da li pad ima veze sa pogoršanjem fundamenata u tom periodu.
  fundamentals: "da" | "delimicno" | "ne" | "nejasno";
  fundamentalsNote: string; // šta konkretno: marže, zarada, tržišni udeo, ekonomski rov — ili zašto nije povezano
}

export interface CorrectionsExplanation {
  reasons: CorrectionReason[];
  pattern: string; // šta se ponavlja kroz korekcije ove akcije
}

export type ExplainResult =
  | { status: "ok"; generatedAt: string; data: CorrectionsExplanation }
  | { status: "unavailable"; reason: string };

const MAX_CORRECTIONS = 12;
const HEADLINES_PER_CORRECTION = 6;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["reasons", "pattern"],
  properties: {
    reasons: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["index", "cause", "category", "basis", "confidence", "fundamentals", "fundamentalsNote"],
        properties: {
          index: { type: "integer" },
          cause: { type: "string" },
          category: { type: "string", enum: ["makro", "sektor", "kompanija", "mesovito"] },
          basis: { type: "string", enum: ["vesti", "znanje"] },
          confidence: { type: "string", enum: ["visoka", "srednja", "niska"] },
          fundamentals: { type: "string", enum: ["da", "delimicno", "ne", "nejasno"] },
          fundamentalsNote: { type: "string" },
        },
      },
    },
    pattern: { type: "string" },
  },
} as const;

const SYSTEM = `Ti si finansijski analitičar. Dobijaš listu korekcija (padova cene od vrha do dna) jedne akcije, sa datumima, dubinom pada i promenom S&P 500 u istom periodu, a za neke i naslove vesti iz tog vremena.
Za SVAKU korekciju objasni UZROK pada, na srpskom jeziku (latinica), 1–2 jasne rečenice, bez žargona.
Pravila:
- Ako je S&P 500 u istom periodu pao slično (ili više), uzrok je pretežno tržišni/makro — reci koji (npr. kamatne stope, inflacija, pandemija, recesija) — i dodaj šta je bilo specifično za ovu kompaniju samo ako to zaista znaš.
- Ako tržište nije palo, traži uzrok u kompaniji ili sektoru (rezultati, smanjene prognoze, regulativa, sektorska rotacija...).
- "basis": "vesti" samo ako se uzrok oslanja na dostavljene naslove; inače "znanje" (tvoje opšte poznavanje događaja).
- "confidence": "visoka" samo ako si siguran u događaj i vremensku vezu; "niska" ako je to pretpostavka. NIKAD ne izmišljaj konkretne događaje, brojeve ili izjave — radije reci "uzrok nije jasan iz dostupnih podataka" sa niskom pouzdanošću.
- "fundamentals": da li je pad povezan sa stvarnim pogoršanjem fundamenata kompanije u tom periodu: pad marži, pad zarade ili prihoda, gubitak dela tržišta, slabljenje ekonomskog rova (konkurentske prednosti). "da" = jasno povezano; "delimicno" = delom; "ne" = pad je pretežno rezultat tržišnih faktora, raspoloženja ili valuacije (multipla) dok su fundamenti ostali stabilni; "nejasno" = ne znaš dovoljno. U "fundamentalsNote" u 1–2 rečenice navedi ŠTA konkretno (npr. "operativna marža pala sa X na Y" samo ako to zaista znaš) ili zašto nema veze. Razlikuj pad zbog sniženja valuacije (isti poslovni rezultati, niži multipl) od pada zbog slabijeg poslovanja. Ne izmišljaj brojeve; ako ih ne znaš, opiši smer promene bez brojeva ili reci "nejasno".
- Ne analiziraj rast, samo padove. Ne daj preporuku da kupi ili proda.
- "index" je redni broj korekcije iz ulaza (počinje od 0).
- "pattern": 2–3 rečenice o tome šta se ponavlja kroz korekcije ove akcije (npr. osetljivost na kamate, sezonalnost rezultata, brzina oporavka) i koliko su korekcije bile povezane sa fundamentima, a koliko sa tržištem ili valuacijom, samo ako se vidi iz podataka.`;

const dateStr = (ts: number) => new Date(ts * 1000).toISOString().slice(0, 10);
const pct = (x: number | null) => (x == null ? "n/a" : `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%`);

async function headlinesFor(query: string, c: CorrectionInput): Promise<string[]> {
  // Pretraga u prozoru: nedelju dana pre vrha do nedelju dana posle dna? Uzroci
  // pada su pretežno u vremenu između vrha i dna, pa prozor pokriva taj period
  // (najviše 120 dana, da pretraga ostane fokusirana na početak pada).
  const from = dateStr(c.peakTs - 3 * 86400);
  const to = dateStr(Math.min(c.troughTs + 3 * 86400, c.peakTs + 120 * 86400));
  const items = await fetchGoogleNewsFeed(`${query} after:${from} before:${to}`, "", "");
  const seen = new Set<string>();
  const out: string[] = [];
  for (const it of items) {
    const key = it.title.toLowerCase();
    if (!it.title || seen.has(key)) continue;
    seen.add(key);
    out.push(`${it.isoDate.slice(0, 10)} — ${it.title}`);
    if (out.length >= HEADLINES_PER_CORRECTION) break;
  }
  return out;
}

async function build(ticker: string, companyName: string, corrections: CorrectionInput[]): Promise<CorrectionsExplanation> {
  const query = `"${companyName}" stock`;
  const heads = await Promise.all(corrections.map((c) => headlinesFor(query, c).catch(() => [] as string[])));
  const body = corrections
    .map((c, i) => {
      const lines = [
        `#${i}: vrh ${dateStr(c.peakTs)} → dno ${dateStr(c.troughTs)}, pad ${pct(c.depth)}, S&P 500 u istom periodu ${pct(c.marketChange)}`,
      ];
      if (heads[i].length) lines.push("  Naslovi vesti iz tog perioda:", ...heads[i].map((h) => `  - ${h}`));
      else lines.push("  (nema dostupnih naslova vesti za taj period)");
      return lines.join("\n");
    })
    .join("\n");
  return callClaude<CorrectionsExplanation>(
    SYSTEM,
    SCHEMA,
    "medium",
    `Akcija: ${companyName} (${ticker}). Korekcije:\n${body}`
  );
}

const cachedBuild = unstable_cache(build, ["corrections-explain", "v2"], { revalidate: 24 * 60 * 60 });

export async function explainCorrections(
  ticker: string,
  companyName: string,
  corrections: CorrectionInput[]
): Promise<ExplainResult> {
  if (!resolveApiKey()) return { status: "unavailable", reason: diagnoseMissingKey() };
  // najveći padovi prvo, ali redosled u ulazu ostaje hronološki zbog jasnoće
  const picked = [...corrections]
    .sort((a, b) => a.depth - b.depth)
    .slice(0, MAX_CORRECTIONS)
    .sort((a, b) => a.peakTs - b.peakTs);
  try {
    const data = await cachedBuild(ticker, companyName, picked);
    return { status: "ok", generatedAt: new Date().toISOString(), data };
  } catch (e) {
    return { status: "unavailable", reason: describeClaudeError(e) };
  }
}

export { MAX_CORRECTIONS };
