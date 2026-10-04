// Deterministička analiza makroekonomskih pokazatelja jedne zemlje — ista
// filozofija kao lib/model.ts za akcije: fiksni, dokumentovani pragovi nad
// javnim podacima (World Bank), bez subjektivne/AI procene. Svaki prag je
// opštepoznata, standardna granica u makroekonomiji (npr. inflacija iznad
// 10% se standardno smatra visokom, javni dug iznad 90% BDP-a je prag koji
// koriste i MMF/Svetska banka u svojim analizama održivosti duga) — nije
// izmišljen za potrebe ovog sajta.

import type { IndicatorCode, IndicatorPoint } from "@/app/api/country/route";

export type Tone = "good" | "neutral" | "bad" | "unknown";

export interface IndicatorDef {
  code: IndicatorCode;
  label: string;
  unit: "percent" | "usd" | "number" | "index";
  dimension: "rast" | "cene" | "fiskalno" | "spoljno" | "trziste-rada";
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
    tone: (v) => (v == null ? "unknown" : v >= 2 ? "good" : v >= 0 ? "neutral" : "bad"),
    flagIfGood: (v) => `Solidan rast BDP-a (${v.toFixed(1)}% godišnje) — ekonomija realno raste brže od svetskog proseka.`,
    flagIfBad: (v) => `Ekonomija se smanjuje (rast BDP-a ${v.toFixed(1)}%) — recesija u poslednjoj raspoloživoj godini.`,
  },
  {
    code: "NY.GDP.PCAP.CD",
    label: "BDP po glavi stanovnika",
    unit: "usd",
    dimension: "rast",
    tone: () => "unknown", // informativno (nivo bogatstva), namerno bez "dobro/loše" suda
  },
  {
    code: "FP.CPI.TOTL.ZG",
    label: "Inflacija (potrošačke cene)",
    unit: "percent",
    dimension: "cene",
    tone: (v) => (v == null ? "unknown" : v < 0 ? "bad" : v <= 4 ? "good" : v <= 10 ? "neutral" : "bad"),
    flagIfGood: (v) => `Inflacija pod kontrolom (${v.toFixed(1)}% godišnje) — blizu uobičajenog cilja centralnih banaka od ~2%.`,
    flagIfBad: (v) =>
      v < 0
        ? `Deflacija (${v.toFixed(1)}%) — padajuće cene mogu značiti slabu tražnju, rizik od odlaganja potrošnje.`
        : `Visoka inflacija (${v.toFixed(1)}% godišnje) — značajno iznad standardnog cilja od ~2%, erodira kupovnu moć i štednju.`,
  },
  {
    code: "SL.UEM.TOTL.ZS",
    label: "Nezaposlenost",
    unit: "percent",
    dimension: "trziste-rada",
    tone: (v) => (v == null ? "unknown" : v < 6 ? "good" : v <= 12 ? "neutral" : "bad"),
    flagIfGood: (v) => `Niska nezaposlenost (${v.toFixed(1)}%) — tržište rada blizu pune zaposlenosti.`,
    flagIfBad: (v) => `Visoka nezaposlenost (${v.toFixed(1)}%) — značajan deo radne snage bez posla.`,
  },
  {
    code: "GC.DOD.TOTL.GD.ZS",
    label: "Javni dug (% BDP-a)",
    unit: "percent",
    dimension: "fiskalno",
    tone: (v) => (v == null ? "unknown" : v < 60 ? "good" : v <= 90 ? "neutral" : "bad"),
    flagIfGood: (v) => `Nizak javni dug (${v.toFixed(0)}% BDP-a) — ispod uobičajenog praga održivosti od 60%.`,
    flagIfBad: (v) => `Visok javni dug (${v.toFixed(0)}% BDP-a) — iznad praga od 90% BDP-a koji MMF/Svetska banka tretiraju kao rizičnu zonu.`,
  },
  {
    code: "GC.BAL.CASH.GD.ZS",
    label: "Fiskalni bilans (% BDP-a)",
    unit: "percent",
    dimension: "fiskalno",
    tone: (v) => (v == null ? "unknown" : v >= -3 ? "good" : v >= -6 ? "neutral" : "bad"),
    flagIfGood: (v) => `Fiskalni bilans pod kontrolom (${v >= 0 ? "suficit" : "deficit"} ${Math.abs(v).toFixed(1)}% BDP-a) — ispod uobičajenog praga od 3% deficita.`,
    flagIfBad: (v) => `Veliki budžetski deficit (${Math.abs(v).toFixed(1)}% BDP-a) — iznad praga od 6%, dug raste brže od uobičajenog.`,
  },
  {
    code: "BN.CAB.XOKA.GD.ZS",
    label: "Saldo tekućeg računa (% BDP-a)",
    unit: "percent",
    dimension: "spoljno",
    tone: (v) => (v == null ? "unknown" : v >= -2 ? "good" : v >= -5 ? "neutral" : "bad"),
    flagIfGood: (v) => `Zdrav spoljni bilans (tekući račun ${v >= 0 ? "suficit" : "deficit"} ${Math.abs(v).toFixed(1)}% BDP-a) — nema velike zavisnosti od stranog finansiranja.`,
    flagIfBad: (v) => `Veliki deficit tekućeg računa (${Math.abs(v).toFixed(1)}% BDP-a) — ekonomija zavisi od priliva stranog kapitala da bi finansirala uvoz.`,
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
    code: "SI.POV.GINI",
    label: "Gini koeficijent (nejednakost dohotka)",
    unit: "index",
    dimension: "trziste-rada",
    tone: (v) => (v == null ? "unknown" : v < 30 ? "good" : v <= 40 ? "neutral" : "bad"),
    flagIfGood: (v) => `Niska nejednakost dohotka (Gini ${v.toFixed(0)}) — dohodak relativno ravnomerno raspoređen.`,
    flagIfBad: (v) => `Visoka nejednakost dohotka (Gini ${v.toFixed(0)}) — dohodak izrazito neravnomerno raspoređen.`,
  },
];

export const DIMENSION_LABELS: Record<IndicatorDef["dimension"], string> = {
  rast: "Rast i veličina ekonomije",
  cene: "Cene (inflacija)",
  fiskalno: "Fiskalno zdravlje",
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
