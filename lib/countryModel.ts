// Deterministička analiza makroekonomskih pokazatelja jedne zemlje — ista
// filozofija kao lib/model.ts za akcije: fiksni, dokumentovani pragovi nad
// javnim podacima (World Bank), bez subjektivne/AI procene. Svaki prag je
// opštepoznata, standardna granica u makroekonomiji (npr. inflacija iznad
// 8% se standardno smatra visokom, javni dug iznad 80% BDP-a je blizu/preko
// zone rizika koju MMF/Svetska banka prate) — nije izmišljen za potrebe
// ovog sajta.
//
// NAMERNO STROŽI pragovi nego u prvoj verziji: "good" sada znači stvarno
// solidno po međunarodnim merilima, ne samo "nije najgore". Takođe je BDP
// po glavi stanovnika (i životni vek, kao proxy za opšti razvoj) UKLJUČEN
// u bodovanje (ranije je bio samo informativan) — bez toga, brza % stopa
// rasta manje, siromašnije ekonomije (koja realno sustiže sa niske osnove)
// je mogla da nadmaši bogatu, razvijenu ekonomiju sa sporijim, ali zrelim
// rastom, što ne odgovara stvarnom poretku snage privreda.
//
// POKRIVENOST PODATAKA: javni dug i fiskalni bilans (World Bank-ovi GC.*
// pokazatelji, izvedeni iz IMF Government Finance Statistics) imaju
// rupičavu pokrivenost čak i za velike, razvijene ekonomije (npr. Švedska),
// jer te zemlje te brojeve prijavljuju kroz Eurostat/IMF Article IV, ne
// kroz format koji World Bank ovde ima u bazi; Gini koeficijent je anketni
// podatak sa sličnim rupama za gotovo sve zemlje. Da jedna zemlja ne bi
// bila kažnjena/nagrađena samo zato što joj je taj specifičan broj (ne)
// dostupan u WB bazi, sva tri su OSTAVLJENA INFORMATIVNO (prikazuju se kad
// postoje, ali ne ulaze u skor ni u zelene/crvene signale). Umesto duga,
// dimenzija "Fiskalna i finansijska snaga" se bodira bruto nacionalnom
// štednjom (NY.GNS.ICTR.ZS) — standardni nacionalni-računi agregat sa
// znatno širom, pouzdanijom pokrivenošću. Potpuno 100% pokriće svakog
// pojedinačnog pokazatelja za baš svaku zemlju nije realno ni iz jednog
// besplatnog izvora — ovde su birani pokazatelji sa najširom raspoloživom
// pokrivenošću za SKOR, dok ređi podaci ostaju vidljivi kao bonus kontekst.

import type { IndicatorCode, IndicatorPoint } from "@/app/api/country/route";

export type Tone = "good" | "neutral" | "bad" | "unknown";

export interface IndicatorDef {
  code: IndicatorCode;
  label: string;
  unit: "percent" | "usd" | "number" | "index" | "years";
  dimension: "rast" | "razvoj" | "cene" | "fiskalno" | "spoljno" | "trziste-rada";
  tone: (value: number | null) => Tone;
  flagIfGood?: (value: number) => string; // zeleni signal (opciono — ne svaki pokazatelj nosi flag)
  flagIfBad?: (value: number) => string; // crveni signal (opciono)
}

// Pragovi su navedeni uz svaki poziv — standardne makroekonomske granice,
// ne proizvoljno birane za ovaj sajt.
export const INDICATOR_DEFS: IndicatorDef[] = [
  {
    code: "NY.GDP.MKTP.KD.ZG",
    label: "Rast BDP-a (godišnje)",
    unit: "percent",
    dimension: "rast",
    tone: (v) => (v == null ? "unknown" : v >= 3 ? "good" : v >= 1 ? "neutral" : "bad"),
    flagIfGood: (v) => `Solidan rast BDP-a (${v.toFixed(1)}% godišnje) — iznad praga od 3% koji se smatra snažnim rastom.`,
    flagIfBad: (v) =>
      v < 0
        ? `Ekonomija se smanjuje (rast BDP-a ${v.toFixed(1)}%) — recesija u poslednjoj raspoloživoj godini.`
        : `Spor rast BDP-a (${v.toFixed(1)}% godišnje) — ispod praga od 1% koji se smatra minimalno zdravim rastom.`,
  },
  {
    code: "SP.POP.TOTL",
    label: "Stanovništvo",
    unit: "number",
    dimension: "rast",
    tone: () => "unknown",
  },
  {
    code: "SP.POP.GROW",
    label: "Rast stanovništva (godišnje)",
    unit: "percent",
    dimension: "rast",
    tone: () => "unknown", // informativno — ni rast ni pad stanovništva nisu sami po sebi "dobri/loši"
  },
  {
    code: "NY.GDP.PCAP.CD",
    label: "BDP po glavi stanovnika",
    unit: "usd",
    dimension: "razvoj",
    // Prag "good" (≥25.000 USD) odgovara donjoj granici razvijenih ekonomija;
    // "bad" (<8.000 USD) World Bank svrstava blizu donjeg srednjeg dohotka.
    tone: (v) => (v == null ? "unknown" : v >= 25000 ? "good" : v >= 8000 ? "neutral" : "bad"),
    flagIfGood: (v) => `Visok BDP po glavi stanovnika (${(v / 1000).toFixed(1)}k USD) — nivo razvijene ekonomije.`,
    flagIfBad: (v) => `Nizak BDP po glavi stanovnika (${(v / 1000).toFixed(1)}k USD) — ispod praga od 8k USD, nivo srednje razvijene/slabije ekonomije.`,
  },
  {
    code: "SP.DYN.LE00.IN",
    label: "Životni vek pri rođenju",
    unit: "years",
    dimension: "razvoj",
    tone: (v) => (v == null ? "unknown" : v >= 78 ? "good" : v >= 70 ? "neutral" : "bad"),
    flagIfGood: (v) => `Visok životni vek (${v.toFixed(1)} god.) — proxy za opšti razvoj, zdravstvo i standard života.`,
    flagIfBad: (v) => `Nizak životni vek (${v.toFixed(1)} god.) — ispod praga od 70 godina, signal slabijeg zdravstvenog sistema/standarda.`,
  },
  {
    code: "FP.CPI.TOTL.ZG",
    label: "Inflacija (potrošačke cene)",
    unit: "percent",
    dimension: "cene",
    tone: (v) => (v == null ? "unknown" : v < 0 ? "bad" : v <= 3 ? "good" : v <= 8 ? "neutral" : "bad"),
    flagIfGood: (v) => `Inflacija pod kontrolom (${v.toFixed(1)}% godišnje) — blizu uobičajenog cilja centralnih banaka od ~2%.`,
    flagIfBad: (v) =>
      v < 0
        ? `Deflacija (${v.toFixed(1)}%) — padajuće cene mogu značiti slabu tražnju, rizik od odlaganja potrošnje.`
        : `Visoka inflacija (${v.toFixed(1)}% godišnje) — iznad praga od 8%, značajno erodira kupovnu moć i štednju.`,
  },
  {
    code: "SL.UEM.TOTL.ZS",
    label: "Nezaposlenost",
    unit: "percent",
    dimension: "trziste-rada",
    tone: (v) => (v == null ? "unknown" : v < 5 ? "good" : v <= 10 ? "neutral" : "bad"),
    flagIfGood: (v) => `Niska nezaposlenost (${v.toFixed(1)}%) — tržište rada blizu pune zaposlenosti.`,
    flagIfBad: (v) => `Visoka nezaposlenost (${v.toFixed(1)}%) — iznad praga od 10%, značajan deo radne snage bez posla.`,
  },
  {
    // Gini je ANKETNI podatak (kućne ankete, ne redovno godišnje izveštavanje)
    // — World Bank pokrivenost je rupičava za mnoge zemlje (i bogate i
    // siromašne), pa je OSTAVLJEN SAMO INFORMATIVNO (prikazuje se kad
    // postoji, ne ulazi u skor ni zastavice) da jedna zemlja ne bi bila
    // kažnjena/nagrađena samo zato što joj je anketa skorija ili starija.
    code: "SI.POV.GINI",
    label: "Gini koeficijent (nejednakost dohotka)",
    unit: "index",
    dimension: "trziste-rada",
    tone: () => "unknown",
  },
  {
    // Bruto nacionalna štednja — standardni nacionalni-računi agregat sa
    // znatno širom pokrivenošću od IMF GFS serija (dug/bilans ispod), pa je
    // ovo pokazatelj koji NOSI skor za dimenziju "Fiskalna i finansijska
    // snaga" umesto duga/bilansa.
    code: "NY.GNS.ICTR.ZS",
    label: "Bruto nacionalna štednja (% BDP-a)",
    unit: "percent",
    dimension: "fiskalno",
    tone: (v) => (v == null ? "unknown" : v >= 25 ? "good" : v >= 15 ? "neutral" : "bad"),
    flagIfGood: (v) => `Visoka nacionalna štednja (${v.toFixed(1)}% BDP-a) — iznad praga od 25%, snažan kapacitet da se investicije finansiraju iz sopstvenih izvora.`,
    flagIfBad: (v) => `Niska nacionalna štednja (${v.toFixed(1)}% BDP-a) — ispod praga od 15%, slab kapacitet za samostalno finansiranje investicija.`,
  },
  {
    // Javni dug (World Bank/IMF GFS) — poznato rupičava pokrivenost čak i za
    // velike, razvijene ekonomije (npr. Švedska) jer mnoge zemlje prijavljuju
    // ove podatke kroz Eurostat/IMF Article IV, ne kroz WB-ov GFS format.
    // OSTAVLJEN INFORMATIVNO — prikazuje se kad postoji, ali ne ulazi u skor,
    // da nedostatak podatka za jednu zemlju ne bi oduzimao poene koje druga
    // zemlja "dobija" samo zato što njen dug WB slučajno ima u bazi.
    code: "GC.DOD.TOTL.GD.ZS",
    label: "Javni dug (% BDP-a)",
    unit: "percent",
    dimension: "fiskalno",
    tone: () => "unknown",
  },
  {
    // Fiskalni bilans — ista napomena i isti razlog kao kod javnog duga
    // iznad (IMF GFS, rupičava pokrivenost).
    code: "GC.BAL.CASH.GD.ZS",
    label: "Fiskalni bilans (% BDP-a)",
    unit: "percent",
    dimension: "fiskalno",
    tone: () => "unknown",
  },
  {
    code: "BN.CAB.XOKA.GD.ZS",
    label: "Saldo tekućeg računa (% BDP-a)",
    unit: "percent",
    dimension: "spoljno",
    // "Good" traži stvarni suficit (≥0%), ne samo "mali deficit" — hroničan
    // deficit tekućeg računa, čak i mali, znači trajnu zavisnost od priliva
    // stranog kapitala da bi se finansirao uvoz.
    tone: (v) => (v == null ? "unknown" : v >= 0 ? "good" : v >= -4 ? "neutral" : "bad"),
    flagIfGood: (v) => `Suficit tekućeg računa (${v.toFixed(1)}% BDP-a) — ekonomija je neto izvoznik kapitala, nema zavisnosti od stranog finansiranja.`,
    flagIfBad: (v) => `Veliki deficit tekućeg računa (${Math.abs(v).toFixed(1)}% BDP-a) — iznad praga od 4%, ekonomija zavisi od priliva stranog kapitala da bi finansirala uvoz.`,
  },
  {
    code: "NE.TRD.GNFS.ZS",
    label: "Otvorenost trgovine (izvoz+uvoz, % BDP-a)",
    unit: "percent",
    dimension: "spoljno",
    tone: () => "unknown", // informativno — veće nije automatski "bolje" (zavisi od veličine/strukture ekonomije)
  },
  {
    code: "BX.KLT.DINV.WD.GD.ZS",
    label: "Neto priliv direktnih stranih investicija (% BDP-a)",
    unit: "percent",
    dimension: "spoljno",
    tone: (v) => (v == null ? "unknown" : v > 3 ? "good" : v >= 0 ? "neutral" : "bad"),
    flagIfGood: (v) => `Visok priliv stranih direktnih investicija (${v.toFixed(1)}% BDP-a) — znak poverenja stranih investitora.`,
    flagIfBad: (v) => `Neto odliv stranih direktnih investicija (${v.toFixed(1)}% BDP-a) — više kapitala napušta zemlju nego što ulazi.`,
  },
];

export const DIMENSION_LABELS: Record<IndicatorDef["dimension"], string> = {
  rast: "Rast ekonomije",
  razvoj: "Razvoj i životni standard",
  cene: "Cene (inflacija)",
  fiskalno: "Fiskalna i finansijska snaga",
  spoljno: "Spoljni sektor",
  "trziste-rada": "Tržište rada i nejednakost",
};

export interface CountrySignal {
  label: string;
  tone: "good" | "bad";
}

export interface DimensionResult {
  key: IndicatorDef["dimension"];
  label: string;
  score: number | null; // 1-5, prosek tona pokazatelja koji imaju jasan sud (good/neutral/bad)
}

export interface CountryModel {
  dimensions: DimensionResult[];
  composite: number | null;
  greenSignals: CountrySignal[];
  redSignals: CountrySignal[];
}

function toneToScore(tone: Tone): number | null {
  if (tone === "good") return 5;
  if (tone === "neutral") return 3;
  if (tone === "bad") return 1;
  return null;
}

export function buildCountryModel(indicators: Record<string, IndicatorPoint>): CountryModel {
  const greenSignals: CountrySignal[] = [];
  const redSignals: CountrySignal[] = [];
  const dimensionScores = new Map<IndicatorDef["dimension"], number[]>();

  for (const def of INDICATOR_DEFS) {
    const point = indicators[def.code];
    const value = point?.value ?? null;
    const tone = def.tone(value);
    const score = toneToScore(tone);
    if (score != null) {
      const arr = dimensionScores.get(def.dimension) ?? [];
      arr.push(score);
      dimensionScores.set(def.dimension, arr);
    }
    if (value != null) {
      if (tone === "good" && def.flagIfGood) greenSignals.push({ label: def.flagIfGood(value), tone: "good" });
      if (tone === "bad" && def.flagIfBad) redSignals.push({ label: def.flagIfBad(value), tone: "bad" });
    }
  }

  const dimensions: DimensionResult[] = (Object.keys(DIMENSION_LABELS) as IndicatorDef["dimension"][]).map((key) => {
    const scores = dimensionScores.get(key);
    return {
      key,
      label: DIMENSION_LABELS[key],
      score: scores && scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null,
    };
  });

  const allScores = dimensions.map((d) => d.score).filter((s): s is number => s != null);
  const composite = allScores.length ? allScores.reduce((a, b) => a + b, 0) / allScores.length : null;

  return { dimensions, composite, greenSignals, redSignals };
}

export function fmtIndicatorValue(def: IndicatorDef, point: IndicatorPoint | undefined): string {
  if (!point || point.value == null) return "—";
  const v = point.value;
  if (def.unit === "percent") return `${v.toFixed(1)}%`;
  if (def.unit === "usd") {
    if (Math.abs(v) >= 1000) return `${(v / 1000).toFixed(1)}k USD`;
    return `${v.toFixed(0)} USD`;
  }
  if (def.unit === "years") return `${v.toFixed(1)} god.`;
  if (def.unit === "index") return v.toFixed(1);
  // number (npr. stanovništvo)
  if (Math.abs(v) >= 1e9) return `${(v / 1e9).toFixed(2)} mlrd.`;
  if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(1)} mil.`;
  if (Math.abs(v) >= 1e3) return `${(v / 1e3).toFixed(0)} hilj.`;
  return v.toLocaleString("en-US");
}

export function toneColorClass(tone: Tone): string {
  if (tone === "good") return "text-emerald-600 dark:text-emerald-400";
  if (tone === "bad") return "text-red-600 dark:text-red-400";
  if (tone === "neutral") return "text-amber-600 dark:text-amber-400";
  return "text-zinc-400";
}
