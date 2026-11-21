// Trend i kursne formacije — deterministička analiza (bez AI): nalazi lokalne
// vrhove i dna ("zigzag"), iz njih prepoznaje klasične formacije i procenjuje
// trend iz nekoliko nezavisnih signala. Radi nad istim nizom cena koji
// prikazuje grafikon (lib/corrections.ts: PricePoint).
//
// Važno: prepoznavanje formacija je po prirodi delimično subjektivno; ovde je
// svako pravilo fiksno i dokumentovano, pa je rezultat ponovljiv, ali je to
// opis oblika grafikona, a ne predviđanje. Istorijski, klasične formacije
// imaju skromnu pouzdanost; "cilj" formacije je samo geometrijska mera.

import type { PricePoint, RangeId, SeriesSource } from "@/lib/corrections";

export interface Pivot {
  ts: number;
  price: number;
  type: "H" | "L";
  confirmed: boolean; // false = trenutno najviša/najniža tačka tekućeg talasa
}

// Najmanji obrnuti pomak (razlomak) da bi se vrh/dno računalo, po periodu.
export const SWING_THRESHOLD: Record<RangeId, number> = {
  "1N": 0.008,
  "1M": 0.03,
  YTD: 0.05,
  "1G": 0.06,
  "3G": 0.1,
  "5G": 0.12,
  "10G": 0.15,
  "20G": 0.2,
  MAX: 0.25,
};

export function zigzag(points: PricePoint[], thr: number): Pivot[] {
  const n = points.length;
  if (n < 3) return [];
  const c = points.map((p) => p.close);
  const out: Pivot[] = [];
  const push = (i: number, type: "H" | "L", confirmed = true) =>
    out.push({ ts: points[i].timestamp, price: c[i], type, confirmed });
  let dir = 0;
  let hi = 0;
  let lo = 0;
  for (let i = 1; i < n; i++) {
    if (dir === 0) {
      if (c[i] > c[hi]) hi = i;
      if (c[i] < c[lo]) lo = i;
      if (c[i] <= c[hi] * (1 - thr)) {
        push(hi, "H");
        dir = -1;
        lo = i;
      } else if (c[i] >= c[lo] * (1 + thr)) {
        push(lo, "L");
        dir = 1;
        hi = i;
      }
    } else if (dir === 1) {
      if (c[i] > c[hi]) hi = i;
      else if (c[i] <= c[hi] * (1 - thr)) {
        push(hi, "H");
        dir = -1;
        lo = i;
      }
    } else {
      if (c[i] < c[lo]) lo = i;
      else if (c[i] >= c[lo] * (1 + thr)) {
        push(lo, "L");
        dir = 1;
        hi = i;
      }
    }
  }
  if (dir === 1) push(hi, "H", false);
  else if (dir === -1) push(lo, "L", false);
  return out;
}

// ---------------------------------------------------------------- trend

export type Direction = "up" | "down" | "side";

export interface TrendResult {
  direction: Direction;
  label: string; // npr. "Uzlazni trend"
  score: number; // -5..+5
  changePct: number; // promena cene od početka do kraja perioda
  r2: number; // pravilnost trenda (0..1) — koliko se cena drži jedne prave
  structure: "HH-HL" | "LH-LL" | "mesovito" | "nedovoljno";
  maFast: number | null;
  maSlow: number | null;
  maFastN: number;
  maSlowN: number;
  distFromHigh: number; // <= 0: koliko je cena ispod najvišeg u periodu
  reasons: string[];
}

function sma(values: number[], n: number): number | null {
  if (n < 2 || values.length < n) return null;
  let s = 0;
  for (let i = values.length - n; i < values.length; i++) s += values[i];
  return s / n;
}

// Regresija ln(cena) po vremenu: nagib i R².
function regression(points: PricePoint[]): { fitted: number; r2: number } {
  const n = points.length;
  const t0 = points[0].timestamp;
  const span = points[n - 1].timestamp - t0 || 1;
  const xs = points.map((p) => (p.timestamp - t0) / span);
  const ys = points.map((p) => Math.log(p.close));
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  const slope = sxx ? sxy / sxx : 0;
  const r2 = sxx && syy ? (sxy * sxy) / (sxx * syy) : 0;
  return { fitted: Math.exp(slope) - 1, r2 };
}

const MA_CAP: Record<SeriesSource, [number, number]> = { daily: [50, 200], weekly: [10, 40], intraday: [0, 0] };

export function analyzeTrend(points: PricePoint[], range: RangeId, source: SeriesSource, pivots?: Pivot[]): TrendResult | null {
  const n = points.length;
  if (n < 8) return null;
  const closes = points.map((p) => p.close);
  const last = closes[n - 1];
  const { fitted, r2 } = regression(points);
  const changePct = last / closes[0] - 1;
  const pv = pivots ?? zigzag(points, SWING_THRESHOLD[range]);

  const reasons: string[] = [];
  let score = 0;

  // 1) pravac i pravilnost regresije
  if (Math.abs(fitted) >= 0.03) {
    const sign = fitted > 0 ? 1 : -1;
    const w = r2 >= 0.6 ? 2 : r2 >= 0.3 ? 1 : 0;
    score += sign * w;
    if (w > 0) reasons.push(`Cena se ${r2 >= 0.6 ? "dosledno" : "donekle"} ${sign > 0 ? "kreće naviše" : "kreće naniže"} kroz period (pravilnost trenda ${(r2 * 100).toFixed(0)}%).`);
    else reasons.push("Cena je kroz period neujednačena — nema pravilnog pravca.");
  } else {
    reasons.push("Ukupna promena kroz period je mala — cena je u suštini ostala na istom nivou.");
  }

  // 2) struktura vrhova i dna
  const highs = pv.filter((p) => p.type === "H");
  const lows = pv.filter((p) => p.type === "L");
  let structure: TrendResult["structure"] = "nedovoljno";
  if (highs.length >= 2 && lows.length >= 2) {
    const hh = highs[highs.length - 1].price > highs[highs.length - 2].price;
    const hl = lows[lows.length - 1].price > lows[lows.length - 2].price;
    if (hh && hl) {
      structure = "HH-HL";
      score += 1;
      reasons.push("Poslednji vrhovi i dna su viši od prethodnih (viši vrhovi, viša dna) — klasičan znak uzlaznog trenda.");
    } else if (!hh && !hl) {
      structure = "LH-LL";
      score -= 1;
      reasons.push("Poslednji vrhovi i dna su niži od prethodnih (niži vrhovi, niža dna) — klasičan znak silaznog trenda.");
    } else {
      structure = "mesovito";
      reasons.push("Vrhovi i dna ne idu u istom smeru — struktura je mešovita.");
    }
  }

  // 3) i 4) pokretni proseci (dnevni 50/200, nedeljni 10/40; kraći periodi srazmerno)
  const [fCap, sCap] = MA_CAP[source];
  const fastN = fCap ? Math.max(3, Math.min(fCap, Math.round(n / 5))) : 0;
  const slowN = sCap ? Math.max(fastN + 2, Math.min(sCap, Math.round(n / 2))) : 0;
  const maFast = sma(closes, fastN);
  const maSlow = sma(closes, slowN);
  if (maSlow != null && maFast != null) {
    if (last > maSlow) {
      score += 1;
      reasons.push("Cena je iznad dugog proseka — kupci drže prevagu.");
    } else {
      score -= 1;
      reasons.push("Cena je ispod dugog proseka — prodavci drže prevagu.");
    }
    if (maFast > maSlow) {
      score += 1;
      reasons.push("Kratki prosek je iznad dugog — srednjoročni zamah je pozitivan.");
    } else {
      score -= 1;
      reasons.push("Kratki prosek je ispod dugog — srednjoročni zamah je negativan.");
    }
  }

  const high = Math.max(...closes);
  const distFromHigh = last / high - 1;
  if (distFromHigh >= -0.03) reasons.push("Cena je u blizini najvišeg nivoa u periodu.");
  else if (distFromHigh <= -0.2) reasons.push(`Cena je ${(Math.abs(distFromHigh) * 100).toFixed(0)}% ispod najvišeg nivoa u periodu.`);

  let direction: Direction;
  let label: string;
  if (score >= 4) {
    direction = "up";
    label = "Jak uzlazni trend";
  } else if (score >= 2) {
    direction = "up";
    label = "Uzlazni trend";
  } else if (score <= -4) {
    direction = "down";
    label = "Jak silazni trend";
  } else if (score <= -2) {
    direction = "down";
    label = "Silazni trend";
  } else {
    direction = "side";
    label = "Bočni / neodređen trend";
  }
  return { direction, label, score, changePct, r2, structure, maFast, maSlow, maFastN: fastN, maSlowN: slowN, distFromHigh, reasons };
}

// ------------------------------------------------------------- formacije

export type Bias = "bikovska" | "medvedja" | "neutralna";
export type PatternStatus = "u formiranju" | "potvrđena" | "probijena";

export interface Pattern {
  id: string;
  name: string;
  bias: Bias;
  status: PatternStatus;
  description: string;
  // za crtanje na grafikonu
  points: { ts: number; price: number }[];
  lines: { a: { ts: number; price: number }; b: { ts: number; price: number } }[];
  level: { label: string; price: number } | null; // npr. linija vrata
  target: number | null; // geometrijski cilj (visina formacije)
  startTs: number;
  endTs: number;
}

const fmt = (x: number) => (x >= 100 ? x.toFixed(0) : x.toFixed(2));

function between(pv: Pivot[], a: Pivot, b: Pivot, type: "H" | "L"): Pivot | null {
  const mid = pv.filter((p) => p.type === type && p.ts > a.ts && p.ts < b.ts);
  if (!mid.length) return null;
  return mid.reduce((m, p) => (type === "L" ? (p.price < m.price ? p : m) : p.price > m.price ? p : m));
}

function detectDouble(pv: Pivot[], last: PricePoint, t0: number, t1: number, max: number, min: number, top: boolean): Pattern | null {
  const type = top ? "H" : "L";
  const ext = pv.filter((p) => p.type === type);
  if (ext.length < 2) return null;
  const b = ext[ext.length - 1];
  const a = ext[ext.length - 2];
  const mid = between(pv, a, b, top ? "L" : "H");
  if (!mid) return null;
  if (Math.abs(b.price / a.price - 1) > 0.035) return null;
  // oba ekstrema blizu ekstrema perioda; formacija završena u zadnjoj polovini
  if (top ? Math.min(a.price, b.price) < max * 0.93 : Math.max(a.price, b.price) > min * 1.07) return null;
  if (b.ts < t0 + (t1 - t0) * 0.5) return null;
  const level = mid.price;
  const height = Math.abs((a.price + b.price) / 2 - level);
  // invalidirano ako je cena već jasno prešla ekstreme
  if (top ? last.close > Math.max(a.price, b.price) * 1.02 : last.close < Math.min(a.price, b.price) * 0.98) return null;
  const broken = top ? last.close < level * 0.995 : last.close > level * 1.005;
  const target = top ? level - height : level + height;
  return {
    id: top ? "dvostruki-vrh" : "dvostruko-dno",
    name: top ? "Dvostruki vrh" : "Dvostruko dno",
    bias: top ? "medvedja" : "bikovska",
    status: broken ? "potvrđena" : "u formiranju",
    description: top
      ? `Cena je dvaput zastala na istom nivou (~${fmt((a.price + b.price) / 2)}) i odbila se. ${broken ? `Probijena je linija vrata (${fmt(level)}) naniže, što potvrđuje formaciju.` : `Potvrda bi bila probijanje linije vrata (${fmt(level)}) naniže.`}`
      : `Cena je dvaput testirala isti nivo (~${fmt((a.price + b.price) / 2)}) i odbila se naviše. ${broken ? `Probijena je linija vrata (${fmt(level)}) naviše, što potvrđuje formaciju.` : `Potvrda bi bila probijanje linije vrata (${fmt(level)}) naviše.`}`,
    points: [a, mid, b].map((p) => ({ ts: p.ts, price: p.price })),
    lines: [{ a: { ts: a.ts, price: level }, b: { ts: last.timestamp, price: level } }],
    level: { label: "Linija vrata", price: level },
    target,
    startTs: a.ts,
    endTs: last.timestamp,
  };
}

function detectHeadShoulders(pv: Pivot[], last: PricePoint, t0: number, t1: number, top: boolean): Pattern | null {
  const type = top ? "H" : "L";
  const ext = pv.filter((p) => p.type === type);
  if (ext.length < 3) return null;
  const [s1, head, s2] = ext.slice(-3);
  const better = (x: number, y: number) => (top ? x > y : x < y);
  const margin = (x: number, y: number) => (top ? x / y - 1 : y / x - 1);
  if (!better(head.price, s1.price) || !better(head.price, s2.price)) return null;
  if (margin(head.price, s1.price) < 0.03 || margin(head.price, s2.price) < 0.03) return null;
  if (Math.abs(s1.price / s2.price - 1) > 0.12) return null;
  const n1 = between(pv, s1, head, top ? "L" : "H");
  const n2 = between(pv, head, s2, top ? "L" : "H");
  if (!n1 || !n2) return null;
  if (Math.abs(n1.price / n2.price - 1) > 0.06) return null;
  if (s2.ts < t0 + (t1 - t0) * 0.5) return null;
  const neck = (n1.price + n2.price) / 2;
  if (top ? last.close > head.price : last.close < head.price) return null;
  const broken = top ? last.close < neck * 0.995 : last.close > neck * 1.005;
  const height = Math.abs(head.price - neck);
  return {
    id: top ? "glava-ramena" : "obrnuta-glava-ramena",
    name: top ? "Glava i ramena" : "Obrnuta glava i ramena",
    bias: top ? "medvedja" : "bikovska",
    status: broken ? "potvrđena" : "u formiranju",
    description: top
      ? `Tri vrha, srednji (glava, ${fmt(head.price)}) viši od oba ramena. Klasična formacija obrta uzlaznog trenda. ${broken ? `Linija vrata (${fmt(neck)}) je probijena naniže.` : `Potvrda je probijanje linije vrata (${fmt(neck)}) naniže.`}`
      : `Tri dna, srednje (glava, ${fmt(head.price)}) dublje od oba ramena. Klasična formacija obrta silaznog trenda. ${broken ? `Linija vrata (${fmt(neck)}) je probijena naviše.` : `Potvrda je probijanje linije vrata (${fmt(neck)}) naviše.`}`,
    points: [s1, n1, head, n2, s2].map((p) => ({ ts: p.ts, price: p.price })),
    lines: [{ a: { ts: n1.ts, price: neck }, b: { ts: last.timestamp, price: neck } }],
    level: { label: "Linija vrata", price: neck },
    target: top ? neck - height : neck + height,
    startTs: s1.ts,
    endTs: last.timestamp,
  };
}

// Prava kroz tačke (najmanji kvadrati u log-ceni; x = vreme normalizovano na [0,1]).
function fitLine(pts: { x: number; y: number }[]): { a: number; b: number } {
  const n = pts.length;
  const mx = pts.reduce((s, p) => s + p.x, 0) / n;
  const my = pts.reduce((s, p) => s + p.y, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (const p of pts) {
    sxy += (p.x - mx) * (p.y - my);
    sxx += (p.x - mx) ** 2;
  }
  const b = sxx ? sxy / sxx : 0;
  return { a: my - b * mx, b };
}

function detectChannel(pv: Pivot[], last: PricePoint): Pattern | null {
  for (const m of [8, 7, 6, 5]) {
    const seg = pv.slice(-m);
    if (seg.length < 5) continue;
    const highs = seg.filter((p) => p.type === "H");
    const lows = seg.filter((p) => p.type === "L");
    if (highs.length < 2 || lows.length < 2) continue;
    const ts0 = seg[0].ts;
    const span = last.timestamp - ts0;
    if (span <= 0) continue;
    const X = (ts: number) => (ts - ts0) / span;
    const H = fitLine(highs.map((p) => ({ x: X(p.ts), y: Math.log(p.price) })));
    const L = fitLine(lows.map((p) => ({ x: X(p.ts), y: Math.log(p.price) })));
    const w0 = H.a - L.a;
    const w1 = H.a + H.b - (L.a + L.b);
    if (w0 <= 0.01 || w1 <= 0.005) continue;
    const avgW = (w0 + w1) / 2;
    // sve tačke moraju stati u kanal sa malom tolerancijom
    const fits = seg.every((p) => {
      const x = X(p.ts);
      const line = p.type === "H" ? H.a + H.b * x : L.a + L.b * x;
      return Math.abs(Math.log(p.price) - line) <= 0.3 * (H.a + H.b * x - (L.a + L.b * x));
    });
    if (!fits) continue;

    const flatTol = 0.2 * avgW;
    const dir = (d: number) => (Math.abs(d) < flatTol ? 0 : d > 0 ? 1 : -1);
    const dH = dir(H.b);
    const dL = dir(L.b);
    const ratio = w1 / w0;
    const converging = ratio < 0.7;
    const parallel = ratio >= 0.8 && ratio <= 1.25;
    const yH1 = Math.exp(H.a + H.b);
    const yL1 = Math.exp(L.a + L.b);
    const brokenUp = last.close > yH1 * 1.015;
    const brokenDown = last.close < yL1 * 0.985;
    // cena mora biti u blizini kanala (ili tek probila)
    if (last.close > yH1 * 1.08 || last.close < yL1 * 0.92) continue;

    let name: string | null = null;
    let bias: Bias = "neutralna";
    let desc = "";
    if (parallel && dH === 0 && dL === 0) {
      name = "Bočni kanal (konsolidacija)";
      desc = `Cena se kreće između horizontalne podrške (~${fmt(yL1)}) i otpora (~${fmt(yH1)}). Smer sledećeg kretanja određuje probijanje jedne od granica.`;
    } else if (parallel && dH > 0 && dL > 0) {
      name = "Rastući kanal";
      bias = "bikovska";
      desc = `Vrhovi i dna rastu paralelno — uređen uzlazni trend. Podrška je trenutno oko ${fmt(yL1)}, otpor oko ${fmt(yH1)}.`;
    } else if (parallel && dH < 0 && dL < 0) {
      name = "Padajući kanal";
      bias = "medvedja";
      desc = `Vrhovi i dna padaju paralelno — uređen silazni trend. Podrška je trenutno oko ${fmt(yL1)}, otpor oko ${fmt(yH1)}.`;
    } else if (converging && dH === 0 && dL > 0) {
      name = "Rastući trougao";
      bias = "bikovska";
      desc = `Otpor je horizontalan (~${fmt(yH1)}) dok dna rastu — kupci sve agresivnije podižu cenu ka otporu. Češće se probija naviše.`;
    } else if (converging && dL === 0 && dH < 0) {
      name = "Padajući trougao";
      bias = "medvedja";
      desc = `Podrška je horizontalna (~${fmt(yL1)}) dok vrhovi padaju — prodavci sve agresivnije spuštaju cenu ka podršci. Češće se probija naniže.`;
    } else if (converging && dH < 0 && dL > 0) {
      name = "Simetrični trougao";
      desc = `Vrhovi padaju, a dna rastu — kretanje se sužava ka apeksu. Smer probijanja nije unapred određen.`;
    } else if (converging && dH > 0 && dL > 0) {
      name = "Rastući klin";
      bias = "medvedja";
      desc = `Cena raste, ali se raspon sužava — rast gubi snagu. Rastući klin se češće završava padom.`;
    } else if (converging && dH < 0 && dL < 0) {
      name = "Padajući klin";
      bias = "bikovska";
      desc = `Cena pada, ali se raspon sužava — pad gubi snagu. Padajući klin se češće završava rastom.`;
    }
    if (!name) continue;

    let status: PatternStatus = "u formiranju";
    if (brokenUp || brokenDown) {
      status = "probijena";
      desc += ` Cena je već probila ${brokenUp ? "gornju" : "donju"} granicu${bias === "neutralna" ? `, što sugeriše nastavak ${brokenUp ? "naviše" : "naniže"}` : ""}.`;
      if (bias === "neutralna") bias = brokenUp ? "bikovska" : "medvedja";
    }
    const lineAt = (l: { a: number; b: number }, x: number) => Math.exp(l.a + l.b * x);
    return {
      id: name.toLowerCase().replace(/[^a-zčćšđž]+/g, "-"),
      name,
      bias,
      status,
      description: desc,
      points: seg.map((p) => ({ ts: p.ts, price: p.price })),
      lines: [
        { a: { ts: ts0, price: lineAt(H, 0) }, b: { ts: last.timestamp, price: lineAt(H, 1) } },
        { a: { ts: ts0, price: lineAt(L, 0) }, b: { ts: last.timestamp, price: lineAt(L, 1) } },
      ],
      level: null,
      target: null,
      startTs: ts0,
      endTs: last.timestamp,
    };
  }
  return null;
}

export function detectPatterns(points: PricePoint[], range: RangeId, pivots?: Pivot[]): Pattern[] {
  const n = points.length;
  if (n < 12) return [];
  const pv = pivots ?? zigzag(points, SWING_THRESHOLD[range]);
  if (pv.length < 4) return [];
  const last = points[n - 1];
  const t0 = points[0].timestamp;
  const t1 = last.timestamp;
  const closes = points.map((p) => p.close);
  const max = Math.max(...closes);
  const min = Math.min(...closes);
  const found = [
    detectHeadShoulders(pv, last, t0, t1, true),
    detectHeadShoulders(pv, last, t0, t1, false),
    detectDouble(pv, last, t0, t1, max, min, true),
    detectDouble(pv, last, t0, t1, max, min, false),
    detectChannel(pv, last),
  ].filter((p): p is Pattern => p !== null);
  // novije i potvrđene prvo
  return found.sort((a, b) => b.endTs - a.endTs || (a.status === "potvrđena" ? -1 : 1));
}

// ------------------------------------------------------------- zaključci

// Šta se iz pojedine formacije može zaključiti, šta je potvrđuje a šta poništava.
export function implication(p: Pattern): string {
  const confirmed = p.status === "potvrđena";
  const top = Math.max(...p.points.map((x) => x.price));
  const bottom = Math.min(...p.points.map((x) => x.price));
  const tgt = p.target != null ? ` Geometrijski cilj (visina formacije primenjena od linije vrata) je oko ${fmt(p.target)}.` : "";
  const neck = p.level ? fmt(p.level.price) : "";
  switch (p.id) {
    case "dvostruki-vrh":
      return confirmed
        ? `Kupci dvaput nisu uspeli da pređu isti nivo, a sada je pukla i podrška (${neck}). To sugeriše da se rast završio i da sledi pad ili duža korekcija.${tgt} Zaključak se poništava ako cena ponovo zatvori iznad vrha (~${fmt(top)}).`
        : `Dvaput je odbijen otpor oko ${fmt(top)}, što je upozorenje da rast slabi. Dok linija vrata (${neck}) ne pukne, to je samo signal opreza, ne obrt. Zaključak se poništava ako cena zatvori iznad ${fmt(top)}.`;
    case "dvostruko-dno":
      return confirmed
        ? `Prodavci dvaput nisu uspeli da spuste cenu ispod istog nivoa, a sada je probijen i otpor (${neck}). To sugeriše da je pad završen i da sledi oporavak.${tgt} Zaključak se poništava ako cena zatvori ispod dna (~${fmt(bottom)}).`
        : `Podrška oko ${fmt(bottom)} je dvaput izdržala, što je znak da prodavci slabe. Dok otpor (${neck}) ne pukne, to je samo signal moguće promene smera. Zaključak se poništava ako cena zatvori ispod ${fmt(bottom)}.`;
    case "glava-ramena":
      return confirmed
        ? `Najpouzdanija klasična formacija obrta: uzlazni trend je izgubio snagu (glava je poslednji pokušaj), a linija vrata (${neck}) je probijena. Sugeriše prelazak u silazni trend.${tgt} Poništava se ako cena ponovo pređe vrh desnog ramena.`
        : `Oblik je prepoznat, ali nije potvrđen: dok cena ne zatvori ispod linije vrata (${neck}), uzlazni trend se i dalje nije slomio. Poništava se ako cena pređe vrh glave (${fmt(top)}).`;
    case "obrnuta-glava-ramena":
      return confirmed
        ? `Klasična formacija obrta: silazni trend je izgubio snagu, a linija vrata (${neck}) je probijena naviše. Sugeriše prelazak u uzlazni trend.${tgt} Poništava se ako cena zatvori ispod dna desnog ramena.`
        : `Oblik je prepoznat, ali nije potvrđen: dok cena ne zatvori iznad linije vrata (${neck}), silazni trend se nije slomio. Poništava se ako cena padne ispod dna glave (${fmt(bottom)}).`;
    case "rastući-trougao":
      return p.status === "probijena"
        ? "Otpor je probijen naviše uz rastuća dna — potvrda nastavka rasta. Probijeni otpor često postaje nova podrška."
        : "Kupci sve višim dnima pritiskaju isti otpor. Najčešći ishod je probijanje naviše, ali tek zatvaranje iznad otpora to potvrđuje; pad ispod linije rastućih dna poništava formaciju.";
    case "padajući-trougao":
      return p.status === "probijena"
        ? "Podrška je probijena naniže uz opadajuće vrhove — potvrda nastavka pada."
        : "Prodavci sve nižim vrhovima pritiskaju istu podršku. Najčešći ishod je probijanje naniže, ali tek zatvaranje ispod podrške to potvrđuje; rast iznad linije opadajućih vrhova poništava formaciju.";
    case "simetrični-trougao":
      return p.status === "probijena"
        ? "Cena je napustila trougao — smer probijanja pokazuje smer nastavka, najčešće u pravcu trenda koji je prethodio formaciji."
        : "Sužavanje raspona znači da se energija skuplja; smer nije unapred poznat, a najčešće je u pravcu trenda koji je prethodio formaciji. Pravi signal je tek zatvaranje izvan trougla.";
    case "rastući-klin":
      return "Rast se nastavlja uz sve manji raspon, što obično znači slabljenje zamaha. Najčešće se završava probijanjem naniže, ali dok donja linija ne pukne, trend naviše ostaje na snazi.";
    case "padajući-klin":
      return "Pad se nastavlja uz sve manji raspon, što obično znači slabljenje pritiska prodavaca. Najčešće se završava probijanjem naviše, ali dok gornja linija ne pukne, trend naniže ostaje na snazi.";
    case "rastući-kanal":
      return "Uređen uzlazni trend: svaka korekcija se zaustavlja na višem nivou. Dok cena ostaje u kanalu, trend je netaknut; zatvaranje ispod donje linije bi bilo upozorenje na slabljenje.";
    case "padajući-kanal":
      return "Uređen silazni trend: svaki odskok staje na nižem nivou. Dok cena ostaje u kanalu, trend je netaknut; zatvaranje iznad gornje linije bi bilo prvi znak da pritisak popušta.";
    default:
      return p.name.startsWith("Bočni")
        ? "Ravnoteža kupaca i prodavaca: cena se kreće između podrške i otpora. Nema usmerenog trenda dok jedna od granica ne pukne; probijanje uz porast prometa je pouzdaniji signal."
        : "";
  }
}

// Zbirni zaključak: spaja trend i formacije.
export function conclusion(trend: TrendResult, patterns: Pattern[]): string {
  const dir = trend.direction;
  const dirText = dir === "up" ? "uzlazni" : dir === "down" ? "silazni" : "bočni";
  const parts: string[] = [`Trend izabranog perioda je ${dirText}.`];
  if (patterns.length === 0) {
    parts.push("Nema jasne klasične formacije, pa zaključak počiva samo na trendu: dok se struktura vrhova i dna ne promeni, razumno je očekivati nastavak postojećeg pravca, ali bez dodatne potvrde to je slabiji signal.");
    return parts.join(" ");
  }
  const reversals = patterns.filter((p) => (dir === "up" && p.bias === "medvedja") || (dir === "down" && p.bias === "bikovska"));
  const continuations = patterns.filter((p) => (dir === "up" && p.bias === "bikovska") || (dir === "down" && p.bias === "medvedja"));
  const names = (list: Pattern[]) => list.map((p) => `${p.name.toLowerCase()} (${p.status})`).join(", ");
  if (reversals.length) {
    const conf = reversals.some((p) => p.status !== "u formiranju");
    parts.push(
      `Prepoznata je formacija koja ide protiv trenda: ${names(reversals)}. ${
        conf
          ? "Pošto je potvrđena probijanjem, to je ozbiljno upozorenje na mogući obrt trenda."
          : "Još nije potvrđena, pa je to upozorenje na mogući obrt, a ne zaključak da se trend okrenuo."
      }`
    );
  }
  if (continuations.length) {
    parts.push(`Prepoznata je formacija u smeru trenda: ${names(continuations)}, što ide u prilog nastavku postojećeg pravca.`);
  }
  const neutral = patterns.filter((p) => !reversals.includes(p) && !continuations.includes(p));
  if (neutral.length) parts.push(`Neutralna formacija: ${names(neutral)} — smer određuje probijanje jedne od granica.`);
  parts.push("Najveću težinu ima potvrđena formacija (probijena linija vrata ili granica), a formacije u formiranju treba tretirati kao hipotezu koju cena tek treba da potvrdi.");
  return parts.join(" ");
}
