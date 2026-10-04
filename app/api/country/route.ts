import { NextRequest, NextResponse } from "next/server";

// Server-side proxy za World Bank Open Data API (api.worldbank.org) —
// besplatan, javan, bez API ključa. Poziva se sa servera (ne iz browsera)
// isključivo da bi se objedinilo više paralelnih zahteva (jedan po
// indikatoru) u jedan odgovor za klijenta, ne zbog CORS-a (World Bank API
// dozvoljava CORS direktno).
//
// "mrv=1" (most recent value) traži od World Bank-a najnoviju GODINU koja
// ima stvarno popunjenu vrednost za taj indikator — makro podaci kasne
// (često 1-2 godine), pa bez ovoga bi poslednja godina u nizu često bila
// null. Svaki odgovor nosi i stvarnu godinu (date) na koju se vrednost
// odnosi, da bi UI mogao da je prikaže ("2023.") umesto da tiho pretpostavi
// da je podatak trenutan.

const INDICATOR_CODES = [
  "NY.GDP.MKTP.KD.ZG", // rast BDP-a (godišnje, %)
  "NY.GDP.PCAP.CD", // BDP po glavi stanovnika (trenutni USD)
  "FP.CPI.TOTL.ZG", // inflacija, potrošačke cene (godišnje, %)
  "SL.UEM.TOTL.ZS", // nezaposlenost (% radne snage)
  "GC.DOD.TOTL.GD.ZS", // javni dug (% BDP-a)
  "GC.BAL.CASH.GD.ZS", // fiskalni bilans / budžetski suficit-deficit (% BDP-a)
  "BN.CAB.XOKA.GD.ZS", // saldo tekućeg računa (% BDP-a)
  "NE.TRD.GNFS.ZS", // otvorenost trgovine (izvoz+uvoz, % BDP-a)
  "BX.KLT.DINV.WD.GD.ZS", // neto priliv direktnih stranih investicija (% BDP-a)
  "SP.POP.TOTL", // ukupno stanovništvo
  "SP.POP.GROW", // rast stanovništva (godišnje, %)
  "SI.POV.GINI", // Gini koeficijent (nejednakost dohotka)
] as const;

export type IndicatorCode = (typeof INDICATOR_CODES)[number];

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

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  if (!code) {
    return NextResponse.json({ error: "Nedostaje parametar 'code' (ISO3 kod zemlje)." }, { status: 400 });
  }
  const iso3 = code.trim().toUpperCase();

  try {
    const [metaJson, ...indicatorJsons] = await Promise.all([
      fetchJson(`https://api.worldbank.org/v2/country/${encodeURIComponent(iso3)}?format=json`),
      ...INDICATOR_CODES.map((ind) =>
        fetchJson(`https://api.worldbank.org/v2/country/${encodeURIComponent(iso3)}/indicator/${ind}?format=json&mrv=1`).catch(() => null)
      ),
    ]);

    const metaRow = extractFirstRow(metaJson);
    if (!metaRow) {
      return NextResponse.json({ error: "Zemlja nije pronađena u World Bank bazi podataka." }, { status: 404 });
    }
    const region = metaRow.region as { value?: string } | undefined;
    const incomeLevel = metaRow.incomeLevel as { value?: string } | undefined;

    const indicators: Record<string, IndicatorPoint> = {};
    INDICATOR_CODES.forEach((ind, i) => {
      const row = indicatorJsons[i] ? extractFirstRow(indicatorJsons[i]) : null;
      const rawValue = row?.value;
      indicators[ind] = {
        value: typeof rawValue === "number" ? rawValue : null,
        year: row && typeof row.date === "string" ? row.date : null,
      };
    });

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
    return NextResponse.json({ error: err instanceof Error ? err.message : "Greška pri preuzimanju World Bank podataka." }, { status: 502 });
  }
}
