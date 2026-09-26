"use client";

import { useRef, useState } from "react";
import { SP500_TICKERS } from "@/lib/sp500";
import { DOW30_TICKERS } from "@/lib/dow30";
import { NASDAQ100_TICKERS } from "@/lib/nasdaq100";
import { DAX40_TICKERS } from "@/lib/dax40";
import { CAC40_TICKERS } from "@/lib/cac40";
import { IBEX35_TICKERS } from "@/lib/ibex35";
import { FTSE100_TICKERS } from "@/lib/ftse100";
import { AEX_TICKERS } from "@/lib/aex";
import { OBX_TICKERS } from "@/lib/obx";
import { OMXS30_TICKERS } from "@/lib/omxs30";
import { FTSEMIB_TICKERS } from "@/lib/ftsemib";
import { WIG20_TICKERS } from "@/lib/wig20";
import { SMI_TICKERS } from "@/lib/smi";
import {
  DEFAULT_ASSUMPTIONS,
  compareToBenchmark,
  computeModel,
  computeOverviewScores,
  computeOwnHistoricalAverages,
  extractModelData,
  resolveFcfForYield,
} from "@/lib/buildModel";
import { computeFcfYield } from "@/lib/valuation";
import type { FundamentalsRating } from "@/lib/model";
import { fetchPriceHistory, fetchSpyHistory, fetchStockAnalysisFcf } from "@/lib/clientData";

const CONCURRENCY = 6;
const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12h — "realno vreme" u praksi znači osveženo par puta dnevno, ne svake sekunde

type IndexKey = "sp500" | "dow30" | "nasdaq100" | "dax40" | "cac40" | "ibex35" | "ftse100" | "aex" | "obx" | "omxs30" | "ftsemib" | "wig20" | "smi";

const INDEXES: Record<IndexKey, { label: string; tickers: string[] }> = {
  sp500: { label: "S&P 500", tickers: SP500_TICKERS },
  dow30: { label: "Dow Jones (30)", tickers: DOW30_TICKERS },
  nasdaq100: { label: "Nasdaq-100", tickers: NASDAQ100_TICKERS },
  dax40: { label: "DAX 40 (Frankfurt)", tickers: DAX40_TICKERS },
  cac40: { label: "CAC 40 (Pariz)", tickers: CAC40_TICKERS },
  ibex35: { label: "IBEX 35 (Madrid)", tickers: IBEX35_TICKERS },
  ftse100: { label: "FTSE 100 (London)", tickers: FTSE100_TICKERS },
  aex: { label: "AEX (Amsterdam)", tickers: AEX_TICKERS },
  obx: { label: "OBX (Oslo)", tickers: OBX_TICKERS },
  omxs30: { label: "OMXS30 (Stokholm)", tickers: OMXS30_TICKERS },
  ftsemib: { label: "FTSE MIB (Rim/Milano)", tickers: FTSEMIB_TICKERS },
  wig20: { label: "WIG20 (Varšava)", tickers: WIG20_TICKERS },
  smi: { label: "SMI (Cirih)", tickers: SMI_TICKERS },
};

interface Row {
  ticker: string;
  companyName: string;
  currentPrice: number;
  currency: string;
  verdictLabel: string;
  fundamentalsRating: FundamentalsRating;
  redFlagCount: number;
  vsSpy: Record<number, "outperform" | "underperform" | "na">;
  outperformance5y: number | null; // rast iznad SPY na 5g (ukupan prinos akcije − ukupan prinos SPY), za sortiranje
  sector: string | null;
  marketCap: number | null;
  fcfYield: number | null;
  evToEbitda: number | null;
  compositeScore: number | null; // 1-5, isti kao na /pregled (computeOverviewScores)
  revenueGrowth: number | null; // rast prihoda u poslednjih 12 meseci, ili istorijski CAGR kad TTM nije dostupan — ekspanzija/opadanje
  error?: string;
}

const fmtPct = (x: number | null, digits = 1) => (x == null ? "—" : `${(x * 100).toFixed(digits)}%`);
const fmtRatio = (x: number | null) => (x == null ? "—" : `${x.toFixed(1)}×`);

function compositeColor(x: number | null): string {
  if (x == null) return "text-zinc-400";
  const r = Math.round(x * 10) / 10;
  if (r >= 4) return "text-emerald-600 dark:text-emerald-400";
  if (r >= 3) return "text-amber-600 dark:text-amber-400";
  return "text-red-600 dark:text-red-400";
}

function fmtMarketCap(x: number | null, currency: string): string {
  if (x == null) return "—";
  const abs = Math.abs(x);
  if (abs >= 1e12) return `${(x / 1e12).toFixed(2)}T ${currency}`;
  if (abs >= 1e9) return `${(x / 1e9).toFixed(1)}B ${currency}`;
  if (abs >= 1e6) return `${(x / 1e6).toFixed(0)}M ${currency}`;
  return `${x.toLocaleString("en-US")} ${currency}`;
}

interface SectorGroup {
  sector: string;
  totalMarketCap: number;
  rows: Row[];
}

// Grupiše po sektoru, sortira sektore po ukupnoj tržišnoj kapitalizaciji
// (najveći prvo), a kompanije unutar svakog sektora po sopstvenoj tržišnoj
// kapitalizaciji (najveće prvo).
function groupBySector(rowsIn: Row[]): SectorGroup[] {
  const map = new Map<string, Row[]>();
  for (const r of rowsIn) {
    const key = r.sector || "Nepoznat sektor";
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(r);
  }
  const groups: SectorGroup[] = Array.from(map.entries()).map(([sector, groupRows]) => ({
    sector,
    totalMarketCap: groupRows.reduce((sum, r) => sum + (r.marketCap ?? 0), 0),
    rows: [...groupRows].sort((a, b) => (b.marketCap ?? 0) - (a.marketCap ?? 0)),
  }));
  return groups.sort((a, b) => b.totalMarketCap - a.totalMarketCap);
}

const BENCHMARK_HORIZONS = [3, 5, 10, 20];

const VERDICT_ORDER: Record<string, number> = {
  "Kupovina": 0,
  "Čekaj — preskupo": 1,
  "Držanje": 2,
  "Izbegavanje": 3,
  "Nedovoljno podataka": 4,
  "—": 5,
};

const fmtMoney = (x: number, currency: string) => `${x.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${currency}`;

async function fetchAndScore(ticker: string, nowSeconds: number): Promise<Row> {
  const res = await fetch(`/api/stock?symbol=${encodeURIComponent(ticker)}&type=valuation&full=1`, { cache: "no-store" });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);

  const modelData = extractModelData(data, ticker);
  const computed = computeModel(modelData, DEFAULT_ASSUMPTIONS);

  const [priceHistory, spyHistory] = await Promise.all([fetchPriceHistory(ticker), fetchSpyHistory()]);
  const benchmark = compareToBenchmark(priceHistory, spyHistory, nowSeconds, BENCHMARK_HORIZONS);
  const vsSpy: Row["vsSpy"] = {};
  for (const row of benchmark) {
    vsSpy[row.years] = row.verdict === "Nadmašuje SPY" ? "outperform" : row.verdict === "Ispod SPY" ? "underperform" : "na";
  }
  const outperformance5y = benchmark.find((row) => row.years === 5)?.outperformance ?? null;

  // Kad Yahoo nema FCF ni za TTM ni za poslednju godinu, proba se
  // stockanalysis.com kao poslednja rezerva (samo za američke tikere).
  const yahooFcf = resolveFcfForYield(modelData);
  const fallbackFcf = yahooFcf == null ? await fetchStockAnalysisFcf(ticker) : null;
  const fcf = yahooFcf ?? fallbackFcf;
  const compositeScore = computeOverviewScores(computed, computeOwnHistoricalAverages(computed, priceHistory), fallbackFcf).scores.composite;
  const revenueGrowth = modelData.revenueGrowthTtm ?? computed.breakdown.revenueCagr;

  return {
    ticker,
    companyName: modelData.companyName,
    currentPrice: modelData.currentPrice,
    currency: modelData.currency,
    verdictLabel: computed.finalVerdict.verdict,
    fundamentalsRating: computed.fundamentalsRating.rating,
    redFlagCount: computed.redFlags.length,
    vsSpy,
    outperformance5y,
    sector: modelData.sector,
    marketCap: modelData.marketCap,
    fcfYield: computeFcfYield(fcf, modelData.marketCap),
    evToEbitda: modelData.evToEbitda,
    compositeScore,
    revenueGrowth,
  };
}

export default function Sp500Screener() {
  const [indexKey, setIndexKey] = useState<IndexKey>("sp500");
  const [rows, setRows] = useState<Row[]>([]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<"verdict" | "composite" | "outperformance" | "growth" | "ticker" | "sector">("verdict");
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const stopRef = useRef(false);

  // v10: dodat revenueGrowth — stariji keš nema to polje, pa se verzija menja da se osveži.
  const cacheKeyFor = (idx: IndexKey) => `nemvida_screener_v10_${idx}`;

  function loadFromCache(idx: IndexKey): boolean {
    try {
      const raw = localStorage.getItem(cacheKeyFor(idx));
      if (!raw) return false;
      const parsed = JSON.parse(raw);
      // eslint-disable-next-line react-hooks/purity -- poziva se iz event handlera, ne iz render-a
      if (!parsed.timestamp || Date.now() - parsed.timestamp > CACHE_TTL_MS) return false;
      setRows(parsed.rows);
      setLastUpdated(parsed.timestamp);
      return true;
    } catch {
      return false;
    }
  }

  function saveToCache(idx: IndexKey, finalRows: Row[]) {
    try {
      // eslint-disable-next-line react-hooks/purity -- poziva se iz event handlera, ne iz render-a
      const timestamp = Date.now();
      localStorage.setItem(cacheKeyFor(idx), JSON.stringify({ rows: finalRows, timestamp }));
      setLastUpdated(timestamp);
    } catch {
      /* nije kritično ako localStorage nije dostupan */
    }
  }

  function switchIndex(idx: IndexKey) {
    setIndexKey(idx);
    setRows([]);
    setLastUpdated(null);
    setProgress(0);
    loadFromCache(idx);
  }

  async function runScreener(force: boolean) {
    if (!force && loadFromCache(indexKey)) return;

    setRunning(true);
    stopRef.current = false;
    setRows([]);
    setProgress(0);
    const results: Row[] = [];
    const tickers = INDEXES[indexKey].tickers;
    // eslint-disable-next-line react-hooks/purity -- poziva se iz event handlera, ne iz render-a
    const nowSeconds = Math.floor(Date.now() / 1000);

    for (let i = 0; i < tickers.length; i += CONCURRENCY) {
      if (stopRef.current) break;
      const batch = tickers.slice(i, i + CONCURRENCY);
      const settled = await Promise.allSettled(batch.map((t) => fetchAndScore(t, nowSeconds)));
      settled.forEach((s, idx) => {
        if (s.status === "fulfilled") {
          results.push(s.value);
        } else {
          results.push({
            ticker: batch[idx],
            companyName: batch[idx],
            currentPrice: 0,
            currency: "",
            verdictLabel: "—",
            fundamentalsRating: "Nedovoljno podataka",
            redFlagCount: 0,
            vsSpy: {},
            outperformance5y: null,
            sector: null,
            marketCap: null,
            fcfYield: null,
            evToEbitda: null,
            compositeScore: null,
            revenueGrowth: null,
            error: s.reason instanceof Error ? s.reason.message : "Greška",
          });
        }
      });
      setRows([...results]);
      setProgress(Math.min(100, Math.round(((i + batch.length) / tickers.length) * 100)));
    }

    setRunning(false);
    if (!stopRef.current) saveToCache(indexKey, results);
  }

  function stopScreener() {
    stopRef.current = true;
    setRunning(false);
  }

  const filteredRows = rows
    .filter((r) => !r.error)
    .filter((r) => !search || r.ticker.includes(search.toUpperCase()) || r.companyName.toUpperCase().includes(search.toUpperCase()))
    .sort((a, b) => {
      if (sortKey === "ticker") return a.ticker.localeCompare(b.ticker);
      if (sortKey === "composite") return (b.compositeScore ?? -1) - (a.compositeScore ?? -1);
      if (sortKey === "outperformance") return (b.outperformance5y ?? -Infinity) - (a.outperformance5y ?? -Infinity);
      if (sortKey === "growth") return (b.revenueGrowth ?? -Infinity) - (a.revenueGrowth ?? -Infinity);
      if (sortKey === "sector") return (b.marketCap ?? 0) - (a.marketCap ?? 0);
      return (VERDICT_ORDER[a.verdictLabel] ?? 5) - (VERDICT_ORDER[b.verdictLabel] ?? 5);
    });

  const sectorGroups = sortKey === "sector" ? groupBySector(filteredRows) : null;

  const failedCount = rows.filter((r) => r.error).length;

  return (
    <div className="max-w-5xl mx-auto px-4 pb-16">
      <div className="mt-4 mb-5 text-sm leading-relaxed rounded-xl border border-amber-300/60 dark:border-amber-700/50 bg-amber-50 dark:bg-amber-900/15 text-amber-800 dark:text-amber-300 p-4">
        <b>⚠ Ovo NIJE finansijski savet.</b> Sud je izveden iz istog sveobuhvatnog modela (rast poslovanja + disciplina
        valuacije) sa podrazumevanim pretpostavkama (nisu ručno prilagođene po kompaniji) — za detaljniju analizu
        pojedinačne akcije koristi{" "}
        <a href="/pregled" className="underline">pregled kompanije</a>. Liste tikera po indeksima su
        snimci iz opšteg znanja i mogu odstupati od trenutnog zvaničnog sastava (kompozicije se povremeno menjaju).
        &quot;Osveženo&quot; znači vreme poslednjeg preuzimanja podataka (keširano lokalno do 12h), ne doslovno live
        tik-po-tik cena. &quot;Fundamenti&quot; je objektivna ocena poslovanja (rast, marže, zaduženost, konkurentska
        prednost) — odvojeno od cene akcije. 🚩 je broj konkretnih upozoravajućih signala (npr. negativan novčani tok,
        preterana zaduženost). &quot;vs SPY&quot; poredi ukupan prinos akcije sa SPY (S&P 500) na 3/5/10/20 godina —
        &quot;—&quot; znači da istorija cene ne seže dovoljno unazad. Sortiranje &quot;rast iznad SPY&quot; koristi razliku
        ukupnog prinosa na 5 godina (akcija minus SPY) — kompanije bez dovoljno istorije cene (npr. nedavni IPO) idu na
        dno liste. Sortiranje &quot;po sektoru&quot; grupiše kompanije po
        sektoru (Yahoo Finance klasifikacija), sektore ređa po ukupnoj tržišnoj kapitalizaciji (najveći prvo), a
        kompanije unutar sektora po sopstvenoj tržišnoj kapitalizaciji (najveće prvo). &quot;FCF prinos&quot; je slobodan
        novčani tok podeljen trenutnom tržišnom kapitalizacijom — što je veći, to kompanija generiše više gotovine u
        odnosu na cenu; negativan (crveno) znači da kompanija trenutno troši više gotovine nego što generiše. Kad
        Yahoo Finance nema taj podatak (čest slučaj za neke tikere), za američke akcije se kao rezerva proba
        stockanalysis.com. &quot;EV/EBITDA&quot; poredi vrednost kompanije (tržišna kapitalizacija + dug − gotovina) sa
        operativnom zaradom — niže obično znači jeftinije, ali zavisi od sektora (kapitalno intenzivne delatnosti
        imaju prirodno niže multiple). &quot;Kompozitni skor&quot; (1-5) je isti prosečni skor kao u zaglavlju
        pregleda kompanije, računat istom funkcijom — zeleno ≥4, žuto 3-4, crveno ispod 3. &quot;Rast prihoda&quot; je
        rast prihoda u poslednjih 12 meseci (ili istorijski CAGR kad TTM podatak nije dostupan) — zeleno znači
        ekspanzija (prihod raste), crveno opadanje (prihod pada g/g), koristi se i za sortiranje &quot;ekspanzija
        prvo&quot;.
      </div>

      <div className="border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/50 rounded-xl p-4 mb-4 flex flex-wrap gap-3 items-center">
        <div className="flex flex-wrap gap-1 rounded-lg border border-zinc-300 dark:border-zinc-700 p-1">
          {(Object.keys(INDEXES) as IndexKey[]).map((k) => (
            <button
              key={k}
              onClick={() => !running && switchIndex(k)}
              disabled={running}
              className={`px-3 py-1.5 rounded-md text-sm font-medium ${
                indexKey === k ? "bg-blue-600 text-white" : "text-zinc-600 dark:text-zinc-400"
              }`}
            >
              {INDEXES[k].label}
            </button>
          ))}
        </div>
        {!running ? (
          <button onClick={() => runScreener(false)} className="bg-blue-600 text-white font-semibold px-5 py-2 rounded-lg text-sm">
            {rows.length ? "Osveži analizu" : "Pokreni analizu"}
          </button>
        ) : (
          <button onClick={stopScreener} className="bg-red-600 text-white font-semibold px-5 py-2 rounded-lg text-sm">
            Zaustavi ({progress}%)
          </button>
        )}
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Pretraži ticker ili ime..."
          className="flex-1 min-w-[160px] px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-transparent text-sm"
        />
        <select
          value={sortKey}
          onChange={(e) => setSortKey(e.target.value as "verdict" | "composite" | "outperformance" | "growth" | "ticker" | "sector")}
          className="px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-transparent text-sm"
        >
          <option value="verdict">Sortiraj: kupovina prvo</option>
          <option value="composite">Sortiraj: kompozitni skor (najviši prvo)</option>
          <option value="outperformance">Sortiraj: rast iznad SPY (5g, najveći prvo)</option>
          <option value="growth">Sortiraj: rast prihoda (ekspanzija prvo, opadanje na dnu)</option>
          <option value="ticker">Sortiraj: abecedno</option>
          <option value="sector">Sortiraj: po sektoru (tržišna kap.)</option>
        </select>
        {lastUpdated && (
          <span className="text-xs text-zinc-500 dark:text-zinc-400">
            Osveženo: {new Date(lastUpdated).toLocaleString("sr-RS")}
          </span>
        )}
      </div>

      {running && (
        <div className="mb-4 h-2 rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden">
          <div className="h-full bg-blue-600 transition-all" style={{ width: `${progress}%` }} />
        </div>
      )}

      {failedCount > 0 && !running && (
        <div className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">{failedCount} tikera nije uspelo da se učita (preskočeno).</div>
      )}

      {filteredRows.length > 0 && sectorGroups && (
        <div className="space-y-4">
          {sectorGroups.map((g) => (
            <div key={g.sector} className="border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/50 rounded-xl overflow-hidden">
              <div className="px-3 py-2 bg-zinc-100 dark:bg-zinc-800/60 flex justify-between items-baseline">
                <h3 className="text-sm font-semibold">{g.sector}</h3>
                <span className="text-xs text-zinc-500 dark:text-zinc-400">{g.rows.length} kompanija · ukupna tržišna kap. {fmtMarketCap(g.totalMarketCap, g.rows[0]?.currency || "")}</span>
              </div>
              <div className="overflow-x-auto">
                <ScreenerTable rows={g.rows} />
              </div>
            </div>
          ))}
        </div>
      )}

      {filteredRows.length > 0 && !sectorGroups && (
        <div className="border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/50 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <ScreenerTable rows={filteredRows} />
          </div>
        </div>
      )}

      {!running && !rows.length && (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Klikni &quot;Pokreni analizu&quot; — obrađuje se {INDEXES[indexKey].tickers.length} kompanija u grupama, traje otprilike
          2-4 minuta (uključuje i istoriju cene za poređenje sa SPY). Rezultat se pamti lokalno 12 sati, tako da sledeći put učitavanje bude trenutno.
        </p>
      )}
    </div>
  );
}

function ScreenerTable({ rows }: { rows: Row[] }) {
  return (
    <table className="w-full text-sm border-collapse">
      <thead>
        <tr>
          <th className="text-left text-xs uppercase text-zinc-500 dark:text-zinc-400 py-2 px-3 border-b border-zinc-200 dark:border-zinc-800">Ticker</th>
          <th className="text-left text-xs uppercase text-zinc-500 dark:text-zinc-400 py-2 px-3 border-b border-zinc-200 dark:border-zinc-800">Kompanija</th>
          <th className="text-right text-xs uppercase text-zinc-500 dark:text-zinc-400 py-2 px-3 border-b border-zinc-200 dark:border-zinc-800">Cena</th>
          <th className="text-right text-xs uppercase text-zinc-500 dark:text-zinc-400 py-2 px-3 border-b border-zinc-200 dark:border-zinc-800">Tržišna kap.</th>
          <th className="text-right text-xs uppercase text-zinc-500 dark:text-zinc-400 py-2 px-3 border-b border-zinc-200 dark:border-zinc-800">FCF prinos</th>
          <th className="text-right text-xs uppercase text-zinc-500 dark:text-zinc-400 py-2 px-3 border-b border-zinc-200 dark:border-zinc-800">EV/EBITDA</th>
          <th className="text-right text-xs uppercase text-zinc-500 dark:text-zinc-400 py-2 px-3 border-b border-zinc-200 dark:border-zinc-800">Kompozitni skor</th>
          <th className="text-right text-xs uppercase text-zinc-500 dark:text-zinc-400 py-2 px-3 border-b border-zinc-200 dark:border-zinc-800">Rast prihoda</th>
          <th className="text-left text-xs uppercase text-zinc-500 dark:text-zinc-400 py-2 px-3 border-b border-zinc-200 dark:border-zinc-800">Sud</th>
          <th className="text-left text-xs uppercase text-zinc-500 dark:text-zinc-400 py-2 px-3 border-b border-zinc-200 dark:border-zinc-800">Fundamenti</th>
          <th className="text-center text-xs uppercase text-zinc-500 dark:text-zinc-400 py-2 px-3 border-b border-zinc-200 dark:border-zinc-800">🚩</th>
          {BENCHMARK_HORIZONS.map((y) => (
            <th key={y} className="text-center text-xs uppercase text-zinc-500 dark:text-zinc-400 py-2 px-3 border-b border-zinc-200 dark:border-zinc-800">vs SPY {y}g</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.ticker}>
            <td className="py-2 px-3 border-b border-zinc-200 dark:border-zinc-800 font-semibold">
              <a href={`/pregled?ticker=${r.ticker}`} className="hover:underline">{r.ticker}</a>
            </td>
            <td className="py-2 px-3 border-b border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400">{r.companyName}</td>
            <td className="py-2 px-3 border-b border-zinc-200 dark:border-zinc-800 text-right tabular-nums">{fmtMoney(r.currentPrice, r.currency)}</td>
            <td className="py-2 px-3 border-b border-zinc-200 dark:border-zinc-800 text-right tabular-nums">{fmtMarketCap(r.marketCap, r.currency)}</td>
            <td
              className={`py-2 px-3 border-b border-zinc-200 dark:border-zinc-800 text-right tabular-nums ${
                r.fcfYield != null && r.fcfYield < 0 ? "text-red-600 dark:text-red-400" : ""
              }`}
            >
              {fmtPct(r.fcfYield)}
            </td>
            <td
              className={`py-2 px-3 border-b border-zinc-200 dark:border-zinc-800 text-right tabular-nums ${
                r.evToEbitda != null && r.evToEbitda > 30 ? "text-red-600 dark:text-red-400" : ""
              }`}
            >
              {fmtRatio(r.evToEbitda)}
            </td>
            <td className={`py-2 px-3 border-b border-zinc-200 dark:border-zinc-800 text-right tabular-nums font-semibold ${compositeColor(r.compositeScore)}`}>
              {r.compositeScore != null ? `${r.compositeScore.toFixed(1)}/5` : "—"}
            </td>
            <td
              className={`py-2 px-3 border-b border-zinc-200 dark:border-zinc-800 text-xs font-medium ${
                r.verdictLabel === "Kupovina"
                  ? "text-emerald-600 dark:text-emerald-400"
                  : r.verdictLabel === "Izbegavanje"
                    ? "text-red-600 dark:text-red-400"
                    : r.verdictLabel === "Čekaj — preskupo"
                      ? "text-amber-600 dark:text-amber-400"
                      : "text-zinc-600 dark:text-zinc-400"
              }`}
            >
              {r.verdictLabel}
            </td>
            <td
              className={`py-2 px-3 border-b border-zinc-200 dark:border-zinc-800 text-xs font-medium ${
                r.fundamentalsRating === "Jaki"
                  ? "text-emerald-600 dark:text-emerald-400"
                  : r.fundamentalsRating === "Slabi"
                    ? "text-red-600 dark:text-red-400"
                    : "text-zinc-600 dark:text-zinc-400"
              }`}
            >
              {r.fundamentalsRating}
            </td>
            <td className="py-2 px-3 border-b border-zinc-200 dark:border-zinc-800 text-center">
              {r.redFlagCount > 0 ? <span className="text-red-600 dark:text-red-400 font-semibold">{r.redFlagCount}</span> : <span className="text-zinc-400">0</span>}
            </td>
            <td
              className={`py-2 px-3 border-b border-zinc-200 dark:border-zinc-800 text-right tabular-nums font-medium ${
                r.revenueGrowth == null ? "text-zinc-400" : r.revenueGrowth > 0 ? "text-emerald-600 dark:text-emerald-400" : r.revenueGrowth < 0 ? "text-red-600 dark:text-red-400" : "text-zinc-600 dark:text-zinc-400"
              }`}
            >
              {fmtPct(r.revenueGrowth)}
            </td>
            {BENCHMARK_HORIZONS.map((y) => (
              <td key={y} className="py-2 px-3 border-b border-zinc-200 dark:border-zinc-800 text-center">
                {r.vsSpy[y] === "outperform" ? (
                  <span className="text-emerald-600 dark:text-emerald-400 font-bold">▲</span>
                ) : r.vsSpy[y] === "underperform" ? (
                  <span className="text-red-600 dark:text-red-400 font-bold">▼</span>
                ) : (
                  <span className="text-zinc-400">—</span>
                )}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
