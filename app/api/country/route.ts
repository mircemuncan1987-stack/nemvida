import { NextRequest, NextResponse } from "next/server";

// Server-side proxy za dva besplatna, javna izvora makro podataka — oba bez
// API ključa:
//
// 1. World Bank Open Data (api.worldbank.org) — većina pokazatelja.
// 2. IMF DataMapper (imf.org/external/datamapper) — javni API iza IMF-ove
//    sopstvene interaktivne mape World Economic Outlook baze, korišćen
//    SAMO za javni dug i fiskalni bilans. World Bank-ova verzija tih dva
//    pokazatelja (GC.DOD.TOTL.GD.ZS/GC.BAL.CASH.GD.ZS, izvedena iz IMF
//    Government Finance Statistics) ima rupičavu pokrivenost čak i za
//    velike, razvijene ekonomije (npr. Švedska) jer te zemlje taj broj
//    prijavljuju kroz Eurostat/IMF Article IV, ne kroz GFS format koji WB
//    ovde ima. IMF-ova SOPSTVENA WEO baza (DataMapper je javni front za nju)
//    prati "general government" dug/bilans za ~190 ekonomija dva puta
//    godišnje i ima znatno širu, pouzdaniju pokrivenost — to je i standardni
//    izvor na koji se MMF/analitičari pozivaju za baš ove dve brojke.
//
// Objedinjavanje u jedan server-side poziv postoji da bi se više paralelnih
// zahteva (po jedan po pokazatelju/izvoru) spojilo u jedan odgovor za
// klijenta, ne zbog CORS-a (oba API-ja dozvoljavaju CORS direktno).
//
// "mrv=1" (World Bank "most recent value") traži najnoviju GODINU koja ima
// stvarno popunjenu vrednost — makro podaci kasne (često 1-2 godine), pa bez
// ovoga bi poslednja godina u nizu često bila null. IMF DataMapper vraća
// niz godina (uključujući IMF-ove projekcije za buduće godine) — ovde se
// bira najnovija godina ≤ tekuća kalendarska godina, da bi se prikazao
// stvarno izveden/ocenjen podatak, ne buduća projekcija. Svaki odgovor nosi
// i stvarnu godinu na koju se vrednost odnosi, da bi UI mogao da je prikaže
// ("2023.") umesto da tiho pretpostavi da je podatak trenutan.

const WB_INDICATOR_CODES = [
  "NY.GDP.MKTP.KD.ZG", // rast BDP-a (godišnje, %)
  "NY.GDP.PCAP.CD", // BDP po glavi stanovnika (trenutni USD)
  "FP.CPI.TOTL.ZG", // inflacija, potrošačke cene (godišnje, %)
  "SL.UEM.TOTL.ZS", // nezaposlenost (% radne snage)
  "NY.GNS.ICTR.ZS", // bruto nacionalna štednja (% BDP-a)
  "BN.CAB.XOKA.GD.ZS", // saldo tekućeg računa (% BDP-a)
  "NE.TRD.GNFS.ZS", // otvorenost trgovine (izvoz+uvoz, % BDP-a)
  "BX.KLT.DINV.WD.GD.ZS", // neto priliv direktnih stranih investicija (% BDP-a)
  "SP.POP.TOTL", // ukupno stanovništvo
  "SP.POP.GROW", // rast stanovništva (godišnje, %)
  "SI.POV.GINI", // Gini koeficijent (nejednakost dohotka) — anketni podatak, informativno
  "SP.DYN.LE00.IN", // životni vek pri rođenju (godine) — proxy za opšti razvoj/standard
] as const;

const IMF_INDICATOR_CODES = [
  "GGXWDG_NGDP", // opšti javni dug (% BDP-a) — IMF WEO
  "GGXCNL_NGDP", // fiskalni bilans / neto zaduživanje opšte države (% BDP-a) — IMF WEO
] as const;

export type IndicatorCode = (typeof WB_INDICATOR_CODES)[number] | (typeof IMF_INDICATOR_CODES)[number];

export interface IndicatorPoint {
  value: number | null;
  year: string | null;
}

const TIMEOUT_MS = 12000;

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    next: { revalidate: 60 * 60 * 24 }, // 24h — makro podaci se ne menjaju iz sata u sat
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function extractFirstRow(json: unknown): Record<string, unknown> | null {
  if (!Array.isArray(json) || json.length < 2) return null;
  const rows = json[1];
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return rows[0] as Record<string, unknown>;
}

async function fetchWbIndicator(iso3: string, code: string): Promise<IndicatorPoint> {
  try {
    const json = await fetchJson(`https://api.worldbank.org/v2/country/${encodeURIComponent(iso3)}/indicator/${code}?format=json&mrv=1`);
    const row = extractFirstRow(json);
    const rawValue = row?.value;
    return {
      value: typeof rawValue === "number" ? rawValue : null,
      year: row && typeof row.date === "string" ? row.date : null,
    };
  } catch {
    return { value: null, year: null };
  }
}

// IMF DataMapper vraća { values: { [indikator]: { [ISO3]: { [godina]: broj | null } } } } —
// uzima se najnovija godina ≤ tekuća kalendarska godina sa popunjenom vrednošću.
async function fetchImfIndicator(iso3: string, code: string): Promise<IndicatorPoint> {
  try {
    const json = await fetchJson(`https://www.imf.org/external/datamapper/api/v1/${code}/${encodeURIComponent(iso3)}`);
    const byYear = (json as { values?: Record<string, Record<string, Record<string, number | null>>> })?.values?.[code]?.[iso3];
    if (!byYear) return { value: null, year: null };
    const currentYear = new Date().getFullYear();
    const years = Object.keys(byYear)
      .filter((y) => /^\d{4}$/.test(y) && Number(y) <= currentYear && byYear[y] != null)
      .sort((a, b) => Number(b) - Number(a));
    if (years.length === 0) return { value: null, year: null };
    const latestYear = years[0];
    return { value: byYear[latestYear], year: latestYear };
  } catch {
    return { value: null, year: null };
  }
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  if (!code) {
    return NextResponse.json({ error: "Nedostaje parametar 'code' (ISO3 kod zemlje)." }, { status: 400 });
  }
  const iso3 = code.trim().toUpperCase();

  try {
    const metaJson = await fetchJson(`https://api.worldbank.org/v2/country/${encodeURIComponent(iso3)}?format=json`);
    const metaRow = extractFirstRow(metaJson);
    if (!metaRow) {
      return NextResponse.json({ error: "Zemlja nije pronađena u World Bank bazi podataka." }, { status: 404 });
    }
    const region = metaRow.region as { value?: string } | undefined;
    const incomeLevel = metaRow.incomeLevel as { value?: string } | undefined;

    const [wbResults, imfResults] = await Promise.all([
      Promise.all(WB_INDICATOR_CODES.map((ind) => fetchWbIndicator(iso3, ind))),
      Promise.all(IMF_INDICATOR_CODES.map((ind) => fetchImfIndicator(iso3, ind))),
    ]);

    const indicators: Record<string, IndicatorPoint> = {};
    WB_INDICATOR_CODES.forEach((ind, i) => (indicators[ind] = wbResults[i]));
    IMF_INDICATOR_CODES.forEach((ind, i) => (indicators[ind] = imfResults[i]));

    return NextResponse.json({
      meta: {
        code: iso3,
        name: typeof metaRow.name === "string" ? metaRow.name : iso3,
        region: region?.value && region.value !== "Aggregates" ? region.value : null,
        incomeLevel: incomeLevel?.value && incomeLevel.value !== "Aggregates" ? incomeLevel.value : null,
        capitalCity: typeof metaRow.capitalCity === "string" && metaRow.capitalCity ? metaRow.capitalCity : null,
      },
      indicators,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Greška pri preuzimanju makro podataka." }, { status: 502 });
  }
}
