"use client";

import { useState } from "react";
import { COUNTRIES, searchCountries, type CountryEntry } from "@/lib/countries";
import { buildCountryModel, fmtIndicatorValue, toneColorClass, INDICATOR_DEFS, type CountryModel } from "@/lib/countryModel";
import type { IndicatorPoint } from "@/app/api/country/route";

interface CountryApiResponse {
  meta: { code: string; name: string; region: string | null; incomeLevel: string | null; capitalCity: string | null };
  indicators: Record<string, IndicatorPoint>;
}

function scoreColor(score: number | null): string {
  if (score == null) return "bg-zinc-300 dark:bg-zinc-700";
  if (score >= 4) return "bg-emerald-500";
  if (score >= 3) return "bg-amber-500";
  return "bg-red-500";
}

function scoreTextColor(score: number | null): string {
  if (score == null) return "text-zinc-400";
  if (score >= 4) return "text-emerald-600 dark:text-emerald-400";
  if (score >= 3) return "text-amber-600 dark:text-amber-400";
  return "text-red-600 dark:text-red-400";
}

function scoreLabel(score: number | null): string {
  if (score == null) return "Nedovoljno podataka";
  if (score >= 4) return "Zdrava makro slika";
  if (score >= 3) return "Mešoviti signali";
  return "Zahteva pažnju";
}

function DotMeter({ score }: { score: number | null }) {
  return (
    <div className="flex gap-0.5 justify-center mt-1">
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} className={`w-1.5 h-1.5 rounded-full ${score != null && i <= Math.round(score) ? scoreColor(score) : "bg-zinc-200 dark:bg-zinc-700"}`} />
      ))}
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-zinc-200 dark:border-zinc-800 rounded-lg p-2 text-center">
      <div className="text-sm font-bold">{value}</div>
      <div className="text-[10px] text-zinc-500 dark:text-zinc-400 mt-0.5">{label}</div>
    </div>
  );
}

function Box({ title, badge, children }: { title: string; badge?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="border border-zinc-200 dark:border-zinc-800 rounded-xl p-4 bg-white/70 dark:bg-zinc-900/50">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-bold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{title}</h3>
        {badge}
      </div>
      {children}
    </div>
  );
}

function IndicatorRow({ label, value, year, tone }: { label: string; value: string; year: string | null; tone: string }) {
  return (
    <div className="flex justify-between items-baseline gap-3 py-1">
      <span className="text-xs text-zinc-500 dark:text-zinc-400">{label}</span>
      <span className={`text-xs text-right font-semibold shrink-0 ${tone}`}>
        {value}
        {year ? <span className="text-zinc-400 font-normal"> ({year}.)</span> : ""}
      </span>
    </div>
  );
}

export default function CountryOverview() {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<CountryEntry[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [data, setData] = useState<CountryApiResponse | null>(null);
  const [model, setModel] = useState<CountryModel | null>(null);

  async function loadCountry(code: string) {
    setLoading(true);
    setError("");
    setShowSuggestions(false);
    try {
      const res = await fetch(`/api/country?code=${encodeURIComponent(code)}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      setData(json);
      setModel(buildCountryModel(json.indicators));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Greška pri preuzimanju podataka.");
      setData(null);
      setModel(null);
    } finally {
      setLoading(false);
    }
  }

  function handleQueryChange(value: string) {
    setQuery(value);
    const found = searchCountries(value);
    setSuggestions(found);
    setShowSuggestions(found.length > 0);
  }

  function pickCountry(c: CountryEntry) {
    setQuery(c.name);
    setSuggestions([]);
    loadCountry(c.code);
  }

  function handleSubmit() {
    const trimmed = query.trim();
    if (!trimmed) return;
    const exact = COUNTRIES.find((c) => c.name.toLowerCase() === trimmed.toLowerCase() || c.code.toLowerCase() === trimmed.toLowerCase());
    if (exact) {
      loadCountry(exact.code);
      return;
    }
    const matches = searchCountries(trimmed);
    if (matches.length === 1) {
      pickCountry(matches[0]);
    } else if (matches.length > 1) {
      setSuggestions(matches);
      setShowSuggestions(true);
    } else {
      setError(`Nije pronađena zemlja za "${trimmed}".`);
    }
  }

  const byDimension = (key: string) => INDICATOR_DEFS.filter((d) => d.dimension === key);
  const byCode = (code: string) => INDICATOR_DEFS.find((d) => d.code === code)!;

  const gdpPerCapita = data?.indicators["NY.GDP.PCAP.CD"];
  const population = data?.indicators["SP.POP.TOTL"];
  const gdpGrowth = data?.indicators["NY.GDP.MKTP.KD.ZG"];
  const inflation = data?.indicators["FP.CPI.TOTL.ZG"];

  return (
    <div className="max-w-4xl mx-auto px-4 pb-16">
      <div className="border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/50 rounded-xl p-4 mb-4">
        <div className="flex flex-wrap gap-2 items-end">
          <div className="flex-1 min-w-[200px] relative">
            <label className="block text-xs text-zinc-500 dark:text-zinc-400 mb-1">Naziv zemlje</label>
            <input
              type="text"
              value={query}
              onChange={(e) => handleQueryChange(e.target.value)}
              onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
              onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
              onKeyDown={(e) => e.key === "Enter" && !loading && handleSubmit()}
              placeholder="npr. Srbija, Nemačka, Japan..."
              autoComplete="off"
              className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-transparent text-sm"
            />
            {showSuggestions && suggestions.length > 0 && (
              <ul className="absolute z-10 mt-1 w-full max-h-64 overflow-y-auto rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-lg">
                {suggestions.map((c) => (
                  <li key={c.code}>
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => pickCountry(c)}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    >
                      {c.name}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <button onClick={handleSubmit} disabled={loading} className="bg-blue-600 text-white font-semibold px-5 py-2 rounded-lg text-sm disabled:opacity-60">
            {loading ? "Tražim..." : "Prikaži"}
          </button>
        </div>
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400 mb-4">{error}</p>}

      {data && model && (
        <div className="space-y-4">
          {/* Zaglavlje */}
          <div className="border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/50 rounded-xl p-5">
            <h2 className="text-xl font-bold leading-tight">{data.meta.name}</h2>
            <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
              {[data.meta.region, data.meta.incomeLevel].filter(Boolean).join(" · ")}
              {data.meta.capitalCity ? ` · Glavni grad: ${data.meta.capitalCity}` : ""}
            </div>
          </div>

          {/* Kompozitni skor */}
          <div className="border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/50 rounded-xl p-4">
            <div className="flex flex-wrap items-center gap-4 mb-3">
              <div className="text-center px-4 py-2 rounded-xl bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900">
                <div className="text-[10px] uppercase tracking-wide opacity-70">Makroekonomsko zdravlje</div>
                <div className={`text-2xl font-bold ${scoreTextColor(model.composite)}`}>{model.composite != null ? model.composite.toFixed(1) : "—"}</div>
                <div className="text-xs font-bold">{scoreLabel(model.composite)}</div>
              </div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 flex-1 min-w-[200px]">
                Prosek 5 dimenzija ispod, izveden iz fiksnih, standardnih makroekonomskih pragova (ne subjektivna procena) — pokriva samo pokazatelje koji
                imaju dostupan podatak za ovu zemlju.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <StatTile label="Stanovništvo" value={fmtIndicatorValue(byCode("SP.POP.TOTL"), population)} />
              <StatTile label="BDP po glavi stanovnika" value={fmtIndicatorValue(byCode("NY.GDP.PCAP.CD"), gdpPerCapita)} />
              <StatTile label="Rast BDP-a" value={fmtIndicatorValue(byCode("NY.GDP.MKTP.KD.ZG"), gdpGrowth)} />
              <StatTile label="Inflacija" value={fmtIndicatorValue(byCode("FP.CPI.TOTL.ZG"), inflation)} />
            </div>
          </div>

          {/* Dimenzije */}
          <div className="grid sm:grid-cols-2 gap-4">
            {model.dimensions.map((dim) => (
              <Box
                key={dim.key}
                title={dim.label}
                badge={
                  <span className={`text-xs font-bold ${scoreTextColor(dim.score)}`}>
                    {dim.score != null ? dim.score.toFixed(1) : "—"}/5
                  </span>
                }
              >
                <DotMeter score={dim.score} />
                <div className="mt-2">
                  {byDimension(dim.key).map((def) => {
                    const point = data.indicators[def.code];
                    const tone = def.tone(point?.value ?? null);
                    return <IndicatorRow key={def.code} label={def.label} value={fmtIndicatorValue(def, point)} year={point?.year ?? null} tone={toneColorClass(tone)} />;
                  })}
                </div>
              </Box>
            ))}
          </div>

          {/* Zastavice */}
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="border border-emerald-300/60 dark:border-emerald-700/50 bg-emerald-50 dark:bg-emerald-900/15 rounded-xl p-4">
              <h3 className="text-xs font-bold uppercase tracking-wide text-emerald-700 dark:text-emerald-400 mb-2">Zeleni signali</h3>
              {model.greenSignals.length ? (
                <ul className="space-y-1">
                  {model.greenSignals.map((s) => (
                    <li key={s.label} className="text-xs text-emerald-800 dark:text-emerald-300 flex gap-1.5">
                      <span className="shrink-0">✓</span>
                      <span>{s.label}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs italic text-emerald-800/70 dark:text-emerald-300/70">Nema jasnih pozitivnih signala u dostupnim podacima.</p>
              )}
            </div>
            <div className="border border-red-300/60 dark:border-red-700/50 bg-red-50 dark:bg-red-900/15 rounded-xl p-4">
              <h3 className="text-xs font-bold uppercase tracking-wide text-red-700 dark:text-red-400 mb-2">Crveni signali</h3>
              {model.redSignals.length ? (
                <ul className="space-y-1">
                  {model.redSignals.map((s) => (
                    <li key={s.label} className="text-xs text-red-800 dark:text-red-300 flex gap-1.5">
                      <span className="shrink-0">✗</span>
                      <span>{s.label}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs italic text-red-800/70 dark:text-red-300/70">Nema detektovanih upozorenja u dostupnim podacima.</p>
              )}
            </div>
          </div>

          <p className="text-[11px] text-zinc-400 italic">
            Izvor: World Bank Open Data (api.worldbank.org), besplatna javna baza. Makroekonomski podaci se ne ažuriraju dnevno/kvartalno kao cene akcija —
            prikazana je najnovija godina za koju World Bank ima objavljenu vrednost za svaki pokazatelj (naznačeno u zagradi uz broj), što za neke zemlje
            i pokazatelje može kasniti 1-2 godine. Javni dug, fiskalni bilans i Gini koeficijent su prikazani samo informativno (kad postoje) — World Bank
            pokrivenost tih tačno tih brojeva je rupičava i za velike, razvijene ekonomije, pa ne ulaze u skor ni u zelene/crvene signale; umesto duga,
            ocenu &quot;Fiskalna i finansijska snaga&quot; nosi bruto nacionalna štednja, koja ima znatno širu pokrivenost.
          </p>
        </div>
      )}
    </div>
  );
}
