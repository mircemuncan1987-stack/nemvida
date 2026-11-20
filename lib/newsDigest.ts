// Sintetizovani rezime vesti (Claude API) — umesto liste linkova, od kojih je
// većina iza pretplate. Samo za server.
//
// Ulaz su NASLOVI i kratki opisi iz RSS feedova (Google News, Yahoo Finance)
// — ceo tekst članaka nije dostupan ni serveru (paywall), pa je rezime
// sinteza onoga što se iz naslova i opisa može pouzdano zaključiti.
//
// Dve vrste rezimea:
// - TRŽIŠTE (/trziste): analiza uzroka — šta se desilo, zašto, koji makro
//   faktori su umešani, kakva je tendencija i scenariji daljeg rasta/pada.
//   Uz vesti se šalju stvarne dnevne, nedeljne i mesečne promene cena, da
//   objašnjenja budu vezana za brojeve. Effort "medium": traži se
//   povezivanje uzroka, ne samo sažimanje.
// - KOMPANIJE (Vesti): kraći rezime vesti o izabranoj kompaniji (effort "low").
//
// Rezime se kešira 2 sata po temi (Next Data Cache, deli se između svih
// posetilaca i instanci servera), pa se Claude poziva najviše ~12 puta
// dnevno po temi, i samo za teme koje neko zaista otvori. Greške se NE
// keširaju (bacaju se iz keširane funkcije) — nakon što se API ključ
// podesi ili Claude ponovo postane dostupan, sledeći zahtev odmah radi.

import Anthropic from "@anthropic-ai/sdk";
import { unstable_cache } from "next/cache";
import { companies, findCompany } from "@/lib/companies";
import { dedupeAndSort, fetchGoogleNewsFeed, fetchYahooFinanceFeed, type FeedItem } from "@/lib/rss";
import { fetchAllQuotes } from "@/lib/marketData";
import { MARKET_GROUPS } from "@/lib/marketInstruments";

export type SignalTone = "pozitivno" | "negativno" | "neutralno";
type Sentiment = "pozitivno" | "negativno" | "mešovito" | "neutralno";

export interface NewsDigest {
  headline: string;
  sentiment: Sentiment;
  signals: { tone: SignalTone; title: string; detail: string }[];
  summary: string[];
  watch: string[];
}

export interface MarketDigest {
  headline: string;
  sentiment: Sentiment;
  whatHappened: string;
  drivers: { tone: SignalTone; title: string; why: string; confirmed: boolean }[];
  macro: { factor: string; detail: string }[];
  trend: string;
  scenarios: { direction: "rast" | "pad"; title: string; triggers: string; signals: string }[];
  watch: string[];
}

export interface DigestSource {
  title: string;
  link: string;
  source: string;
  isoDate: string;
}

interface DigestMeta {
  status: "ok";
  generatedAt: string;
  sources: DigestSource[];
  model: string;
}

export type DigestResult =
  | (DigestMeta & { kind: "market"; digest: MarketDigest })
  | (DigestMeta & { kind: "company"; digest: NewsDigest })
  | { status: "unavailable"; reason: string };

const MODEL = "claude-opus-5-5";
const CACHE_SECONDS = 2 * 60 * 60;
const MAX_DESCRIPTION_CHARS = 280;

const TONE = { type: "string", enum: ["pozitivno", "negativno", "neutralno"] } as const;
const SENTIMENT = { type: "string", enum: ["pozitivno", "negativno", "mešovito", "neutralno"] } as const;

const COMPANY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["headline", "sentiment", "signals", "summary", "watch"],
  properties: {
    headline: { type: "string", description: "Jedna rečenica: najvažnija poruka perioda." },
    sentiment: SENTIMENT,
    signals: {
      type: "array",
      description: "3-6 najvažnijih signala, najvažniji prvi.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["tone", "title", "detail"],
        properties: {
          tone: TONE,
          title: { type: "string", description: "Kratak naslov signala, do 8 reči." },
          detail: { type: "string", description: "1-2 rečenice: šta se desilo i zašto je važno." },
        },
      },
    },
    summary: { type: "array", description: "2-4 kratka pasusa sinteze, svaki 2-4 rečenice.", items: { type: "string" } },
    watch: { type: "array", description: "2-4 stvari koje treba pratiti narednih dana.", items: { type: "string" } },
  },
} as const;

const MARKET_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["headline", "sentiment", "whatHappened", "drivers", "macro", "trend", "scenarios", "watch"],
  properties: {
    headline: { type: "string", description: "Jedna rečenica: glavna poruka — šta se desilo i glavni razlog." },
    sentiment: SENTIMENT,
    whatHappened: {
      type: "string",
      description: "Jedan pasus (3-5 rečenica): kako su se kretala tržišta danas i ove nedelje — indeksi, nafta, zlato, kamate, VIX, kruna — sa konkretnim brojevima iz tržišnih podataka.",
    },
    drivers: {
      type: "array",
      description: "3-6 glavnih pokretača kretanja, najvažniji prvi.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["tone", "title", "why", "confirmed"],
        properties: {
          tone: TONE,
          title: { type: "string", description: "Kratak naziv pokretača, do 8 reči." },
          why: { type: "string", description: "2-3 rečenice: šta se desilo, ZAŠTO je pomerilo tržište i koja tržišta/sektore pogađa." },
          confirmed: { type: "boolean", description: "true ako vesti direktno navode ovaj uzrok; false ako je to tumačenje ili povezivanje više vesti." },
        },
      },
    },
    macro: {
      type: "array",
      description: "2-5 makroekonomskih faktora koji su sada u igri (npr. kamate i centralne banke, inflacija, tržište rada, dolar i kruna, energija, Kina, geopolitika) i kako se prelivaju na tržišta.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["factor", "detail"],
        properties: {
          factor: { type: "string", description: "Naziv faktora, do 5 reči." },
          detail: { type: "string", description: "2-3 rečenice: trenutno stanje, kako utiče na akcije/obveznice/valute i šta je bitno za investitora iz Norveške." },
        },
      },
    },
    trend: {
      type: "string",
      description: "Jedan pasus (3-5 rečenica): opšta tendencija u poslednjih nedelju dana i mesec (na osnovu nedeljnih i mesečnih promena), da li je kretanje široko ili usko (npr. samo tehnologija), i šta to govori o raspoloženju.",
    },
    scenarios: {
      type: "array",
      description: "Tačno dva scenarija: jedan za dalji rast i jedan za dalji pad.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["direction", "title", "triggers", "signals"],
        properties: {
          direction: { type: "string", enum: ["rast", "pad"] },
          title: { type: "string", description: "Kratak naziv scenarija." },
          triggers: { type: "string", description: "2-3 rečenice: šta bi moralo da se desi da ovaj scenario nastupi i zašto bi to pomerilo tržište." },
          signals: { type: "string", description: "1-2 rečenice: koje konkretne podatke ili događaje pratiti kao rani znak da se scenario ostvaruje." },
        },
      },
    },
    watch: { type: "array", description: "2-5 konkretnih događaja ili podataka narednih dana/nedelja (objave, sastanci centralnih banaka, rezultati).", items: { type: "string" } },
  },
} as const;

const BASE_RULES = `Pišeš na srpskom jeziku, latinicom, jasno i bez žargona; stručni termin objasni u pola rečenice kad se prvi put pojavi.

Pravila:
- Oslanjaj se isključivo na dostavljene vesti i brojeve. Ne dodaji činjenice, brojeve, datume ni citate kojih nema u ulazu. Brojeve o cenama uzimaj samo iz dela sa tržišnim podacima.
- Sintetizuj: spoji više vesti o istoj temi u jednu misao, umesto da prepričavaš naslov po naslov. Izdvoji ono što zaista utiče na cene ili dugoročnu vrednost, a preskoči šum i ponavljanja.
- Jasno razdvoji šta vesti direktno navode od tvog tumačenja. Kad se vesti razilaze ili su nepotvrđene (glasine, "prema izvorima"), reci to.
- Ne daj preporuke za kupovinu ili prodaju.`;

const MARKET_SYSTEM = `Ti si iskusan makro i tržišni analitičar koji piše dnevni pregled za privatnog investitora iz Norveške. Investitor ulaže dugoročno: u američke tehnološke i finansijske kompanije, norveške energetske kompanije i banke, švedske holding kompanije i indeksne fondove za Aziju i tržišta u razvoju. Ne zanima ga prepričavanje vesti, nego RAZUMEVANJE: šta pokreće tržišta, zašto, koji makroekonomski faktori su umešani i kuda bi stvari mogle da krenu.

${BASE_RULES}
- Za svaki pokretač objasni mehanizam (npr. "viši prinosi na obveznice → skuplje zaduživanje i manje privlačne akcije rasta → pad tehnologije"), ne samo da se nešto desilo.
- Poveži kretanja: ako se nafta, kruna i Oslo berza kreću zajedno, ili ako kamate i tehnologija idu u suprotnim smerovima, to istakni.
- O budućnosti NE predviđaj. Piši scenarije: šta bi moralo da se desi za dalji rast, a šta za dalji pad, i koji rani znaci to najavljuju. Oba scenarija moraju biti realna i zasnovana na ulazu.
- Ukupno oko 500-700 reči.`;

const COMPANY_SYSTEM = `Ti si finansijski analitičar koji piše kratak, pregledan rezime vesti za privatnog investitora koji živi u Norveškoj i ulaže dugoročno.

${BASE_RULES}
- Budi sažet: ukupno oko 250-400 reči.`;

function formatItems(items: FeedItem[], max: number): string {
  return items
    .slice(0, max)
    .map((item) => {
      const date = item.isoDate.slice(0, 10);
      const desc = item.description && item.description !== item.title ? ` — ${item.description.slice(0, MAX_DESCRIPTION_CHARS)}` : "";
      return `- [${date}] (${item.source}) ${item.title}${desc}`;
    })
    .join("\n");
}

function toSources(items: FeedItem[], max: number): DigestSource[] {
  return items.slice(0, max).map((i) => ({ title: i.title, link: i.link, source: i.source, isoDate: i.isoDate }));
}

function weekOld(items: FeedItem[]): FeedItem[] {
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  return items.filter((i) => new Date(i.isoDate).getTime() >= weekAgo);
}

async function callClaude<T>(system: string, schema: object, effort: "low" | "medium", userContent: string): Promise<T> {
  const client = new Anthropic();
  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    output_config: { effort, format: { type: "json_schema", schema: schema as { [key: string]: unknown } } },
    // Ako sigurnosni filter odbije zahtev, API ga sam ponovi na rezervnom
    // modelu u istom pozivu, umesto da rezime izostane.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system,
    messages: [{ role: "user", content: userContent }],
  });

  if (response.stop_reason === "refusal") throw new Error("Model je odbio zahtev");
  if (response.stop_reason === "max_tokens") throw new Error("Rezime je prekinut (max_tokens)");
  const text = response.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  return JSON.parse(text) as T;
}

function fmtPct(x: number | null): string {
  return x == null ? "n/a" : `${x >= 0 ? "+" : ""}${(x * 100).toFixed(2)}%`;
}

function fmtBp(x: number | null): string {
  return x == null ? "n/a" : `${x >= 0 ? "+" : ""}${Math.round(x * 100)} b.p.`;
}

const MARKET_QUERIES = [
  { query: "stock market today", label: "Svetska tržišta" },
  { query: "Wall Street stocks why", label: "SAD" },
  { query: "Federal Reserve interest rates", label: "Fed / kamate" },
  { query: "inflation CPI report", label: "Inflacija" },
  { query: "jobs report unemployment US economy", label: "Tržište rada" },
  { query: "Treasury yields bond market", label: "Obveznice" },
  { query: "ECB interest rates euro economy", label: "ECB / Evropa" },
  { query: "Norges Bank krone", label: "Norges Bank / NOK" },
  { query: "Oslo Børs", label: "Oslo Børs" },
  { query: "Stockholmsbörsen", label: "Stokholm" },
  { query: "oil price Brent OPEC", label: "Nafta" },
  { query: "gold price", label: "Zlato" },
  { query: "China economy stimulus", label: "Kina" },
  { query: "Asian markets Nikkei Shanghai", label: "Azija" },
  { query: "earnings season results guidance", label: "Rezultati kompanija" },
  { query: "geopolitics tariffs markets", label: "Geopolitika / carine" },
];
const MARKET_MAX_ITEMS = 90;

async function buildMarketDigest(): Promise<Extract<DigestResult, { kind: "market" }>> {
  const [feeds, quotes] = await Promise.all([
    Promise.all(MARKET_QUERIES.map((q) => fetchGoogleNewsFeed(q.query, q.label, q.label).catch(() => [] as FeedItem[]))),
    fetchAllQuotes(),
  ]);
  const items = weekOld(dedupeAndSort(feeds.flat()));
  if (items.length === 0) throw new Error("Nema dostupnih vesti");

  const quoteById = new Map(quotes.map((q) => [q.id, q]));
  const marketLines = MARKET_GROUPS.map((g) => {
    const rows = g.instruments
      .map((inst) => {
        const q = quoteById.get(inst.id);
        if (!q || q.price == null) return null;
        const monthRef = q.spark.length > 1 ? q.spark[0] : null;
        if (inst.kind === "yield") {
          const monthAbs = monthRef != null ? q.price - monthRef : null;
          return `${inst.name}: ${q.price.toFixed(2)}% (dan ${fmtBp(q.dayChange)}, nedelja ${fmtBp(q.weekChange)}, mesec ${fmtBp(monthAbs)})`;
        }
        const monthPct = monthRef ? (q.price - monthRef) / monthRef : null;
        return `${inst.name}: ${q.price.toFixed(inst.kind === "fx" ? 4 : 2)} (dan ${fmtPct(q.dayChangePercent)}, nedelja ${fmtPct(q.weekChangePercent)}, mesec ${fmtPct(monthPct)})`;
      })
      .filter(Boolean);
    return rows.length ? `${g.title}:\n${rows.join("\n")}` : null;
  })
    .filter(Boolean)
    .join("\n\n");

  const user = `Napiši pregled tržišta za danas i ovu nedelju: šta se desilo, zašto, koji makro faktori su umešani, kakva je tendencija i scenariji daljeg rasta i pada.

TRŽIŠNI PODACI (stvarne cene; promena za dan, za 5 trgovačkih dana i za oko mesec dana):
${marketLines || "nisu dostupni"}

VESTI (poslednjih 7 dana, najnovije prve; u zagradi izvor):
${formatItems(items, MARKET_MAX_ITEMS)}`;

  const digest = await callClaude<MarketDigest>(MARKET_SYSTEM, MARKET_SCHEMA, "medium", user);
  return { status: "ok", kind: "market", digest, generatedAt: new Date().toISOString(), sources: toSources(items, MARKET_MAX_ITEMS), model: MODEL };
}

const COMPANY_MAX_ITEMS = 60;

async function buildCompanyDigest(ticker: string | null): Promise<Extract<DigestResult, { kind: "company" }>> {
  const targets = ticker ? [findCompany(ticker)].filter((c): c is NonNullable<typeof c> => !!c) : companies;
  if (targets.length === 0) throw new Error("Nepoznat tiker");

  const feeds = await Promise.all(
    targets.map(async (company) => {
      const parts = await Promise.all([
        fetchGoogleNewsFeed(company.searchTerms[0], company.ticker, company.name).catch(() => [] as FeedItem[]),
        company.yahooSymbol ? fetchYahooFinanceFeed(company.yahooSymbol, company.ticker, company.name).catch(() => [] as FeedItem[]) : Promise.resolve([] as FeedItem[]),
      ]);
      return parts.flat();
    })
  );
  const items = weekOld(dedupeAndSort(feeds.flat()));
  if (items.length === 0) throw new Error("Nema dostupnih vesti");

  const subject = ticker
    ? `kompaniju ${targets[0].name} (${targets[0].ticker}): šta se dešava sa poslovanjem, šta tržište o tome misli i šta je važno za dugoročnog akcionara`
    : `kompanije koje investitor prati (${companies.map((c) => c.name).join(", ")}): najvažniji događaji po kompanijama i zajedničke teme; u signalima navedi na koju se kompaniju odnosi`;

  const user = `Napiši rezime najvažnijih vesti i signala za ${subject}. Period: poslednjih 7 dana.

VESTI (najnovije prve; u zagradi izvor${ticker ? "" : "; svaka vest je o jednoj od navedenih kompanija"}):
${formatItems(ticker ? items : items.map((i) => ({ ...i, title: `${i.companyName}: ${i.title}` })), COMPANY_MAX_ITEMS)}`;

  const digest = await callClaude<NewsDigest>(COMPANY_SYSTEM, COMPANY_SCHEMA, "low", user);
  return { status: "ok", kind: "company", digest, generatedAt: new Date().toISOString(), sources: toSources(items, COMPANY_MAX_ITEMS), model: MODEL };
}

const cachedMarketDigest = unstable_cache(buildMarketDigest, ["news-digest", "market", "v2"], { revalidate: CACHE_SECONDS });
const cachedCompanyDigest = unstable_cache(buildCompanyDigest, ["news-digest", "company", "v2"], { revalidate: CACHE_SECONDS });

export async function getDigest(scope: "market" | "company", ticker: string | null): Promise<DigestResult> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { status: "unavailable", reason: "Rezime nije podešen: na serveru nedostaje ANTHROPIC_API_KEY." };
  }
  try {
    return scope === "market" ? await cachedMarketDigest() : await cachedCompanyDigest(ticker ? ticker.toUpperCase() : null);
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return { status: "unavailable", reason: "API ključ nije ispravan." };
    if (e instanceof Anthropic.RateLimitError) return { status: "unavailable", reason: "Previše zahteva ka Claude API-ju — pokušaj za minut." };
    if (e instanceof Anthropic.APIError) return { status: "unavailable", reason: `Claude API greška (${e.status ?? "nepoznato"}).` };
    return { status: "unavailable", reason: e instanceof Error ? e.message : "Rezime trenutno nije dostupan." };
  }
}
