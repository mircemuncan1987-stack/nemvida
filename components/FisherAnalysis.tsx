"use client";

import { useEffect, useState } from "react";

// Fišerovih (Philip Fisher, "Common Stocks and Uncommon Profits") 15
// kvalitativnih pitanja — namerno BEZ automatskih AI odgovora. Ova pitanja
// (integritet menadžmenta, odnosi sa zaposlenima, R&D efikasnost...) ne mogu
// se izračunati iz Yahoo Finance podataka niti ih ovaj sajt izmišlja —
// umesto toga, stranica je template/checklist za sopstveno istraživanje
// (vesti, godišnji izveštaji, investitorske prezentacije), koji se čuva
// lokalno po tikeru.
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

interface FisherRecord {
  companyName: string;
  answers: string[];
  conclusion: string;
}

function storageKey(ticker: string): string {
  return `nemvida_fisher_v1_${ticker}`;
}

function loadRecord(ticker: string): FisherRecord {
  try {
    const raw = localStorage.getItem(storageKey(ticker));
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.answers)) {
        return {
          companyName: parsed.companyName || ticker,
          answers: FISHER_QUESTIONS.map((_, i) => parsed.answers[i] || ""),
          conclusion: parsed.conclusion || "",
        };
      }
    }
  } catch {
    /* nije kritično ako localStorage nije dostupan */
  }
  return { companyName: ticker, answers: FISHER_QUESTIONS.map(() => ""), conclusion: "" };
}

function saveRecord(ticker: string, record: FisherRecord) {
  try {
    localStorage.setItem(storageKey(ticker), JSON.stringify(record));
  } catch {
    /* nije kritično ako localStorage nije dostupan */
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractCompanyName(stockData: any, fallback: string): string {
  const price = stockData?.quoteSummary?.result?.[0]?.price;
  return price?.longName || price?.shortName || fallback;
}

export default function FisherAnalysis() {
  const [tickerInput, setTickerInput] = useState("");
  const [activeTicker, setActiveTicker] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [record, setRecord] = useState<FisherRecord | null>(null);

  useEffect(() => {
    if (!activeTicker) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- učitavanje iz localStorage pri promeni aktivnog tikera, ne pri svakom render-u
    setRecord(loadRecord(activeTicker));
  }, [activeTicker]);

  async function openTicker() {
    const sym = tickerInput.trim().toUpperCase();
    if (!sym) return;
    setLoading(true);
    setError("");
    try {
      const stockRes = await fetch(`/api/stock?symbol=${encodeURIComponent(sym)}&type=valuation`, { cache: "no-store" });
      const stockData = await stockRes.json();
      if (!stockRes.ok) throw new Error(stockData?.error || `HTTP ${stockRes.status}`);
      const companyName = extractCompanyName(stockData, sym);
      const existing = loadRecord(sym);
      const merged: FisherRecord = { ...existing, companyName };
      saveRecord(sym, merged);
      setRecord(merged);
      setActiveTicker(sym);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Greška pri traženju tikera.");
    } finally {
      setLoading(false);
    }
  }

  function updateAnswer(i: number, value: string) {
    if (!activeTicker || !record) return;
    const next: FisherRecord = { ...record, answers: record.answers.map((a, idx) => (idx === i ? value : a)) };
    setRecord(next);
    saveRecord(activeTicker, next);
  }

  function updateConclusion(value: string) {
    if (!activeTicker || !record) return;
    const next: FisherRecord = { ...record, conclusion: value };
    setRecord(next);
    saveRecord(activeTicker, next);
  }

  const answeredCount = record ? record.answers.filter((a) => a.trim().length > 0).length : 0;

  return (
    <div className="max-w-3xl mx-auto px-4 pb-16">
      <div className="mt-4 mb-5 text-sm leading-relaxed rounded-xl border border-amber-300/60 dark:border-amber-700/50 bg-amber-50 dark:bg-amber-900/15 text-amber-800 dark:text-amber-300 p-4">
        <b>⚠ Ovo NIJE finansijski savet, i NIJE AI-generisana analiza.</b> Ovo je template/checklist Fišerovih
        (Philip Fisher, &quot;Common Stocks and Uncommon Profits&quot;) 15 pitanja, prevedenih na srpski, za tvoje
        sopstveno istraživanje (vesti, godišnji i kvartalni izveštaji, investitorske prezentacije). Sajt ne izmišlja
        odgovore na ova pitanja — ona su namerno kvalitativna (integritet menadžmenta, odnosi sa zaposlenima...) i ne
        mogu se izračunati iz Yahoo Finance podataka kao ostatak modela. Tvoji odgovori se čuvaju lokalno u ovom
        pregledaču, po tikeru.
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
          {loading ? "Tražim..." : "Otvori checklist"}
        </button>
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400 mb-4">{error}</p>}

      {activeTicker && record && (
        <div className="border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/50 rounded-xl p-5">
          <div className="flex items-baseline justify-between mb-4">
            <h2 className="text-lg font-bold">
              {record.companyName} ({activeTicker})
            </h2>
            <span className="text-xs text-zinc-500 dark:text-zinc-400">{answeredCount}/15 popunjeno</span>
          </div>
          <div className="space-y-4">
            {FISHER_QUESTIONS.map((q, i) => (
              <div key={i}>
                <label className="block text-sm font-medium mb-1">
                  {i + 1}. {q}
                </label>
                <textarea
                  value={record.answers[i]}
                  onChange={(e) => updateAnswer(i, e.target.value)}
                  rows={2}
                  placeholder="Tvoj odgovor/beleške..."
                  className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-transparent text-sm resize-y"
                />
              </div>
            ))}
          </div>
          <div className="mt-5 pt-4 border-t border-zinc-200 dark:border-zinc-800">
            <label className="block text-sm font-bold mb-1">Zaključak — da li bi Fišer kupio ovu akciju?</label>
            <textarea
              value={record.conclusion}
              onChange={(e) => updateConclusion(e.target.value)}
              rows={3}
              placeholder="Tvoj zaključak na osnovu odgovora iznad..."
              className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-transparent text-sm resize-y"
            />
          </div>
        </div>
      )}
    </div>
  );
}
