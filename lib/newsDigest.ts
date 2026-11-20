// Sintetizovani rezime vesti (Claude API) — umesto liste linkova, od kojih je
// većina iza pretplate. Samo za server.
//
// Ulaz su NASLOVI i kratki opisi iz RSS feedova (Google News, Yahoo Finance)
// — ceo tekst članaka nije dostupan ni serveru (paywall), pa je rezime
// sinteza onoga što se iz naslova i opisa može pouzdano zaključiti. Za
// tržište se uz vesti šalju i stvarne dnevne/nedeljne promene cena sa
// /trziste, da signali budu vezani za brojeve, ne samo za naslove.
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

export interface NewsDigest {
  headline: string;
  sentiment: "pozitivno" | "negativno" | "mešovito" | "neutralno";
  signals: { tone: SignalTone; title: string; detail: string }[];
  summary: string[];
  watch: string[];
}

export interface DigestSource {
  title: string;
  link: string;
  source: string;
  isoDate: string;
}

export type DigestResult =
  | { status: "ok"; digest: NewsDigest; generatedAt: string; sources: DigestSource[]; model: string }
  | { status: "unavailable"; reason: string };

const MODEL = "claude-opus-5-5";
const CACHE_SECONDS = 2 * 60 * 60;
const MAX_ITEMS = 60;
const MAX_DESCRIPTION_CHARS = 280;

const DIGEST_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["headline", "sentiment", "signals", "summary", "watch"],
  properties: {
    headline: { type: "string", description: "Jedna rečenica: najvažnija poruka perioda." },
    sentiment: { type: "string", enum: ["pozitivno", "negativno", "mešovito", "neutralno"] },
    signals: {
      type: "array",
      description: "3-6 najvažnijih signala, najvažniji prvi.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["tone", "title", "detail"],
        properties: {
          tone: { type: "string", enum: ["pozitivno", "negativno", "neutralno"] },
          title: { type: "string", description: "Kratak naslov signala, do 8 reči." },
          detail: { type: "string", description: "1-2 rečenice: šta se desilo i zašto je važno." },
        },
      },
    },
    summary: {
      type: "array",
      description: "2-4 kratka pasusa sinteze, svaki 2-4 rečenice.",
      items: { type: "string" },
    },
    watch: {
      type: "array",
      description: "2-4 stvari koje treba pratiti narednih dana.",
      items: { type: "string" },
    },
  },
} as const;

const SYSTEM_PROMPT = `Ti si finansijski analitičar koji piše kratak, pregledan rezime vesti za privatnog investitora koji živi u Norveškoj i ulaže dugoročno. Pišeš na srpskom jeziku, latinicom, jasno i bez žargona; stručni termin objasni u pola rečenice kad se prvi put pojavi.

Dobijaš listu naslova i kratkih opisa vesti (ceo tekst članaka nije dostupan), a za tržište i stvarne promene cena. Pravila:
- Oslanjaj se isključivo na dostavljene vesti i brojeve. Ne dodaji činjenice, brojeve, datume ni citate kojih nema u ulazu. Brojeve o cenama uzimaj samo iz dela sa tržišnim podacima.
- Sintetizuj: spoji više vesti o istoj temi u jednu misao, umesto da prepričavaš naslov po naslov. Izdvoji ono što zaista utiče na cenu ili dugoročnu vrednost (rezultati, smernice menadžmenta, regulativa, kamate, potražnja, konkurencija), a preskoči šum i ponavljanja.
- Kad se vesti razilaze ili su nepotvrđene (glasine, "prema izvorima"), reci to.
- Ne daj preporuke za kupovinu ili prodaju; opisuj signale i šta znače.
- Budi sažet: ukupno oko 250-400 reči.`;

function formatItems(items: FeedItem[]): string {
  return items
    .slice(0, MAX_ITEMS)
    .map((item) => {
      const date = item.isoDate.slice(0, 10);
      const desc = item.description && item.description !== item.title ? ` — ${item.description.slice(0, MAX_DESCRIPTION_CHARS)}` : "";
      return `- [${date}] (${item.source}) ${item.title}${desc}`;
    })
    .join("\n");
}

function toSources(items: FeedItem[]): DigestSource[] {
  return items.slice(0, MAX_ITEMS).map((i) => ({ title: i.title, link: i.link, source: i.source, isoDate: i.isoDate }));
}

function weekOld(items: FeedItem[]): FeedItem[] {
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  return items.filter((i) => new Date(i.isoDate).getTime() >= weekAgo);
}

async function callClaude(userContent: string): Promise<NewsDigest> {
  const client = new Anthropic();
  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    // Sažimanje vesti ne traži duboko razmišljanje — "low" drži trošak i
    // vreme odziva niskim (podrazumevano je "medium" na ovom modelu).
    output_config: { effort: "low", format: { type: "json_schema", schema: DIGEST_SCHEMA } },
    // Ako sigurnosni filter odbije zahtev, API ga sam ponovi na rezervnom
    // modelu u istom pozivu, umesto da rezime izostane.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userContent }],
  });

  if (response.stop_reason === "refusal") throw new Error("Model je odbio zahtev");
  if (response.stop_reason === "max_tokens") throw new Error("Rezime je prekinut (max_tokens)");
  const text = response.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  return JSON.parse(text) as NewsDigest;
}

function fmtPct(x: number | null): string {
  return x == null ? "n/a" : `${x >= 0 ? "+" : ""}${(x * 100).toFixed(2)}%`;
}

async function buildMarketDigest(): Promise<Extract<DigestResult, { status: "ok" }>> {
  const queries = [
    { query: "stock market today", label: "Svetska tržišta" },
    { query: "Wall Street stocks", label: "SAD" },
    { query: "Oslo Børs", label: "Oslo Børs" },
    { query: "Stockholmsbörsen", label: "Stokholm" },
    { query: "Federal Reserve interest rates", label: "Kamate" },
    { query: "Norges Bank krone", label: "Norges Bank / NOK" },
    { query: "oil price Brent", label: "Nafta" },
    { query: "gold price", label: "Zlato" },
    { query: "Asian markets Nikkei Shanghai", label: "Azija" },
  ];
  const [feeds, quotes] = await Promise.all([
    Promise.all(queries.map((q) => fetchGoogleNewsFeed(q.query, q.label, q.label).catch(() => [] as FeedItem[]))),
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
        if (inst.kind === "yield") {
          const bp = (v: number | null) => (v == null ? "n/a" : `${v >= 0 ? "+" : ""}${Math.round(v * 100)} b.p.`);
          return `${inst.name}: ${q.price.toFixed(2)}% (dan ${bp(q.dayChange)}, nedelja ${bp(q.weekChange)})`;
        }
        return `${inst.name}: ${q.price.toFixed(inst.kind === "fx" ? 4 : 2)} (dan ${fmtPct(q.dayChangePercent)}, nedelja ${fmtPct(q.weekChangePercent)})`;
      })
      .filter(Boolean);
    return rows.length ? `${g.title}:\n${rows.join("\n")}` : null;
  })
    .filter(Boolean)
    .join("\n\n");

  const user = `Napiši rezime najvažnijih signala i vesti na tržištu za danas i ovu nedelju.

TRŽIŠNI PODACI (stvarne cene, promena za dan i za 5 trgovačkih dana):
${marketLines || "nisu dostupni"}

VESTI (poslednjih 7 dana, najnovije prve; u zagradi izvor):
${formatItems(items)}`;

  const digest = await callClaude(user);
  return { status: "ok", digest, generatedAt: new Date().toISOString(), sources: toSources(items), model: MODEL };
}

async function buildCompanyDigest(ticker: string | null): Promise<Extract<DigestResult, { status: "ok" }>> {
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
${formatItems(ticker ? items : items.map((i) => ({ ...i, title: `${i.companyName}: ${i.title}` })))}`;

  const digest = await callClaude(user);
  return { status: "ok", digest, generatedAt: new Date().toISOString(), sources: toSources(items), model: MODEL };
}

const cachedMarketDigest = unstable_cache(buildMarketDigest, ["news-digest", "market", "v1"], { revalidate: CACHE_SECONDS });
const cachedCompanyDigest = unstable_cache(buildCompanyDigest, ["news-digest", "company", "v1"], { revalidate: CACHE_SECONDS });

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
