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

export default function FisherAnalysis() {
  const [tickerInput, setTickerInput] = useState("");
  const [activeTicker, setActiveTicker] = useState<string | null>(null);
  const [companyName, setCompanyName] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function openTicker() {
    const sym = tickerInput.trim().toUpperCase();
    if (!sym) return;
    setLoading(true);
    setError("");
    try {
      const stockRes = await fetch(`/api/stock?symbol=${encodeURIComponent(sym)}&type=valuation`, { cache: "no-store" });
      const stockData = await stockRes.json();
      if (!stockRes.ok) throw new Error(stockData?.error || `HTTP ${stockRes.status}`);
      setCompanyName(extractCompanyName(stockData, sym));
      setActiveTicker(sym);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Greška pri traženju tikera.");
    } finally {
      setLoading(false);
    }
  }

  const dbEntry = activeTicker ? FISHER_DATABASE[activeTicker] : null;

  return (
    <div className="max-w-3xl mx-auto px-4 pb-16">
      <div className="mt-4 mb-5 text-sm leading-relaxed rounded-xl border border-amber-300/60 dark:border-amber-700/50 bg-amber-50 dark:bg-amber-900/15 text-amber-800 dark:text-amber-300 p-4">
        <b>⚠ Ovo NIJE finansijski savet.</b> Fišerovih (Philip Fisher, &quot;Common Stocks and Uncommon
        Profits&quot;) 15 pitanja, prevedenih na srpski. Odgovori postoje samo za oko 100 najvećih S&P 500 kompanija
        (uključujući MSFT, AAPL, NVDA...) i napisao ih je AI na osnovu opšteg znanja — ne iz merljivih Yahoo Finance
        podataka kao ostatak sajta, i ne iz live pretrage interneta, pa mogu biti zastareli ili netačni, posebno za
        skorašnje događaje.
      </div>

      <div className="border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/50 rounded-xl p-4 mb-4 flex flex-wrap gap-3 items-center">
        <input
          type="text"
          value={tickerInput}
          onChange={(e) => setTickerInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !loading && openTicker()}
          placeholder="Ticker (npr. MSFT)"
          className="flex-1 min-w-[160px] px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-transparent text-sm"
        />
        <button onClick={openTicker} disabled={loading} className="bg-blue-600 text-white font-semibold px-5 py-2 rounded-lg text-sm disabled:opacity-60">
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
                    <div className="text-sm font-medium mb-1">
                      {i + 1}. {q}
                    </div>
                    <p className="text-sm text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap break-words">
                      {dbEntry.answers[i]}
                    </p>
                  </div>
                ))}
              </div>
              <div className="mt-5 pt-4 border-t border-zinc-200 dark:border-zinc-800">
                <div className="text-sm font-bold mb-1">Zaključak — da li bi Fišer kupio ovu akciju?</div>
                <p className="text-sm text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap break-words">{dbEntry.conclusion}</p>
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
