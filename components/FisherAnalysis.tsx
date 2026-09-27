"use client";

import { useState } from "react";
import { FISHER_DATABASE, FISHER_DATABASE_NOTE } from "@/lib/fisherDatabase";

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
      const hasContent =
        parsed && Array.isArray(parsed.answers) && (parsed.answers.some((a: string) => a?.trim()) || parsed.conclusion?.trim());
      // Prazan sačuvan zapis (npr. iz vremena pre nego što je baza dodata, kada
      // je samo otvaranje tikera upisivalo praznu belešku) se ignoriše — inače
      // bi trajno "zaklonio" bazu za taj tiker, bez ikakve stvarne korisnikove
      // izmene koju bi trebalo očuvati.
      if (hasContent) {
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
  const dbEntry = FISHER_DATABASE[ticker];
  if (dbEntry) {
    return { companyName: dbEntry.companyName, answers: [...dbEntry.answers], conclusion: dbEntry.conclusion };
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
      // Ne upisuje se ovde — samo otvaranje tikera ne treba da upiše ništa u
      // localStorage (ni prazan checklist, ni tekst iz baze), da se ne bi
      // "zaključao" podrazumevani tekst iz baze pre nego što korisnik stvarno
      // izmeni neki odgovor. Upisuje se samo pri stvarnoj izmeni (updateAnswer/
      // updateConclusion).
      setRecord({ ...existing, companyName });
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
  const isFromDatabase = activeTicker != null && activeTicker in FISHER_DATABASE;

  return (
    <div className="max-w-3xl mx-auto px-4 pb-16">
      <div className="mt-4 mb-5 text-sm leading-relaxed rounded-xl border border-amber-300/60 dark:border-amber-700/50 bg-amber-50 dark:bg-amber-900/15 text-amber-800 dark:text-amber-300 p-4">
        <b>⚠ Ovo NIJE finansijski savet.</b> Ovo je checklist Fišerovih (Philip Fisher, &quot;Common Stocks and
        Uncommon Profits&quot;) 15 pitanja, prevedenih na srpski. Za oko 100 najvećih S&P 500 kompanija (uključujući
        MSFT, AAPL, NVDA...) odgovori su unapred popunjeni iz baze koju je napisao AI na osnovu opšteg znanja — ne iz
        merljivih Yahoo Finance podataka kao ostatak sajta, i ne iz live pretrage interneta, pa mogu biti zastareli
        ili netačni, posebno za skorašnje događaje. Za sve ostale tikere kreće se od prazne checklist-e za tvoje
        sopstveno istraživanje. Bilo koji odgovor možeš izmeniti — izmene se čuvaju lokalno u ovom pregledaču, po
        tikeru, i imaju prednost nad tekstom iz baze.
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
          {isFromDatabase && (
            <p className="text-xs text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg px-3 py-2 mb-4">
              Odgovori ispod su unapred popunjeni iz baze — {FISHER_DATABASE_NOTE} Slobodno izmeni bilo koji odgovor,
              tvoja izmena se čuva lokalno i ima prednost nad ovim tekstom.
            </p>
          )}
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
