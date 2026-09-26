// Lokalni "dnevnik" preporuka — beleži sud modela za tiker onog trenutka kad
// ga korisnik analizira na /pregled, da bi se kasnije mogao provideti stvarni
// učinak tog suda (nadmašuje/ispod SPY od tog datuma). Ovo NIJE retroaktivni
// backtest (nema istorijske baze prošlih sudova modela) — praćenje počinje
// od trenutka kad je tiker prvi put analiziran u ovom pregledaču, ne unazad.

export interface VerdictJournalEntry {
  ticker: string;
  companyName: string;
  date: string; // YYYY-MM-DD, dan kada je sud zabeležen
  verdict: string;
  price: number;
  currency: string;
}

const STORAGE_KEY = "nemvida_verdict_journal_v1";

export function loadVerdictJournal(): VerdictJournalEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// Jedan zapis po tikeru po kalendarskom danu — ponovna analiza istog tikera
// istog dana samo ažurira zapis (idempotentno), analiza drugog dana dodaje
// novi zapis, tako da se sud vremenom prirodno "obnavlja" kroz korišćenje
// alata, bez ručnog upravljanja.
export function recordVerdict(entry: VerdictJournalEntry) {
  try {
    const journal = loadVerdictJournal();
    const idx = journal.findIndex((e) => e.ticker === entry.ticker && e.date === entry.date);
    if (idx >= 0) journal[idx] = entry;
    else journal.push(entry);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(journal));
  } catch {
    /* nije kritično ako localStorage nije dostupan */
  }
}

export function removeVerdictEntry(ticker: string, date: string) {
  try {
    const journal = loadVerdictJournal().filter((e) => !(e.ticker === ticker && e.date === date));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(journal));
  } catch {
    /* nije kritično ako localStorage nije dostupan */
  }
}
