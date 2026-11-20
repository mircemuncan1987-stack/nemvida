"use client";

import { useEffect, useState } from "react";
import type { DigestResult, MarketDigest, NewsDigest, SignalTone } from "@/lib/newsDigest";

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

function SubHeading({ children }: { children: React.ReactNode }) {
  return <h3 className="text-xs font-semibold uppercase text-zinc-500 dark:text-zinc-400 mb-1.5">{children}</h3>;
}

function ToneIcon({ tone }: { tone: SignalTone }) {
  const st = TONE_STYLE[tone] ?? TONE_STYLE.neutralno;
  return (
    <span className={`shrink-0 ${st.cls}`} aria-label={st.label} title={st.label}>
      {st.icon}
    </span>
  );
}

function Header({ sentiment, headline }: { sentiment: string; headline: string }) {
  return (
    <div className="flex flex-wrap items-start gap-2">
      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${SENTIMENT_STYLE[sentiment] ?? SENTIMENT_STYLE.neutralno}`}>Ton: {sentiment}</span>
      <p className="text-base font-semibold text-zinc-900 dark:text-zinc-50 basis-full">{headline}</p>
    </div>
  );
}

function WatchList({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <SubHeading>Šta pratiti</SubHeading>
      <ul className="list-disc pl-5 space-y-1 text-sm text-zinc-700 dark:text-zinc-300">
        {items.map((w, i) => (
          <li key={i}>{w}</li>
        ))}
      </ul>
    </div>
  );
}

function MarketBody({ d }: { d: MarketDigest }) {
  const prose = "text-sm leading-relaxed text-zinc-700 dark:text-zinc-300";
  return (
    <>
      <Header sentiment={d.sentiment} headline={d.headline} />

      <div>
        <SubHeading>Šta se desilo</SubHeading>
        <p className={prose}>{d.whatHappened}</p>
      </div>

      {d.drivers.length > 0 && (
        <div>
          <SubHeading>Šta pokreće tržište i zašto</SubHeading>
          <ul className="space-y-2">
            {d.drivers.map((s, i) => (
              <li key={i} className="flex gap-2 text-sm">
                <ToneIcon tone={s.tone} />
                <span className="text-zinc-700 dark:text-zinc-300">
                  <b className="text-zinc-900 dark:text-zinc-100">{s.title}.</b> {s.why}
                  {!s.confirmed && <span className="ml-1 text-[11px] text-zinc-400 italic">(tumačenje, ne direktno iz vesti)</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {d.macro.length > 0 && (
        <div>
          <SubHeading>Makroekonomski faktori</SubHeading>
          <dl className="grid gap-2 sm:grid-cols-2">
            {d.macro.map((m, i) => (
              <div key={i} className="rounded-lg bg-zinc-50 dark:bg-zinc-800/50 p-2.5">
                <dt className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{m.factor}</dt>
                <dd className="text-sm text-zinc-700 dark:text-zinc-300 mt-0.5">{m.detail}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      <div>
        <SubHeading>Tendencija (nedelja i mesec)</SubHeading>
        <p className={prose}>{d.trend}</p>
      </div>

      {d.scenarios.length > 0 && (
        <div>
          <SubHeading>Scenariji — šta bi pokrenulo dalji rast ili pad</SubHeading>
          <div className="grid gap-2 sm:grid-cols-2">
            {d.scenarios.map((s, i) => {
              const up = s.direction === "rast";
              return (
                <div key={i} className={`rounded-lg border p-2.5 ${up ? "border-emerald-200 dark:border-emerald-900" : "border-red-200 dark:border-red-900"}`}>
                  <div className={`text-sm font-semibold ${up ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400"}`}>
                    {up ? "▲ Dalji rast" : "▼ Dalji pad"}: <span className="text-zinc-900 dark:text-zinc-100">{s.title}</span>
                  </div>
                  <p className="text-sm text-zinc-700 dark:text-zinc-300 mt-1">{s.triggers}</p>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                    <b>Rani znaci:</b> {s.signals}
                  </p>
                </div>
              );
            })}
          </div>
          <p className="text-[11px] text-zinc-400 mt-1">Scenariji nisu prognoza — opisuju šta bi moralo da se desi, ne šta će se desiti.</p>
        </div>
      )}

      <WatchList items={d.watch} />
    </>
  );
}

function CompanyBody({ d }: { d: NewsDigest }) {
  return (
    <>
      <Header sentiment={d.sentiment} headline={d.headline} />
      {d.signals.length > 0 && (
        <div>
          <SubHeading>Najvažniji signali</SubHeading>
          <ul className="space-y-2">
            {d.signals.map((s, i) => (
              <li key={i} className="flex gap-2 text-sm">
                <ToneIcon tone={s.tone} />
                <span className="text-zinc-700 dark:text-zinc-300">
                  <b className="text-zinc-900 dark:text-zinc-100">{s.title}.</b> {s.detail}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="space-y-2 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
        {d.summary.map((p, i) => (
          <p key={i}>{p}</p>
        ))}
      </div>
      <WatchList items={d.watch} />
    </>
  );
}

type OkDigest = Extract<DigestResult, { status: "ok" }>;

// Rezime se čuva u pregledaču (localStorage) i Claude se poziva ISKLJUČIVO
// klikom na dugme — otvaranje stranice nikad ne troši API kredit.
const STORAGE_PREFIX = "nemvida_digest_v1";

function storageKey(scope: string, ticker: string | null | undefined): string {
  return `${STORAGE_PREFIX}:${scope}:${ticker ?? "sve"}`;
}

function loadSaved(scope: "market" | "company", ticker: string | null | undefined): OkDigest | null {
  try {
    const raw = localStorage.getItem(storageKey(scope, ticker));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as OkDigest;
    const expectedKind = scope === "market" ? "market" : "company";
    if (parsed?.status !== "ok" || parsed.kind !== expectedKind || !parsed.digest) return null;
    return parsed;
  } catch {
    return null;
  }
}

export default function NewsDigestView({ scope, ticker, title }: { scope: "market" | "company"; ticker?: string | null; title: string }) {
  const [saved, setSaved] = useState<OkDigest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showSources, setShowSources] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- čitanje sačuvanog rezimea pri promeni teme
    setSaved(loadSaved(scope, ticker));
    setError(null);
    setShowSources(false);
  }, [scope, ticker]);

  async function generate() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ scope });
      if (ticker) params.set("ticker", ticker);
      const res = await fetch(`/api/digest?${params.toString()}`, { cache: "no-store" });
      const json = (await res.json()) as DigestResult;
      if (json.status === "ok") {
        setSaved(json);
        try {
          localStorage.setItem(storageKey(scope, ticker), JSON.stringify(json));
        } catch {
          /* nije kritično ako localStorage nije dostupan */
        }
      } else {
        setError(json.reason);
      }
    } catch {
      setError("Rezime trenutno nije dostupan.");
    } finally {
      setLoading(false);
    }
  }

  const costHint = scope === "market" ? "oko 10 centi" : "oko 5 centi";
  const button = (
    <button
      onClick={generate}
      disabled={loading}
      className="text-sm px-4 py-1.5 rounded-lg bg-blue-600 disabled:opacity-60 text-white font-semibold"
      title={`Poziva Claude i troši API kredit (${costHint}). Ako je rezime napisan pre manje od 10 minuta, dobija se isti, bez novog troška.`}
    >
      {loading ? "Pišem…" : saved ? "Osveži rezime" : "Napravi rezime"}
    </button>
  );

  return (
    <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-4 sm:p-5 bg-white/60 dark:bg-zinc-900/40">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-50">{title}</h2>
        {button}
      </div>

      {loading && (
        <div className="space-y-2 animate-pulse mb-3" aria-label="Pišem rezime">
          <div className="h-4 bg-zinc-200 dark:bg-zinc-800 rounded w-3/4" />
          <div className="h-3 bg-zinc-200 dark:bg-zinc-800 rounded w-full" />
          <div className="h-3 bg-zinc-200 dark:bg-zinc-800 rounded w-5/6" />
          <p className="text-xs text-zinc-500 dark:text-zinc-400 pt-1">
            Čitam vesti i pišem analizu… {scope === "market" ? "(može da potraje i do minut)" : "(može da potraje do pola minuta)"}
          </p>
        </div>
      )}

      {error && <p className="text-sm text-red-600 dark:text-red-400 mb-3">{error}</p>}

      {!saved && !loading && !error && (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Rezime se piše samo kad klikneš dugme — otvaranje stranice ne troši API kredit ({costHint} po rezimeu). Napisan rezime ostaje sačuvan u ovom
          pregledaču.
        </p>
      )}

      {saved && (
        <div className={`space-y-4 ${loading ? "opacity-50" : ""}`}>
          {saved.kind === "market" ? <MarketBody d={saved.digest} /> : <CompanyBody d={saved.digest} />}

          <div className="pt-2 border-t border-zinc-100 dark:border-zinc-800 text-[11px] text-zinc-400">
            Rezime je napisala veštačka inteligencija (Claude) {timeAgo(saved.generatedAt)}, na osnovu naslova i kratkih opisa {saved.sources.length} vesti
            iz poslednjih 7 dana{saved.kind === "market" ? " i stvarnih promena cena" : ""} — ne celih članaka. Ne osvežava se sam: novi rezime
            nastaje samo klikom na dugme. Važne informacije proveri pre odluke.{" "}
            <button onClick={() => setShowSources((v) => !v)} className="underline hover:text-zinc-600 dark:hover:text-zinc-300">
              {showSources ? "Sakrij izvore" : "Prikaži izvore"}
            </button>
          </div>

          {showSources && (
            <ul className="text-xs space-y-1 max-h-72 overflow-y-auto">
              {saved.sources.map((s) => (
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
