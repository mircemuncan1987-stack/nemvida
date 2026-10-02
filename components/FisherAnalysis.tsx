"use client";

import { useState } from "react";
import { FISHER_DATABASE, FISHER_DATABASE_NOTE } from "@/lib/fisherDatabase";

// Fišerovih (Philip Fisher, "Common Stocks and Uncommon Profits") 15
// kvalitativnih pitanja. Ova pitanja (integritet menadžmenta, odnosi sa
// zaposlenima, R&D efikasnost...) ne mogu se izračunati iz Yahoo Finance
// podataka kao ostatak sajta — odgovori ispod dolaze isključivo iz
// unapred istražene baze (lib/fisherDatabase.ts), samo za čitanje.
const FISHER_QUESTIONS: string[] = [
  "Ima li kompanija proizvode ili usluge sa dovoljnim tržišnim potencijalom da omoguće značajan rast prodaje u trajanju od najmanje nekoliko godina?",
  "Da li menadžment ima volju da nastavi razvoj novih proizvoda ili procesa koji će dalje povećati ukupni potencijal prodaje, kada rastni potencijal trenutnih atraktivnih proizvodnih linija bude u velikoj meri iskorišćen?",
  "Koliko su efikasni napori kompanije u istraživanju i razvoju (R&D) u odnosu na njenu veličinu?",
  "Ima li kompanija prodajnu organizaciju iznad proseka?",
  "Ima li kompanija profitabilnu profitnu marginu?",
  "Šta kompanija radi da bi održala ili poboljšala profitne margine?",
  "Ima li kompanija izuzetne odnose sa radnicima i osobljem?",
  "Ima li kompanija izuzetne odnose među rukovodstvom (executive relations)?",
  "Ima li kompanija dubinu u menadžmentu (dovoljno kvalitetnih ljudi ispod samog vrha)?",
  "Koliko su dobri sistemi kompanije za analizu troškova i računovodstvenu kontrolu?",
  "Postoje li drugi aspekti poslovanja, specifični za tu granu, koji investitoru daju važne indicije o tome koliko je kompanija izuzetna u odnosu na konkurenciju?",
  "Ima li kompanija kratkoročnu ili dugoročnu perspektivu kada je reč o profitu?",
  "Da li će rast kompanije u doglednoj budućnosti zahtevati dovoljno finansiranja putem emisije novih akcija, tako da bi veći broj akcija u velikoj meri poništio korist koju postojeći akcionari inače imaju od tog očekivanog rasta?",
  'Govori li menadžment slobodno investitorima o poslovanju kada stvari idu dobro, ali se "zatvara" (ćuti) kada nastanu problemi i razočaranja?',
  "Ima li kompanija menadžment neupitnog integriteta?",
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractCompanyName(stockData: any, fallback: string): string {
  const price = stockData?.quoteSummary?.result?.[0]?.price;
  return price?.longName || price?.shortName || fallback;
}

interface DbSuggestion {
  ticker: string;
  companyName: string;
}

const DB_ENTRIES: DbSuggestion[] = Object.entries(FISHER_DATABASE).map(([ticker, e]) => ({ ticker, companyName: e.companyName }));

// Pretraga po tikeru ILI po nazivu kompanije (delimično poklapanje, bez
// razlike malih/velikih slova) — baza ima samo ~100 kompanija, pa je
// pretraga trenutna i lokalna, bez poziva na server.
function searchDatabase(query: string): DbSuggestion[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  return DB_ENTRIES.filter((e) => e.ticker.toLowerCase().includes(q) || e.companyName.toLowerCase().includes(q)).slice(0, 8);
}

// Kad korisnik otkuca ceo naziv (ili deo koji jednoznačno odgovara samo
// jednoj kompaniji) i pritisne Enter/"Prikaži" bez klika na predlog iz
// padajuće liste — isti rezultat kao da je kliknuo predlog.
function resolveToTicker(query: string): string | null {
  const trimmed = query.trim();
  if (!trimmed) return null;
  const upper = trimmed.toUpperCase();
  if (FISHER_DATABASE[upper]) return upper;
  const q = trimmed.toLowerCase();
  const exact = DB_ENTRIES.find((e) => e.companyName.toLowerCase() === q);
  if (exact) return exact.ticker;
  const matches = searchDatabase(trimmed);
  if (matches.length === 1) return matches[0].ticker;
  return null;
}

export default function FisherAnalysis() {
  const [tickerInput, setTickerInput] = useState("");
  const [activeTicker, setActiveTicker] = useState<string | null>(null);
  const [companyName, setCompanyName] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [suggestions, setSuggestions] = useState<DbSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  async function openTicker(symOverride?: string) {
    const raw = (symOverride ?? tickerInput).trim();
    if (!raw) return;
    setShowSuggestions(false);
    setLoading(true);
    setError("");
    const dbTicker = resolveToTicker(raw);
    const sym = (dbTicker ?? raw).toUpperCase();
    try {
      const stockRes = await fetch(`/api/stock?symbol=${encodeURIComponent(sym)}&type=valuation`, { cache: "no-store" });
      const stockData = await stockRes.json();
      if (!stockRes.ok) throw new Error(stockData?.error || `HTTP ${stockRes.status}`);
      setCompanyName(extractCompanyName(stockData, sym));
      setActiveTicker(sym);
      setTickerInput(sym);
    } catch (err) {
      if (dbTicker) {
        // Živi podatak (cena/trenutni naziv) nije dostupan, ali kompanija je
        // u Fišerovoj bazi — prikaži iz baze umesto da prijavljuje grešku.
        setCompanyName(FISHER_DATABASE[dbTicker].companyName);
        setActiveTicker(dbTicker);
        setTickerInput(dbTicker);
      } else {
        setError(err instanceof Error ? err.message : "Greška pri traženju tikera ili naziva kompanije.");
      }
    } finally {
      setLoading(false);
    }
  }

  function handleInputChange(value: string) {
    setTickerInput(value);
    const found = searchDatabase(value);
    setSuggestions(found);
    setShowSuggestions(found.length > 0);
  }

  function pickSuggestion(s: DbSuggestion) {
    setSuggestions([]);
    setShowSuggestions(false);
    setTickerInput(s.ticker);
    openTicker(s.ticker);
  }

  const dbEntry = activeTicker ? FISHER_DATABASE[activeTicker] : null;

  return (
    <div className="max-w-3xl mx-auto px-4 pb-16">
      <div className="border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/50 rounded-xl p-4 mb-4 flex flex-wrap gap-3 items-center">
        <div className="flex-1 min-w-[220px] relative">
          <input
            type="text"
            value={tickerInput}
            onChange={(e) => handleInputChange(e.target.value)}
            onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
            onKeyDown={(e) => e.key === "Enter" && !loading && openTicker()}
            placeholder="Ticker ili naziv kompanije (npr. MSFT ili Microsoft)"
            autoComplete="off"
            className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-transparent text-sm"
          />
          {showSuggestions && suggestions.length > 0 && (
            <ul className="absolute z-10 mt-1 w-full max-h-64 overflow-y-auto rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-lg">
              {suggestions.map((s) => (
                <li key={s.ticker}>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pickSuggestion(s)}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800 flex justify-between gap-2"
                  >
                    <span className="truncate">
                      <span className="font-semibold">{s.ticker}</span>{" "}
                      <span className="text-zinc-500 dark:text-zinc-400">{s.companyName}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <button onClick={() => openTicker()} disabled={loading} className="bg-blue-600 text-white font-semibold px-5 py-2 rounded-lg text-sm disabled:opacity-60">
          {loading ? "Tražim..." : "Prikaži"}
        </button>
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400 mb-4">{error}</p>}

      {activeTicker && (
        <div className="border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/50 rounded-xl p-5">
          <h2 className="text-lg font-bold mb-4">
            {companyName || dbEntry?.companyName || activeTicker} ({activeTicker})
          </h2>

          {dbEntry ? (
            <>
              <div className="space-y-4">
                {FISHER_QUESTIONS.map((q, i) => (
                  <div key={i}>
                    <div className="text-sm font-semibold text-blue-700 dark:text-blue-400 mb-1.5">
                      {i + 1}. {q}
                    </div>
                    <p className="text-sm text-zinc-600 dark:text-zinc-400 whitespace-pre-wrap break-words border-l-2 border-zinc-200 dark:border-zinc-700 pl-3">
                      {dbEntry.answers[i]}
                    </p>
                  </div>
                ))}
              </div>
              <div className="mt-5 pt-4 border-t border-zinc-200 dark:border-zinc-800">
                <div className="text-sm font-semibold text-blue-700 dark:text-blue-400 mb-1.5">Zaključak — da li bi Fišer kupio ovu akciju?</div>
                <p className="text-sm text-zinc-600 dark:text-zinc-400 whitespace-pre-wrap break-words border-l-2 border-zinc-200 dark:border-zinc-700 pl-3">{dbEntry.conclusion}</p>
              </div>
              <p className="text-[11px] text-zinc-400 mt-4 italic">{FISHER_DATABASE_NOTE}</p>
            </>
          ) : (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Ovaj tiker nije u bazi (baza pokriva samo oko 100 najvećih S&P 500 kompanija). Javi ticker ako želiš da
              bude dodat.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
