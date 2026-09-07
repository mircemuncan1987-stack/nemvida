"use client";

import { useState } from "react";
import {
  DAY_NAMES,
  MONTH_NAMES,
  SECTOR_ETF,
  dailyReturns,
  dayOfWeek,
  fomcCorrelation,
  parseChartRows,
  seasonality,
  totalReturn,
  volatilityGapEvents,
  type DayStat,
  type FomcStat,
  type GapStat,
  type MonthStat,
  type PriceRow,
} from "@/lib/patternFinder";

type Range = "2y" | "5y" | "10y" | "max";

async function fetchStock(symbol: string, type: "chart" | "quoteSummary" | "options", range?: string) {
  const params = new URLSearchParams({ symbol, type });
  if (range) params.set("range", range);
  const res = await fetch(`/api/stock?${params.toString()}`, { cache: "no-store" });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data;
}

const fmtPct = (x: number | null | undefined, digits = 2) =>
  x === null || x === undefined || Number.isNaN(x) ? "—" : `${x >= 0 ? "+" : ""}${(x * 100).toFixed(digits)}%`;

const pctClass = (x: number | null | undefined) =>
  x === null || x === undefined || Number.isNaN(x) ? "" : x >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400";

const fmtNum = (x: number | null | undefined) =>
  x === null || x === undefined || Number.isNaN(x) ? "—" : Number(x).toLocaleString("en-US");

function Section({ title, ok, children }: { title: string; ok: boolean; children: React.ReactNode }) {
  return (
    <div className="border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/50 backdrop-blur rounded-xl p-5 mb-4">
      <h3 className="text-sm font-semibold flex items-center gap-2 pb-2 mb-3 border-b border-zinc-200 dark:border-zinc-800">
        {title}
        <span
          className={`ml-auto text-[0.65rem] px-2 py-0.5 rounded-full font-semibold ${
            ok
              ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
              : "bg-zinc-500/15 text-zinc-600 dark:text-zinc-400"
          }`}
        >
          {ok ? "PODACI UČITANI" : "OGRANIČENO/NEDOSTUPNO"}
        </span>
      </h3>
      {children}
    </div>
  );
}

function Table({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">{children}</table>
    </div>
  );
}

const th = "text-left text-xs uppercase text-zinc-500 dark:text-zinc-400 font-semibold py-1.5 px-2 border-b border-zinc-200 dark:border-zinc-800";
const td = "py-1.5 px-2 border-b border-zinc-200 dark:border-zinc-800";
const tdNum = `${td} text-right tabular-nums`;

function Na({ children }: { children: React.ReactNode }) {
  return <p className="text-sm italic text-zinc-500 dark:text-zinc-400">{children}</p>;
}

interface Memo {
  ticker: string;
  companyName: string;
  currency: string;
  lastClose: number;
  firstDate: string;
  lastDate: string;
  rows: PriceRow[];
  season: MonthStat[];
  dow: DayStat[];
  fomc: FomcStat;
  gaps: GapStat;
  qs: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  opt: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  sector: { name: string | null; ok: boolean; etf?: string; stockRet?: number | null; etfRet?: number | null; spyRet?: number | null };
}

export default function PatternFinder() {
  const [ticker, setTicker] = useState("");
  const [range, setRange] = useState<Range>("5y");
  const [loading, setLoading] = useState(false);
  const [status, setStatusMsg] = useState("");
  const [error, setError] = useState("");
  const [memo, setMemo] = useState<Memo | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const sym = ticker.trim().toUpperCase();
    if (!sym) return;
    setLoading(true);
    setError("");
    setMemo(null);
    try {
      setStatusMsg(`Preuzimam istoriju cena za ${sym}...`);
      const chartData = await fetchStock(sym, "chart", range);
      const result = chartData?.chart?.result?.[0];
      if (!result || !result.timestamp) throw new Error("Nema podataka o ceni za ovaj tiker.");
      const rows = parseChartRows(result);
      if (rows.length < 20) throw new Error("Nedovoljno istorijskih podataka za analizu ovog tikera.");
      const rets = dailyReturns(rows);

      const season = seasonality(rows);
      const dow = dayOfWeek(rets);
      const fomc = fomcCorrelation(rets);
      const gaps = volatilityGapEvents(rows);

      setStatusMsg("Preuzimam podatke o insajderima, institucijama i short interest-u...");
      let qs: any = null; // eslint-disable-line @typescript-eslint/no-explicit-any
      try {
        const qsData = await fetchStock(sym, "quoteSummary");
        qs = qsData?.quoteSummary?.result?.[0] || null;
      } catch {
        qs = null;
      }

      setStatusMsg("Preuzimam podatke o opcijama...");
      let opt: any = null; // eslint-disable-line @typescript-eslint/no-explicit-any
      try {
        const optData = await fetchStock(sym, "options");
        opt = optData?.optionChain?.result?.[0] || null;
      } catch {
        opt = null;
      }

      setStatusMsg("Poredim sa sektorom i tržištem...");
      const sectorName: string | null = qs?.assetProfile?.sector || null;
      let sector: Memo["sector"] = { name: sectorName, ok: false };
      if (sectorName && SECTOR_ETF[sectorName]) {
        try {
          const etf = SECTOR_ETF[sectorName];
          const [etfData, spyData] = await Promise.all([fetchStock(etf, "chart", range), fetchStock("SPY", "chart", range)]);
          const etfRows = parseChartRows(etfData.chart.result[0]);
          const spyRows = parseChartRows(spyData.chart.result[0]);
          sector = {
            name: sectorName,
            ok: true,
            etf,
            stockRet: totalReturn(rows),
            etfRet: totalReturn(etfRows),
            spyRet: totalReturn(spyRows),
          };
        } catch {
          sector = { name: sectorName, ok: false };
        }
      }

      const lastRow = rows[rows.length - 1];
      setMemo({
        ticker: sym,
        companyName: result.meta?.longName || result.meta?.shortName || sym,
        currency: result.meta?.currency || "",
        lastClose: lastRow.close,
        firstDate: rows[0].date.toISOString().slice(0, 10),
        lastDate: lastRow.date.toISOString().slice(0, 10),
        rows,
        season,
        dow,
        fomc,
        gaps,
        qs,
        opt,
        sector,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nije moguće preuzeti podatke.");
    } finally {
      setLoading(false);
      setStatusMsg("");
    }
  }

  return (
    <div className="max-w-4xl mx-auto px-4 pb-16">
      <div className="mt-4 mb-5 text-sm leading-relaxed rounded-xl border border-amber-300/60 dark:border-amber-700/50 bg-amber-50 dark:bg-amber-900/15 text-amber-800 dark:text-amber-300 p-4">
        <b>⚠ Ovo NIJE finansijski savet.</b> Alat prikazuje isključivo opisnu (deskriptivnu) statistiku
        istorijskih cena i javno dostupnih podataka — istorijski obrasci ne garantuju buduće rezultate.
        Insajdersko trgovanje, institucionalno vlasništvo, short interest i opcije zavise od dostupnosti
        besplatnih Yahoo Finance podataka i mogu ponekad biti nedostupni. Uvek proveri podatke iz više
        izvora i donesi sopstvenu odluku, ili se posavetuj sa licenciranim finansijskim savetnikom.
      </div>

      <form onSubmit={handleSubmit} className="flex flex-wrap gap-2 items-center border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/50 rounded-xl p-4">
        <input
          type="text"
          value={ticker}
          onChange={(e) => setTicker(e.target.value)}
          placeholder="Unesi ticker, npr. AAPL, NVDA, TSLA..."
          className="flex-1 min-w-[160px] uppercase px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-transparent"
          required
        />
        <select
          value={range}
          onChange={(e) => setRange(e.target.value as Range)}
          className="px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-transparent text-sm"
        >
          <option value="2y">2 godine</option>
          <option value="5y">5 godina</option>
          <option value="10y">10 godina</option>
          <option value="max">Maksimalno</option>
        </select>
        <button
          type="submit"
          disabled={loading}
          className="bg-blue-600 disabled:opacity-60 text-white font-semibold px-5 py-2 rounded-lg text-sm"
        >
          Analiziraj
        </button>
        <div className="w-full text-xs text-zinc-500 dark:text-zinc-400">
          Radi sa svim tikerima dostupnim na Yahoo Finance (akcije, ETF-ovi, sve berze).
        </div>
      </form>

      {status && (
        <div className="mt-3 text-sm text-zinc-500 dark:text-zinc-400 flex items-center gap-2">
          <span className="inline-block w-3.5 h-3.5 rounded-full border-2 border-zinc-300 dark:border-zinc-700 border-t-blue-600 animate-spin" />
          {status}
        </div>
      )}
      {error && <div className="mt-3 text-sm text-red-600 dark:text-red-400">Greška: {error}</div>}

      {memo && (
        <div className="mt-6">
          <div className="border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/50 rounded-xl p-5 mb-4">
            <div className="flex flex-wrap items-baseline gap-2 justify-between">
              <h2 className="text-xl font-bold">
                {memo.companyName} ({memo.ticker})
              </h2>
              <div className="text-lg font-bold">
                {fmtNum(memo.lastClose)} {memo.currency}
              </div>
              <div className="w-full text-xs text-zinc-500 dark:text-zinc-400">
                Kvantitativni istraživački memorandum • Period: {memo.firstDate} — {memo.lastDate} • Generisano:{" "}
                {new Date().toLocaleString("sr-RS")}
              </div>
            </div>
          </div>

          <SeasonalitySection data={memo.season} />
          <DayOfWeekSection data={memo.dow} />
          <FomcSection f={memo.fomc} />
          <InsidersSection qs={memo.qs} />
          <InstitutionsSection qs={memo.qs} />
          <ShortInterestSection qs={memo.qs} />
          <OptionsSection opt={memo.opt} />
          <GapSection g={memo.gaps} />
          <SectorSection sector={memo.sector} />
          <EdgeSummarySection memo={memo} />
        </div>
      )}
    </div>
  );
}

function SeasonalitySection({ data }: { data: MonthStat[] }) {
  return (
    <Section title="1–3. Sezonski obrasci (najbolji/najgori meseci)" ok={true}>
      <Table>
        <thead>
          <tr>
            <th className={th}>Mesec</th>
            <th className={`${th} text-right`}>Prosečan prinos</th>
            <th className={`${th} text-right`}>% pozitivnih godina</th>
            <th className={`${th} text-right`}>N (godina)</th>
          </tr>
        </thead>
        <tbody>
          {data.map((m) => (
            <tr key={m.month}>
              <td className={td}>{MONTH_NAMES[m.month]}</td>
              <td className={`${tdNum} ${pctClass(m.avg)}`}>{fmtPct(m.avg)}</td>
              <td className={tdNum}>{m.winRate === null ? "—" : `${(m.winRate * 100).toFixed(0)}%`}</td>
              <td className={tdNum}>{m.n}</td>
            </tr>
          ))}
        </tbody>
      </Table>
    </Section>
  );
}

function DayOfWeekSection({ data }: { data: DayStat[] }) {
  return (
    <Section title="4. Obrasci po danima u nedelji" ok={true}>
      <Table>
        <thead>
          <tr>
            <th className={th}>Dan</th>
            <th className={`${th} text-right`}>Prosečan prinos</th>
            <th className={`${th} text-right`}>% pozitivnih dana</th>
            <th className={`${th} text-right`}>N (dana)</th>
          </tr>
        </thead>
        <tbody>
          {data.map((d) => (
            <tr key={d.day}>
              <td className={td}>{DAY_NAMES[d.day]}</td>
              <td className={`${tdNum} ${pctClass(d.avg)}`}>{fmtPct(d.avg, 3)}</td>
              <td className={tdNum}>{d.winRate === null ? "—" : `${(d.winRate * 100).toFixed(0)}%`}</td>
              <td className={tdNum}>{d.n}</td>
            </tr>
          ))}
        </tbody>
      </Table>
    </Section>
  );
}

function FomcSection({ f }: { f: FomcStat }) {
  return (
    <Section title="5. Korelacija sa FOMC (Fed) sastancima" ok={f.n > 0}>
      {!f.n ? (
        <Na>Nema dovoljno podudaranja sa datumima FOMC sastanaka u izabranom periodu.</Na>
      ) : (
        <>
          <Table>
            <tbody>
              <tr><th className={th}>Prosečan dnevni prinos na dan FOMC odluke</th><td className={`${tdNum} ${pctClass(f.avg)}`}>{fmtPct(f.avg, 3)}</td></tr>
              <tr><th className={th}>Prosečan dnevni prinos (baseline)</th><td className={`${tdNum} ${pctClass(f.baseline)}`}>{fmtPct(f.baseline, 3)}</td></tr>
              <tr><th className={th}>Razlika u odnosu na baseline</th><td className={`${tdNum} ${pctClass((f.avg ?? 0) - f.baseline)}`}>{fmtPct((f.avg ?? 0) - f.baseline, 3)}</td></tr>
              <tr><th className={th}>% pozitivnih FOMC dana</th><td className={tdNum}>{f.winRate !== null ? `${(f.winRate * 100).toFixed(0)}%` : "—"}</td></tr>
              <tr><th className={th}>Broj analiziranih FOMC datuma</th><td className={tdNum}>{f.n}</td></tr>
            </tbody>
          </Table>
          <Na>Napomena: CPI izveštaji nisu uključeni jer BLS ne objavljuje fiksne datume unapred za ceo istorijski period.</Na>
        </>
      )}
    </Section>
  );
}

function GapSection({ g }: { g: GapStat }) {
  return (
    <Section title="10. Ponašanje cene oko statistički detektovanih šokova (verovatno zarade/vesti)" ok={g.n > 0}>
      {!g.n ? (
        <Na>Nije detektovan dovoljan broj statistički neuobičajenih &quot;gap&quot; dana u izabranom periodu.</Na>
      ) : (
        <>
          <Table>
            <tbody>
              <tr><th className={th}>Broj detektovanih neuobičajenih gap dana</th><td className={tdNum}>{g.n}</td></tr>
              <tr><th className={th}>Prosečan prinos 5 dana PRE gap-a</th><td className={`${tdNum} ${pctClass(g.avgPre5d)}`}>{fmtPct(g.avgPre5d)}</td></tr>
              <tr><th className={th}>Prosečan sam gap (dan 0)</th><td className={`${tdNum} ${pctClass(g.avgPostGap)}`}>{fmtPct(g.avgPostGap)}</td></tr>
              <tr><th className={th}>Prosečan prinos 5 dana POSLE gap-a</th><td className={`${tdNum} ${pctClass(g.avgPost5d)}`}>{fmtPct(g.avgPost5d)}</td></tr>
            </tbody>
          </Table>
          <Na>Metodologija: statistička detekcija neuobičajenog overnight gap-a — nije potvrđena lista datuma objave zarada.</Na>
        </>
      )}
    </Section>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function InsidersSection({ qs }: { qs: any }) {
  const tx = qs?.insiderTransactions?.transactions;
  const ok = !!(tx && tx.length);
  return (
    <Section title="6. Insajdersko kupovanje/prodaja (poslednje prijave)" ok={ok}>
      {!ok ? (
        <Na>Podaci o insajderskom trgovanju trenutno nisu dostupni za ovaj tiker.</Na>
      ) : (
        <Table>
          <thead>
            <tr>
              <th className={th}>Datum</th><th className={th}>Insajder</th><th className={th}>Pozicija</th><th className={th}>Transakcija</th><th className={`${th} text-right`}>Akcije</th>
            </tr>
          </thead>
          <tbody>
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            {tx.slice(0, 12).map((t: any, i: number) => (
              <tr key={i}>
                <td className={td}>{t.startDate?.fmt || "—"}</td>
                <td className={td}>{t.filerName || "—"}</td>
                <td className={td}>{t.filerRelation || "—"}</td>
                <td className={td}>{t.transactionText || "—"}</td>
                <td className={tdNum}>{fmtNum(t.shares?.raw)}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Section>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function InstitutionsSection({ qs }: { qs: any }) {
  const own = qs?.institutionOwnership?.ownershipList;
  const major = qs?.majorHoldersBreakdown;
  const ok = !!((own && own.length) || major);
  return (
    <Section title="7. Trend institucionalnog vlasništva" ok={ok}>
      {!ok ? (
        <Na>Podaci o institucionalnom vlasništvu trenutno nisu dostupni za ovaj tiker.</Na>
      ) : (
        <>
          {major && (
            <Table>
              <tbody>
                <tr><th className={th}>% u vlasništvu institucija</th><td className={tdNum}>{major.institutionsPercentHeld ? `${(major.institutionsPercentHeld.raw * 100).toFixed(2)}%` : "—"}</td></tr>
                <tr><th className={th}>% u vlasništvu insajdera</th><td className={tdNum}>{major.insidersPercentHeld ? `${(major.insidersPercentHeld.raw * 100).toFixed(2)}%` : "—"}</td></tr>
                <tr><th className={th}>Broj institucionalnih vlasnika</th><td className={tdNum}>{fmtNum(major.institutionsCount?.raw)}</td></tr>
              </tbody>
            </Table>
          )}
          {own && own.length > 0 && (
            <div className="mt-3">
              <Table>
                <thead>
                  <tr><th className={th}>Institucija</th><th className={th}>Datum izveštaja</th><th className={`${th} text-right`}>% udela</th><th className={`${th} text-right`}>Akcije</th></tr>
                </thead>
                <tbody>
                  {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                  {own.slice(0, 8).map((o: any, i: number) => (
                    <tr key={i}>
                      <td className={td}>{o.organization || "—"}</td>
                      <td className={td}>{o.reportDate?.fmt || "—"}</td>
                      <td className={tdNum}>{o.pctHeld ? `${(o.pctHeld.raw * 100).toFixed(2)}%` : "—"}</td>
                      <td className={tdNum}>{fmtNum(o.position?.raw)}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          )}
        </>
      )}
    </Section>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ShortInterestSection({ qs }: { qs: any }) {
  const ks = qs?.defaultKeyStatistics;
  const ok = !!ks;
  const shortPctFloat = ks?.shortPercentOfFloat?.raw;
  const shortRatio = ks?.shortRatio?.raw;
  const sharesShort = ks?.sharesShort?.raw;
  const sharesShortPrior = ks?.sharesShortPriorMonth?.raw;
  const trend = sharesShort != null && sharesShortPrior != null ? (sharesShort > sharesShortPrior ? "raste" : sharesShort < sharesShortPrior ? "opada" : "bez promene") : null;
  const squeezeFlag = shortPctFloat != null && shortRatio != null && shortPctFloat > 0.15 && shortRatio > 4;
  return (
    <Section title="8. Short interest i squeeze potencijal" ok={ok}>
      {!ok ? (
        <Na>Podaci o short interest-u trenutno nisu dostupni za ovaj tiker.</Na>
      ) : (
        <>
          <Table>
            <tbody>
              <tr><th className={th}>Short % of Float</th><td className={tdNum}>{shortPctFloat != null ? `${(shortPctFloat * 100).toFixed(2)}%` : "—"}</td></tr>
              <tr><th className={th}>Short Ratio (dana za pokrivanje)</th><td className={tdNum}>{shortRatio != null ? shortRatio.toFixed(2) : "—"}</td></tr>
              <tr><th className={th}>Akcija u short poziciji</th><td className={tdNum}>{fmtNum(sharesShort)}</td></tr>
              <tr><th className={th}>Prethodni mesec</th><td className={tdNum}>{fmtNum(sharesShortPrior)}</td></tr>
              <tr><th className={th}>Trend short interesa</th><td className={tdNum}>{trend || "—"}</td></tr>
            </tbody>
          </Table>
          {squeezeFlag && (
            <p className="mt-2 text-sm text-amber-700 dark:text-amber-400">
              ⚠ Povišen short interest i broj dana za pokrivanje — teoretski povećan short-squeeze potencijal (statistička opservacija, ne signal za trgovanje).
            </p>
          )}
        </>
      )}
    </Section>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function OptionsSection({ opt }: { opt: any }) {
  const ok = !!opt?.options?.length;
  return (
    <Section title="9. Neuobičajena aktivnost opcija" ok={ok}>
      {!ok ? (
        <Na>Podaci o opcijama trenutno nisu dostupni za ovaj tiker (Yahoo često zahteva dodatnu autentifikaciju za ovaj modul).</Na>
      ) : (
        (() => {
          const o = opt.options[0];
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const calls: any[] = o.calls || [];
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const puts: any[] = o.puts || [];
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const sum = (arr: any[], key: string) => arr.reduce((a, b) => a + (b[key] || 0), 0);
          const callVol = sum(calls, "volume"), putVol = sum(puts, "volume");
          const callOI = sum(calls, "openInterest"), putOI = sum(puts, "openInterest");
          const pcRatioVol = callVol ? putVol / callVol : null;
          const pcRatioOI = callOI ? putOI / callOI : null;
          const expDate = new Date(o.expirationDate * 1000).toISOString().slice(0, 10);
          const topByOI = [...calls, ...puts].sort((a, b) => (b.openInterest || 0) - (a.openInterest || 0)).slice(0, 5);
          return (
            <>
              <Table>
                <tbody>
                  <tr><th className={th}>Najbliži datum isteka opcija</th><td className={tdNum}>{expDate}</td></tr>
                  <tr><th className={th}>Put/Call odnos (volumen)</th><td className={tdNum}>{pcRatioVol != null ? pcRatioVol.toFixed(2) : "—"}</td></tr>
                  <tr><th className={th}>Put/Call odnos (open interest)</th><td className={tdNum}>{pcRatioOI != null ? pcRatioOI.toFixed(2) : "—"}</td></tr>
                  <tr><th className={th}>Ukupan volumen (call)</th><td className={tdNum}>{fmtNum(callVol)}</td></tr>
                  <tr><th className={th}>Ukupan volumen (put)</th><td className={tdNum}>{fmtNum(putVol)}</td></tr>
                </tbody>
              </Table>
              <div className="mt-3">
                <Table>
                  <thead>
                    <tr><th className={th}>Strike</th><th className={th}>Tip</th><th className={`${th} text-right`}>Open interest</th><th className={`${th} text-right`}>Volumen</th></tr>
                  </thead>
                  <tbody>
                    {topByOI.map((c, i) => (
                      <tr key={i}>
                        <td className={tdNum}>{c.strike}</td>
                        <td className={td}>{calls.includes(c) ? "Call" : "Put"}</td>
                        <td className={tdNum}>{fmtNum(c.openInterest)}</td>
                        <td className={tdNum}>{fmtNum(c.volume)}</td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            </>
          );
        })()
      )}
    </Section>
  );
}

function SectorSection({ sector }: { sector: Memo["sector"] }) {
  if (!sector.name) {
    return (
      <Section title="11. Signal rotacije sektora" ok={false}>
        <Na>Sektor nije dostupan za ovaj tiker.</Na>
      </Section>
    );
  }
  if (!sector.ok) {
    return (
      <Section title="11. Signal rotacije sektora" ok={false}>
        <Na>Poređenje sa sektorom trenutno nije uspelo (podaci o sektorskom ETF-u nisu dostupni).</Na>
      </Section>
    );
  }
  const vsSector = (sector.stockRet ?? 0) - (sector.etfRet ?? 0);
  const vsMarket = (sector.stockRet ?? 0) - (sector.spyRet ?? 0);
  const verdict =
    vsSector > 0 && vsMarket > 0
      ? "Akcija je NADMAŠILA i sektor i šire tržište (relativna snaga)."
      : vsSector < 0 && vsMarket < 0
      ? "Akcija je ZAOSTALA i za sektorom i za širim tržištem (relativna slabost)."
      : "Mešoviti signal — akcija se ponaša drugačije od sopstvenog sektora u odnosu na šire tržište.";
  return (
    <Section title="11. Signal rotacije sektora" ok={true}>
      <Table>
        <tbody>
          <tr><th className={th}>Sektor (GICS)</th><td className={td}>{sector.name}</td></tr>
          <tr><th className={th}>Sektorski ETF korišćen za poređenje</th><td className={td}>{sector.etf}</td></tr>
          <tr><th className={th}>Ukupan prinos akcije (period)</th><td className={`${tdNum} ${pctClass(sector.stockRet)}`}>{fmtPct(sector.stockRet)}</td></tr>
          <tr><th className={th}>Ukupan prinos sektorskog ETF-a</th><td className={`${tdNum} ${pctClass(sector.etfRet)}`}>{fmtPct(sector.etfRet)}</td></tr>
          <tr><th className={th}>Ukupan prinos S&amp;P 500 (SPY)</th><td className={`${tdNum} ${pctClass(sector.spyRet)}`}>{fmtPct(sector.spyRet)}</td></tr>
          <tr><th className={th}>Razlika naspram sektora</th><td className={`${tdNum} ${pctClass(vsSector)}`}>{fmtPct(vsSector)}</td></tr>
          <tr><th className={th}>Razlika naspram tržišta</th><td className={`${tdNum} ${pctClass(vsMarket)}`}>{fmtPct(vsMarket)}</td></tr>
        </tbody>
      </Table>
      <p className="mt-2 text-sm">{verdict}</p>
    </Section>
  );
}

function EdgeSummarySection({ memo }: { memo: Memo }) {
  const bullets: string[] = [];
  const bestMonth = [...memo.season].filter((m) => m.avg !== null).sort((a, b) => (b.avg as number) - (a.avg as number))[0];
  const worstMonth = [...memo.season].filter((m) => m.avg !== null).sort((a, b) => (a.avg as number) - (b.avg as number))[0];
  if (bestMonth && (bestMonth.avg as number) > 0) bullets.push(`Istorijski najjači mesec: ${MONTH_NAMES[bestMonth.month]} (prosečno ${fmtPct(bestMonth.avg)}, ${bestMonth.n} godina uzorka).`);
  if (worstMonth && (worstMonth.avg as number) < 0) bullets.push(`Istorijski najslabiji mesec: ${MONTH_NAMES[worstMonth.month]} (prosečno ${fmtPct(worstMonth.avg)}, ${worstMonth.n} godina uzorka).`);
  const bestDay = [...memo.dow].filter((d) => d.avg !== null).sort((a, b) => (b.avg as number) - (a.avg as number))[0];
  const worstDay = [...memo.dow].filter((d) => d.avg !== null).sort((a, b) => (a.avg as number) - (b.avg as number))[0];
  if (bestDay) bullets.push(`Najbolji dan u nedelji: ${DAY_NAMES[bestDay.day]} (prosečno ${fmtPct(bestDay.avg, 3)}).`);
  if (worstDay) bullets.push(`Najslabiji dan u nedelji: ${DAY_NAMES[worstDay.day]} (prosečno ${fmtPct(worstDay.avg, 3)}).`);
  if (memo.fomc.n) {
    const diff = (memo.fomc.avg ?? 0) - memo.fomc.baseline;
    bullets.push(`Na dane FOMC odluka akcija se u proseku kreće ${diff >= 0 ? "jače" : "slabije"} nego u proseku (razlika ${fmtPct(diff, 3)}), na osnovu ${memo.fomc.n} sastanaka.`);
  }
  if (memo.gaps.n) bullets.push(`Detektovano ${memo.gaps.n} statistički neuobičajenih "gap" dana (verovatno zarade/vesti), sa prosečnim gap-om od ${fmtPct(memo.gaps.avgPostGap)}.`);
  const shortPctFloat = memo.qs?.defaultKeyStatistics?.shortPercentOfFloat?.raw;
  const shortRatio = memo.qs?.defaultKeyStatistics?.shortRatio?.raw;
  if (shortPctFloat != null && shortRatio != null && shortPctFloat > 0.15 && shortRatio > 4) {
    bullets.push("Short interest je povišen — teoretski povećan short-squeeze potencijal (samo statistička opservacija, ne signal).");
  }
  if (!bullets.length) bullets.push("Nema dovoljno statistički izraženih obrazaca u dostupnim podacima za ovaj period.");
  bullets.push("Sve gore navedeno je deskriptivna statistika prošlosti — ne predstavlja garantovanu niti statistički značajnu prednost za buduće trgovanje.");

  return (
    <Section title="12. Statistički rezime" ok={true}>
      <ul className="list-disc pl-5 space-y-1.5 text-sm">
        {bullets.map((b, i) => (
          <li key={i}>{b}</li>
        ))}
      </ul>
    </Section>
  );
}
