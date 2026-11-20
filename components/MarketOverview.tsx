"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { MARKET_GROUPS, type InstrumentQuote, type MarketInstrument } from "@/lib/marketInstruments";

interface NewsItem {
  title: string;
  link: string;
  source: string;
  isoDate: string;
  topic: string;
}

interface MarketsResponse {
  updatedAt: string;
  quotes: InstrumentQuote[];
  news: NewsItem[];
}

// Instrumenti kod kojih je RAST loš znak (strah, slabija kruna) — boja se
// obrće da zeleno uvek znači "povoljno", a crveno "nepovoljno".
const INVERTED_IDS = new Set(["vix", "usdnok", "eurnok", "gbpnok", "seknok", "dkknok", "chfnok"]);

const HIGHLIGHT_IDS = ["spx", "osebx", "brent", "gold", "us10y", "vix", "usdnok"];

function fmtNumber(x: number, digits: number): string {
  return x.toLocaleString("nb-NO", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function fmtPrice(inst: MarketInstrument, q: InstrumentQuote): string {
  if (q.price == null) return "—";
  if (inst.kind === "yield") return `${fmtNumber(q.price, 2)} %`;
  if (inst.kind === "fx") return fmtNumber(q.price, 4);
  return fmtNumber(q.price, q.price >= 1000 ? 0 : 2);
}

function changeLabel(inst: MarketInstrument, abs: number | null, pct: number | null): string {
  if (inst.kind === "yield") {
    if (abs == null) return "—";
    const bp = abs * 100;
    return `${bp >= 0 ? "+" : ""}${fmtNumber(bp, 0)} b.p.`;
  }
  if (pct == null) return "—";
  return `${pct >= 0 ? "+" : ""}${fmtNumber(pct * 100, 2)} %`;
}

function changeTone(id: string, value: number | null): "up" | "down" | "flat" {
  if (value == null || Math.abs(value) < 1e-9) return "flat";
  const positive = value > 0;
  const good = INVERTED_IDS.has(id) ? !positive : positive;
  return good ? "up" : "down";
}

function ChangeCell({ inst, id, abs, pct }: { inst: MarketInstrument; id: string; abs: number | null; pct: number | null }) {
  const raw = inst.kind === "yield" ? abs : pct;
  const tone = changeTone(id, raw);
  const arrow = raw == null || tone === "flat" ? "" : raw > 0 ? "▲ " : "▼ ";
  const color = tone === "up" ? "text-emerald-700 dark:text-emerald-400" : tone === "down" ? "text-red-700 dark:text-red-400" : "text-zinc-500 dark:text-zinc-400";
  return <span className={`tabular-nums whitespace-nowrap ${color}`}>{arrow}{changeLabel(inst, abs, pct)}</span>;
}

function Sparkline({ values, label }: { values: number[]; label: string }) {
  if (values.length < 2) return <span className="text-zinc-300 dark:text-zinc-600">—</span>;
  const w = 88;
  const h = 26;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * (w - 4) + 2).toFixed(1)},${(h - 3 - ((v - min) / span) * (h - 6)).toFixed(1)}`).join(" ");
  const last = pts.split(" ").pop()!.split(",");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={label} className="text-blue-600 dark:text-blue-400">
      <title>{label}</title>
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={last[0]} cy={last[1]} r={2.5} fill="currentColor" />
    </svg>
  );
}

function sparkLabel(inst: MarketInstrument, q: InstrumentQuote): string {
  if (q.spark.length < 2) return `${inst.name}: nema istorije`;
  const min = Math.min(...q.spark);
  const max = Math.max(...q.spark);
  const fmt = (v: number) => (inst.kind === "fx" ? fmtNumber(v, 4) : fmtNumber(v, 2));
  return `${inst.name}, poslednji mesec: najniže ${fmt(min)}, najviše ${fmt(max)}`;
}

function timeAgo(iso: string): string {
  const diffMin = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (diffMin < 60) return `pre ${Math.max(1, diffMin)} min`;
  const h = Math.round(diffMin / 60);
  if (h < 24) return `pre ${h} h`;
  const d = Math.round(h / 24);
  return `pre ${d} ${d === 1 ? "dan" : "dana"}`;
}

export default function MarketOverview() {
  const [data, setData] = useState<MarketsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/markets", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Greška pri učitavanju");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- jednokratno učitavanje pri montiranju
    load();
  }, [load]);

  const quoteById = useMemo(() => {
    const m = new Map<string, InstrumentQuote>();
    data?.quotes.forEach((q) => m.set(q.id, q));
    return m;
  }, [data]);

  const instById = useMemo(() => {
    const m = new Map<string, MarketInstrument>();
    MARKET_GROUPS.forEach((g) => g.instruments.forEach((i) => m.set(i.id, i)));
    return m;
  }, []);

  return (
    <div className="max-w-5xl mx-auto px-4 pb-16">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-5">
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          {data ? `Ažurirano ${new Date(data.updatedAt).toLocaleString("sr-Latn-RS")}. Podaci kasne do ~15 min (Yahoo Finance).` : loading ? "Učitavam tržišne podatke…" : ""}
        </p>
        <button onClick={load} disabled={loading} className="text-sm px-4 py-1.5 rounded-lg bg-blue-600 disabled:opacity-60 text-white font-semibold">
          {loading ? "Učitavam…" : "Osveži"}
        </button>
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400 mb-4">Greška: {error}</p>}

      {data && (
        <>
          <section className="mb-8">
            <h2 className="text-sm font-semibold uppercase text-zinc-500 dark:text-zinc-400 mb-2">Ukratko</h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
              {HIGHLIGHT_IDS.map((id) => {
                const inst = instById.get(id);
                const q = quoteById.get(id);
                if (!inst || !q) return null;
                return (
                  <div key={id} className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-2.5">
                    <div className="text-xs text-zinc-500 dark:text-zinc-400 truncate">{inst.name}</div>
                    <div className="text-lg font-bold tabular-nums text-zinc-900 dark:text-zinc-50">{fmtPrice(inst, q)}</div>
                    <div className="text-xs">
                      <span className="text-zinc-400">Dan </span>
                      <ChangeCell inst={inst} id={id} abs={q.dayChange} pct={q.dayChangePercent} />
                    </div>
                    <div className="text-xs">
                      <span className="text-zinc-400">Ned. </span>
                      <ChangeCell inst={inst} id={id} abs={q.weekChange} pct={q.weekChangePercent} />
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {MARKET_GROUPS.map((group) => (
              <section key={group.id} className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-4">
                <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-50">{group.title}</h2>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-3">{group.description}</p>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr className="text-xs uppercase text-zinc-500">
                        <th className="text-left font-medium py-1 pr-2">Instrument</th>
                        <th className="text-right font-medium py-1 px-2">Cena</th>
                        <th className="text-right font-medium py-1 px-2">Dan</th>
                        <th className="text-right font-medium py-1 px-2">Nedelja</th>
                        <th className="hidden sm:table-cell text-right font-medium py-1 pl-2">Mesec</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.instruments.map((inst) => {
                        const q = quoteById.get(inst.id);
                        const missing = !q || q.price == null;
                        return (
                          <tr key={inst.id} className="border-t border-zinc-100 dark:border-zinc-800">
                            <td className="py-1.5 pr-2">
                              <div className="text-zinc-900 dark:text-zinc-100">{inst.name}</div>
                              {(inst.unit || q?.currency) && !missing && inst.kind === "price" && (
                                <div className="text-[11px] text-zinc-400">{inst.unit ?? q?.currency}</div>
                              )}
                            </td>
                            {missing ? (
                              <td colSpan={4} className="py-1.5 pl-2 text-right text-xs italic text-zinc-400">Podatak trenutno nije dostupan</td>
                            ) : (
                              <>
                                <td className="py-1.5 px-2 text-right tabular-nums whitespace-nowrap font-medium text-zinc-900 dark:text-zinc-100">{fmtPrice(inst, q)}</td>
                                <td className="py-1.5 px-2 text-right"><ChangeCell inst={inst} id={inst.id} abs={q.dayChange} pct={q.dayChangePercent} /></td>
                                <td className="py-1.5 px-2 text-right"><ChangeCell inst={inst} id={inst.id} abs={q.weekChange} pct={q.weekChangePercent} /></td>
                                <td className="hidden sm:table-cell py-1.5 pl-2 text-right"><Sparkline values={q.spark} label={sparkLabel(inst, q)} /></td>
                              </>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            ))}
          </div>

          <section className="mt-8">
            <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-50 mb-2">Glavne vesti (poslednjih 7 dana)</h2>
            {data.news.length === 0 ? (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">Vesti trenutno nisu dostupne.</p>
            ) : (
              <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {data.news.map((n) => (
                  <li key={n.link} className="py-2">
                    <a href={n.link} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-zinc-900 dark:text-zinc-100 hover:text-blue-600 dark:hover:text-blue-400">
                      {n.title}
                    </a>
                    <div className="text-xs text-zinc-500 dark:text-zinc-400">
                      {n.topic} · {n.source} · {timeAgo(n.isoDate)}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <p className="text-[11px] text-zinc-400 mt-6 italic">
            Dnevna promena je u odnosu na prethodno zatvaranje, nedeljna u odnosu na zatvaranje pre 5 trgovačkih dana. Zeleno uvek znači povoljno, crveno
            nepovoljno — kod VIX-a i kursa NOK-a boja je obrnuta (rast VIX-a = više straha, rast kursa = slabija kruna). Kamatne stope su prinosi
            američkih državnih obveznica; promena u baznim poenima. Energenti, metali i fjučersi su cene najbližeg terminskog ugovora.
          </p>
        </>
      )}
    </div>
  );
}
