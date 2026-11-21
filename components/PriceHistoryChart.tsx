"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { fetchPriceHistory } from "@/lib/clientData";
import {
  ORIGIN_LABEL,
  RANGES,
  SOURCE_REQUEST,
  attachMarket,
  detectCorrections,
  formatDay,
  formatDuration,
  sliceWindow,
  type Correction,
  type PricePoint,
  type RangeId,
  type SeriesSource,
} from "@/lib/corrections";
import type { CorrectionsExplanation, ExplainResult } from "@/lib/correctionsExplain";

// Grafikon cene akcije + lista korekcija (padova od vrha), sa objašnjenjem
// razloga na klik. Prikazuje stvarnu cenu (bez prilagođavanja dividendama).
// Samo padovi se analiziraju; rast se namerno ne obrađuje.

const W = 800;
const H = 280;
const PAD = { l: 52, r: 12, t: 12, b: 24 };
const MARKET_SYMBOL = "^GSPC";

type Series = Partial<Record<SeriesSource, PricePoint[]>>;
type Status = "loading" | "ready" | "error";

function fmtPrice(x: number, currency: string): string {
  const digits = x >= 100 ? 0 : 2;
  return `${x.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits })} ${currency}`;
}

function fmtPct(x: number): string {
  return `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1).replace(".", ",")}%`;
}

function readSaved(symbol: string, range: RangeId): CorrectionsExplanation | null {
  try {
    const saved = localStorage.getItem(`nemvida_corr_v1:${symbol}:${range}`);
    if (!saved) return null;
    const parsed = JSON.parse(saved) as { data?: CorrectionsExplanation };
    return parsed?.data ?? null;
  } catch {
    return null;
  }
}

const CATEGORY_LABEL: Record<string, string> = { makro: "Makro", sektor: "Sektor", kompanija: "Kompanija", mesovito: "Mešovito" };

export default function PriceHistoryChart({ symbol, companyName, currency }: { symbol: string; companyName: string; currency: string }) {
  const [range, setRange] = useState<RangeId>("1G");
  const [stock, setStock] = useState<Series>({});
  const [market, setMarket] = useState<Series>({});
  const [hover, setHover] = useState<number | null>(null);
  const [explains, setExplains] = useState<Partial<Record<RangeId, CorrectionsExplanation>>>({});
  const [explainState, setExplainState] = useState<"idle" | "loading" | "error">("idle");
  const [explainMsg, setExplainMsg] = useState("");
  const loading = useRef<Set<string>>(new Set());
  const [nowMs] = useState(() => Date.now());

  const cfg = RANGES.find((r) => r.id === range)!;

  // Svaki izvor (5d/15m, 1y/1d, max/1wk) se učitava tek kad zatreba, za akciju i S&P 500.
  // Komponenta se pravi ispočetka za svaki novi ticker (key u OverviewCard).
  useEffect(() => {
    const src = cfg.source;
    const key = `${symbol}:${src}`;
    if (stock[src] || loading.current.has(key)) return;
    loading.current.add(key);
    const req = SOURCE_REQUEST[src];
    (async () => {
      const [s, m] = await Promise.all([
        fetchPriceHistory(symbol, { ...req, rawClose: true }),
        fetchPriceHistory(MARKET_SYMBOL, { ...req, rawClose: true }),
      ]);
      loading.current.delete(key);
      setStock((prev) => ({ ...prev, [src]: s }));
      setMarket((prev) => ({ ...prev, [src]: m }));
    })();
  }, [symbol, cfg.source, stock]);

  const raw = stock[cfg.source];
  const status: Status = raw === undefined ? "loading" : raw.length >= 2 ? "ready" : "error";

  const points = useMemo(() => (raw ? sliceWindow(raw, range, nowMs) : []), [raw, range, nowMs]);
  const corrections = useMemo<Correction[]>(() => {
    if (points.length < 2) return [];
    const found = detectCorrections(points, cfg.threshold);
    const m = market[cfg.source];
    return m && m.length ? attachMarket(found, m) : found;
  }, [points, cfg.threshold, market, cfg.source]);

  // Objašnjenje: prvo ono iz ove sesije, pa sačuvano u pregledaču (isti ticker i period).
  const explain: CorrectionsExplanation | null = explains[range] ?? readSaved(symbol, range);

  function pickRange(id: RangeId) {
    setRange(id);
    setHover(null);
    setExplainState("idle");
    setExplainMsg("");
  }

  const sig = useMemo(() => corrections.map((c) => `${c.peakTs}:${c.troughTs}`).join("|"), [corrections]);

  async function loadExplanation() {
    setExplainState("loading");
    setExplainMsg("");
    try {
      const res = await fetch("/api/corrections", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ticker: symbol,
          companyName,
          corrections: corrections.map((c) => ({ peakTs: c.peakTs, troughTs: c.troughTs, depth: c.depth, marketChange: c.marketChange })),
        }),
      });
      const json = (await res.json()) as ExplainResult;
      if (json.status !== "ok") {
        setExplainState("error");
        setExplainMsg(json.reason);
        return;
      }
      setExplains((prev) => ({ ...prev, [range]: json.data }));
      setExplainState("idle");
      try {
        localStorage.setItem(`nemvida_corr_v1:${symbol}:${range}`, JSON.stringify({ sig, data: json.data }));
      } catch {}
    } catch {
      setExplainState("error");
      setExplainMsg("Veza sa serverom nije uspela.");
    }
  }

  // ---- geometrija ----
  const geo = useMemo(() => {
    if (points.length < 2) return null;
    const t0 = points[0].timestamp;
    const t1 = points[points.length - 1].timestamp;
    const vals = points.map((p) => p.close);
    let lo = Math.min(...vals);
    let hi = Math.max(...vals);
    const f = (v: number) => (cfg.logScale ? Math.log(v) : v);
    let flo = f(lo);
    let fhi = f(hi);
    const padv = (fhi - flo) * 0.06 || 1;
    flo -= padv;
    fhi += padv;
    lo = cfg.logScale ? Math.exp(flo) : flo;
    hi = cfg.logScale ? Math.exp(fhi) : fhi;
    const x = (t: number) => PAD.l + ((t - t0) / (t1 - t0 || 1)) * (W - PAD.l - PAD.r);
    const y = (v: number) => PAD.t + (1 - (f(v) - flo) / (fhi - flo || 1)) * (H - PAD.t - PAD.b);
    const line = points.map((p, i) => `${i ? "L" : "M"}${x(p.timestamp).toFixed(1)},${y(p.close).toFixed(1)}`).join("");
    // oznake na y osi
    const ticks: number[] = [];
    for (let i = 0; i <= 4; i++) {
      const fv = flo + ((fhi - flo) * i) / 4;
      ticks.push(cfg.logScale ? Math.exp(fv) : fv);
    }
    return { t0, t1, x, y, line, ticks, lo, hi };
  }, [points, cfg.logScale]);

  const lastClose = points.length ? points[points.length - 1].close : null;
  const firstClose = points.length ? points[0].close : null;
  const periodChange = lastClose != null && firstClose ? lastClose / firstClose - 1 : null;
  const maxDepth = corrections.length ? Math.min(...corrections.map((c) => c.depth)) : null;

  function onMove(e: React.MouseEvent<SVGSVGElement> | React.TouchEvent<SVGSVGElement>) {
    if (!geo) return;
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
    const px = ((clientX - rect.left) / rect.width) * W;
    const t = geo.t0 + ((px - PAD.l) / (W - PAD.l - PAD.r)) * (geo.t1 - geo.t0);
    let lo = 0;
    let hi = points.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (points[mid].timestamp < t) lo = mid + 1;
      else hi = mid;
    }
    setHover(lo);
  }

  const hp = hover != null ? points[hover] : null;
  const tickLabel = (t: number) =>
    range === "1N"
      ? new Date(t * 1000).toLocaleDateString("sr-Latn-RS", { weekday: "short", day: "numeric", month: "short" })
      : new Date(t * 1000).toLocaleDateString("sr-Latn-RS", range === "1M" || range === "YTD" || range === "1G" ? { month: "short", day: "numeric" } : { year: "numeric" });

  return (
    <div className="border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/50 rounded-xl p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h3 className="font-semibold">Kretanje cene i korekcije</h3>
        <div className="flex flex-wrap gap-1">
          {RANGES.map((r) => (
            <button
              key={r.id}
              onClick={() => pickRange(r.id)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-colors ${
                range === r.id ? "bg-blue-600 text-white border-blue-600" : "border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:border-blue-400"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {status === "loading" && <div className="h-[280px] flex items-center justify-center text-sm text-zinc-500">Učitavanje grafikona…</div>}
      {status === "error" && <div className="h-[120px] flex items-center justify-center text-sm text-zinc-500">Nema dovoljno podataka o ceni za izabrani period.</div>}

      {status === "ready" && geo && (
        <>
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400 mb-2">
            <span>
              Promena u periodu:{" "}
              <b className={periodChange != null && periodChange < 0 ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"}>
                {periodChange != null ? fmtPct(periodChange) : "—"}
              </b>
            </span>
            <span>
              Broj korekcija (≥{Math.round(cfg.threshold * 100)}%): <b className="text-zinc-800 dark:text-zinc-200">{corrections.length}</b>
            </span>
            {maxDepth != null && (
              <span>
                Najdublja: <b className="text-red-600 dark:text-red-400">{fmtPct(maxDepth)}</b>
              </span>
            )}
            {cfg.logScale && <span>Logaritamska skala</span>}
          </div>

          <div className="relative">
            <svg
              viewBox={`0 0 ${W} ${H}`}
              className="w-full h-auto touch-pan-y select-none"
              onMouseMove={onMove}
              onTouchMove={onMove}
              onMouseLeave={() => setHover(null)}
              role="img"
              aria-label={`Grafikon cene ${companyName}`}
            >
              {geo.ticks.map((v, i) => (
                <g key={i}>
                  <line x1={PAD.l} x2={W - PAD.r} y1={geo.y(v)} y2={geo.y(v)} className="stroke-zinc-200 dark:stroke-zinc-800" strokeWidth={1} />
                  <text x={PAD.l - 6} y={geo.y(v) + 3} textAnchor="end" className="fill-zinc-500" fontSize={10}>
                    {v >= 100 ? Math.round(v).toLocaleString("en-US") : v.toFixed(1)}
                  </text>
                </g>
              ))}
              {[0, 0.25, 0.5, 0.75, 1].map((f, i) => {
                const t = geo.t0 + (geo.t1 - geo.t0) * f;
                return (
                  <text key={i} x={PAD.l + f * (W - PAD.l - PAD.r)} y={H - 6} textAnchor={f === 0 ? "start" : f === 1 ? "end" : "middle"} className="fill-zinc-500" fontSize={10}>
                    {tickLabel(t)}
                  </text>
                );
              })}
              {/* korekcije: senčena traka od vrha do dna, crvena tačka na dnu */}
              {corrections.map((c, i) => (
                <g key={i}>
                  <rect x={geo.x(c.peakTs)} y={PAD.t} width={Math.max(2, geo.x(c.troughTs) - geo.x(c.peakTs))} height={H - PAD.t - PAD.b} className="fill-red-500/10" />
                  <line x1={geo.x(c.peakTs)} x2={geo.x(c.troughTs)} y1={geo.y(c.peakPrice)} y2={geo.y(c.troughPrice)} stroke="#dc2626" strokeWidth={1.5} strokeDasharray="4 3" />
                  <circle cx={geo.x(c.troughTs)} cy={geo.y(c.troughPrice)} r={3.5} fill="#dc2626" />
                  <text x={geo.x(c.troughTs)} y={Math.min(H - PAD.b - 4, geo.y(c.troughPrice) + 14)} textAnchor="middle" fontSize={10} fontWeight={600} className="fill-red-600">
                    {i + 1}
                  </text>
                </g>
              ))}
              <path d={geo.line} fill="none" stroke="#2563eb" strokeWidth={1.6} strokeLinejoin="round" />
              {hp && (
                <g>
                  <line x1={geo.x(hp.timestamp)} x2={geo.x(hp.timestamp)} y1={PAD.t} y2={H - PAD.b} className="stroke-zinc-400" strokeWidth={1} />
                  <circle cx={geo.x(hp.timestamp)} cy={geo.y(hp.close)} r={3.5} fill="#2563eb" />
                </g>
              )}
            </svg>
            {hp && (
              <div className="absolute top-1 left-14 text-xs bg-white/90 dark:bg-zinc-900/90 border border-zinc-200 dark:border-zinc-700 rounded px-2 py-1 pointer-events-none">
                <b>{fmtPrice(hp.close, currency)}</b>
                <span className="text-zinc-500 ml-2">
                  {range === "1N" ? new Date(hp.timestamp * 1000).toLocaleString("sr-Latn-RS", { weekday: "short", hour: "2-digit", minute: "2-digit" }) : formatDay(hp.timestamp)}
                </span>
              </div>
            )}
          </div>

          <div className="mt-4">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <h4 className="text-sm font-semibold">Korekcije u izabranom periodu</h4>
              {corrections.length > 0 && (
                <button
                  onClick={loadExplanation}
                  disabled={explainState === "loading"}
                  className="px-3 py-1.5 rounded-md text-xs font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60"
                >
                  {explainState === "loading" ? "Analiziram…" : explain ? "Osveži objašnjenje (AI)" : "Objasni razloge korekcija (AI)"}
                </button>
              )}
            </div>

            {corrections.length === 0 ? (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                U ovom periodu nije bilo pada cene od vrha većeg od {Math.round(cfg.threshold * 100)}%.
              </p>
            ) : (
              <ol className="space-y-2">
                {corrections.map((c, i) => {
                  const reason = explain?.reasons.find((r) => r.index === i) ?? null;
                  const bear = c.depth <= -0.2;
                  return (
                    <li key={`${c.peakTs}-${c.troughTs}`} className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-3 text-sm">
                      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                        <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-red-600 text-white text-[11px] font-bold">{i + 1}</span>
                        <span className="font-bold text-red-600 dark:text-red-400">{fmtPct(c.depth)}</span>
                        {bear && <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-red-600/10 text-red-700 dark:text-red-400">medveđi pad</span>}
                        <span className="text-zinc-600 dark:text-zinc-300">
                          {fmtPrice(c.peakPrice, currency)} → {fmtPrice(c.troughPrice, currency)}
                        </span>
                      </div>
                      <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                        Vrh {formatDay(c.peakTs)} · dno {formatDay(c.troughTs)} (posle {formatDuration(c.daysToTrough)}) ·{" "}
                        {c.recoveryTs != null ? `oporavak do starog vrha ${formatDay(c.recoveryTs)} (ukupno ${formatDuration(c.daysToRecover ?? 0)})` : "još nije dostigao stari vrh"}
                      </div>
                      {c.marketChange != null && c.origin && (
                        <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-300">
                          S&amp;P 500 u istom periodu: <b>{fmtPct(c.marketChange)}</b> — {ORIGIN_LABEL[c.origin]}
                        </div>
                      )}
                      {reason && (
                        <div className="mt-2 text-sm border-l-2 border-blue-500 pl-3">
                          <p>{reason.cause}</p>
                          <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                            {CATEGORY_LABEL[reason.category]} · osnova: {reason.basis === "vesti" ? "naslovi vesti iz tog perioda" : "opšte znanje modela (nije proverena vest)"} · pouzdanost: {reason.confidence}
                          </p>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}

            {explainState === "error" && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{explainMsg}</p>}
            {explain?.pattern && (
              <div className="mt-3 text-sm rounded-lg bg-zinc-100 dark:bg-zinc-800/60 p-3">
                <b>Šta se ponavlja: </b>
                {explain.pattern}
              </div>
            )}
            <p className="mt-3 text-[11px] text-zinc-500 dark:text-zinc-400">
              Korekcija = pad cene od najvišeg dotadašnjeg vrha za bar {Math.round(cfg.threshold * 100)}%, do ponovnog dostizanja tog vrha. Prikazana je stvarna cena (bez dividendi). Razlozi su AI procena na osnovu naslova vesti i opšteg znanja — za starije periode mogu biti nepotpuni i treba ih proveriti; pozivaju se samo na klik jer troše API kredit.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
