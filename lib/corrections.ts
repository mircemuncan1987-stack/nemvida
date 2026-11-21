// Korekcije cene akcije — čista, deterministička logika (bez AI): šta je
// korekcija, kako se otkriva iz niza zaključnih cena, i poređenje sa tržištem
// u istom periodu. Deli se između klijenta (grafikon, tabela) i servera
// (/api/corrections, koji samo objašnjava već pronađene korekcije).
//
// DEFINICIJA: korekcija je pad cene od najvišeg dotadašnjeg vrha (u
// prikazanom periodu) za bar PRAG procenata. Počinje na tom vrhu, "dno" je
// najniža cena pre nego što cena ponovo dostigne vrh, a završava se (oporavak)
// kad cena prvi put ponovo dostigne ili pređe taj vrh. Dugotrajan pad sa
// usputnim odskocima (npr. 2008–2009) je jedna korekcija, ne više njih. Rast
// se namerno ne analizira.
//
// Prag: 10% za periode od godinu dana i duže, 5% za nedelju, mesec i YTD
// (kod kratkih perioda pad od 10% je redak, pa bi lista bila prazna).
// Pad od 20% i više označava se kao "medveđi pad" (uobičajena konvencija).

export interface PricePoint {
  timestamp: number; // unix sekunde
  close: number;
}

export type RangeId = "1N" | "1M" | "YTD" | "1G" | "3G" | "5G" | "10G" | "20G" | "MAX";

// Izvor podataka: tri zahteva pokrivaju svih devet perioda (ostali se dobijaju
// sečenjem). Yahoo nema opseg od 3 ili 20 godina, pa se seče iz dužeg niza.
export type SeriesSource = "intraday" | "daily" | "weekly";

export interface RangeConfig {
  id: RangeId;
  label: string;
  source: SeriesSource;
  threshold: number; // minimalni pad (0.10 = 10%) da bi se računalo kao korekcija
  logScale: boolean; // duži periodi se crtaju logaritamski, da procentualni padovi budu uporedivi
}

export const RANGES: RangeConfig[] = [
  { id: "1N", label: "Nedelja", source: "intraday", threshold: 0.05, logScale: false },
  { id: "1M", label: "Mesec", source: "daily", threshold: 0.05, logScale: false },
  { id: "YTD", label: "YTD", source: "daily", threshold: 0.05, logScale: false },
  { id: "1G", label: "1 god.", source: "daily", threshold: 0.1, logScale: false },
  { id: "3G", label: "3 god.", source: "weekly", threshold: 0.1, logScale: false },
  { id: "5G", label: "5 god.", source: "weekly", threshold: 0.1, logScale: false },
  { id: "10G", label: "10 god.", source: "weekly", threshold: 0.1, logScale: true },
  { id: "20G", label: "20 god.", source: "weekly", threshold: 0.1, logScale: true },
  { id: "MAX", label: "Max", source: "weekly", threshold: 0.1, logScale: true },
];

export const SOURCE_REQUEST: Record<SeriesSource, { range: string; interval: string }> = {
  intraday: { range: "5d", interval: "15m" },
  daily: { range: "1y", interval: "1d" },
  weekly: { range: "max", interval: "1wk" },
};

// Početak prozora za izabrani period (unix sekunde); null = od početka niza.
export function windowStart(id: RangeId, nowMs: number): number | null {
  const now = new Date(nowMs);
  const back = (years: number, months = 0) => {
    const d = new Date(now);
    d.setUTCFullYear(d.getUTCFullYear() - years, d.getUTCMonth() - months);
    return Math.floor(d.getTime() / 1000);
  };
  switch (id) {
    case "1N":
      return null; // 5d niz je već tačno poslednjih 5 trgovačkih dana
    case "1M":
      return back(0, 1);
    case "YTD":
      return Math.floor(Date.UTC(now.getUTCFullYear(), 0, 1) / 1000);
    case "1G":
      return back(1);
    case "3G":
      return back(3);
    case "5G":
      return back(5);
    case "10G":
      return back(10);
    case "20G":
      return back(20);
    case "MAX":
      return null;
  }
}

export function sliceWindow(points: PricePoint[], id: RangeId, nowMs: number): PricePoint[] {
  const start = windowStart(id, nowMs);
  return start == null ? points : points.filter((p) => p.timestamp >= start);
}

export type CorrectionOrigin = "trziste" | "mesovito" | "specificno";

export interface Correction {
  peakTs: number;
  peakPrice: number;
  troughTs: number;
  troughPrice: number;
  depth: number; // negativan razlomak, npr. -0.23
  recoveryTs: number | null; // null = cena još nije dostigla stari vrh
  daysToTrough: number;
  daysToRecover: number | null; // od vrha do oporavka
  marketChange: number | null; // S&P 500 od istog vrha do istog dna
  origin: CorrectionOrigin | null;
}

const DAY = 86400;

export function detectCorrections(points: PricePoint[], threshold: number): Correction[] {
  const out: Correction[] = [];
  if (points.length < 2) return out;

  let peak = points[0];
  let inDrawdown = false;
  let trough = points[0];
  let episodePeak = points[0];

  const push = (recovery: PricePoint | null) => {
    out.push({
      peakTs: episodePeak.timestamp,
      peakPrice: episodePeak.close,
      troughTs: trough.timestamp,
      troughPrice: trough.close,
      depth: trough.close / episodePeak.close - 1,
      recoveryTs: recovery ? recovery.timestamp : null,
      daysToTrough: Math.max(0, Math.round((trough.timestamp - episodePeak.timestamp) / DAY)),
      daysToRecover: recovery ? Math.max(0, Math.round((recovery.timestamp - episodePeak.timestamp) / DAY)) : null,
      marketChange: null,
      origin: null,
    });
  };

  for (let i = 1; i < points.length; i++) {
    const p = points[i];
    if (!inDrawdown) {
      if (p.close >= peak.close) {
        peak = p;
      } else if (1 - p.close / peak.close >= threshold - 1e-9) {
        inDrawdown = true;
        episodePeak = peak;
        trough = p;
      }
    } else {
      if (p.close < trough.close) trough = p;
      if (p.close >= episodePeak.close) {
        push(p);
        inDrawdown = false;
        peak = p;
      }
    }
  }
  if (inDrawdown) push(null);
  return out;
}

function valueAt(points: PricePoint[], ts: number): number | null {
  if (points.length === 0) return null;
  // najbliža tačka po vremenu (nizovi su sortirani rastuće)
  let lo = 0;
  let hi = points.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid].timestamp < ts) lo = mid + 1;
    else hi = mid;
  }
  const a = points[lo];
  const b = lo > 0 ? points[lo - 1] : a;
  return Math.abs(a.timestamp - ts) <= Math.abs(b.timestamp - ts) ? a.close : b.close;
}

// Poređenje sa tržištem u istom periodu: koliko je S&P 500 promenio vrednost
// od datuma vrha do datuma dna akcije. Klasifikacija po odnosu pada tržišta i
// pada akcije: ako je tržište palo bar 60% koliko i akcija — korekcija je
// uglavnom tržišna; ako je palo manje od 30% koliko i akcija (ili je raslo) —
// specifična za kompaniju ili sektor; između — mešovito.
export function attachMarket(corrections: Correction[], market: PricePoint[]): Correction[] {
  return corrections.map((c) => {
    const a = valueAt(market, c.peakTs);
    const b = valueAt(market, c.troughTs);
    if (a == null || b == null || a <= 0) return c;
    const marketChange = b / a - 1;
    const ratio = marketChange / c.depth; // oba negativna → pozitivan odnos; tržište raslo → negativan
    const origin: CorrectionOrigin = ratio >= 0.6 ? "trziste" : ratio < 0.3 ? "specificno" : "mesovito";
    return { ...c, marketChange, origin };
  });
}

export const ORIGIN_LABEL: Record<CorrectionOrigin, string> = {
  trziste: "Uglavnom tržišni pad",
  mesovito: "Delom tržišni, delom specifičan",
  specificno: "Specifičan za kompaniju/sektor",
};

export function formatDay(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString("sr-Latn-RS", { day: "numeric", month: "short", year: "numeric" });
}

export function formatDuration(days: number): string {
  if (days < 14) return `${days} d.`;
  if (days < 90) return `${Math.round(days / 7)} ned.`;
  if (days < 730) return `${Math.round(days / 30.4)} mes.`;
  return `${(days / 365.25).toFixed(1).replace(".", ",")} god.`;
}
