"use client";

import { useEffect, useState } from "react";
import type { DigestResult, SignalTone } from "@/lib/newsDigest";

const TONE_STYLE: Record<SignalTone, { icon: string; label: string; cls: string }> = {
  pozitivno: { icon: "▲", label: "Pozitivno", cls: "text-emerald-700 dark:text-emerald-400" },
  negativno: { icon: "▼", label: "Negativno", cls: "text-red-700 dark:text-red-400" },
  neutralno: { icon: "●", label: "Neutralno", cls: "text-zinc-500 dark:text-zinc-400" },
};

const SENTIMENT_STYLE: Record<string, string> = {
  pozitivno: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  negativno: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  mešovito: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  neutralno: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
};

function timeAgo(iso: string): string {
  const diffMin = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (diffMin < 60) return `pre ${Math.max(1, diffMin)} min`;
  const h = Math.round(diffMin / 60);
  if (h < 24) return `pre ${h} h`;
  const d = Math.round(h / 24);
  return `pre ${d} ${d === 1 ? "dan" : "dana"}`;
}

export default function NewsDigestView({ scope, ticker, title }: { scope: "market" | "company"; ticker?: string | null; title: string }) {
  const [result, setResult] = useState<DigestResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [showSources, setShowSources] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- novo učitavanje pri promeni teme
    setLoading(true);
    setShowSources(false);
    const params = new URLSearchParams({ scope });
    if (ticker) params.set("ticker", ticker);
    fetch(`/api/digest?${params.toString()}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((json: DigestResult) => !cancelled && setResult(json))
      .catch(() => !cancelled && setResult({ status: "unavailable", reason: "Rezime trenutno nije dostupan." }))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [scope, ticker]);

  return (
    <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-4 sm:p-5 bg-white/60 dark:bg-zinc-900/40">
      <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-50 mb-3">{title}</h2>

      {loading && (
        <div className="space-y-2 animate-pulse" aria-label="Pišem rezime">
          <div className="h-4 bg-zinc-200 dark:bg-zinc-800 rounded w-3/4" />
          <div className="h-3 bg-zinc-200 dark:bg-zinc-800 rounded w-full" />
          <div className="h-3 bg-zinc-200 dark:bg-zinc-800 rounded w-5/6" />
          <p className="text-xs text-zinc-500 dark:text-zinc-400 pt-1">Čitam vesti i pišem rezime… (prvi put može da potraje do pola minuta)</p>
        </div>
      )}

      {!loading && result?.status === "unavailable" && <p className="text-sm text-zinc-500 dark:text-zinc-400">{result.reason}</p>}

      {!loading && result?.status === "ok" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-start gap-2">
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${SENTIMENT_STYLE[result.digest.sentiment] ?? SENTIMENT_STYLE.neutralno}`}>
              Ton: {result.digest.sentiment}
            </span>
            <p className="text-base font-semibold text-zinc-900 dark:text-zinc-50 basis-full">{result.digest.headline}</p>
          </div>

          {result.digest.signals.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold uppercase text-zinc-500 dark:text-zinc-400 mb-1.5">Najvažniji signali</h3>
              <ul className="space-y-2">
                {result.digest.signals.map((s, i) => {
                  const st = TONE_STYLE[s.tone] ?? TONE_STYLE.neutralno;
                  return (
                    <li key={i} className="flex gap-2 text-sm">
                      <span className={`shrink-0 ${st.cls}`} aria-label={st.label} title={st.label}>
                        {st.icon}
                      </span>
                      <span className="text-zinc-700 dark:text-zinc-300">
                        <b className="text-zinc-900 dark:text-zinc-100">{s.title}.</b> {s.detail}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          <div className="space-y-2 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
            {result.digest.summary.map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>

          {result.digest.watch.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold uppercase text-zinc-500 dark:text-zinc-400 mb-1.5">Šta pratiti</h3>
              <ul className="list-disc pl-5 space-y-1 text-sm text-zinc-700 dark:text-zinc-300">
                {result.digest.watch.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="pt-2 border-t border-zinc-100 dark:border-zinc-800 text-[11px] text-zinc-400">
            Rezime je napisala veštačka inteligencija (Claude) {timeAgo(result.generatedAt)}, na osnovu naslova i kratkih opisa {result.sources.length} vesti
            iz poslednjih 7 dana — ne celih članaka. Osvežava se na svaka 2 sata. Važne informacije proveri pre odluke.{" "}
            <button onClick={() => setShowSources((v) => !v)} className="underline hover:text-zinc-600 dark:hover:text-zinc-300">
              {showSources ? "Sakrij izvore" : "Prikaži izvore"}
            </button>
          </div>

          {showSources && (
            <ul className="text-xs space-y-1 max-h-72 overflow-y-auto">
              {result.sources.map((s) => (
                <li key={s.link} className="text-zinc-500 dark:text-zinc-400">
                  <a href={s.link} target="_blank" rel="noopener noreferrer" className="hover:text-blue-600 dark:hover:text-blue-400">
                    {s.title}
                  </a>{" "}
                  · {s.source} · {timeAgo(s.isoDate)}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
