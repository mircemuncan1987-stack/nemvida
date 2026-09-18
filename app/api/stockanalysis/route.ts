import { NextRequest, NextResponse } from "next/server";

// stockanalysis.com nema javni, dokumentovan API — ovo je best-effort
// scraping njihove javno dostupne (besplatne) stranice sa finansijskim
// izveštajima, korišćeno ISKLJUČIVO kao rezerva kad Yahoo Finance nema
// podatak (npr. TTM slobodan novčani tok za tikere gde Yahoo to polje ne
// popunjava). Nikad se ne poziva umesto Yahoo-a, samo pored njega.
//
// Radi trenutno samo za američke tikere (Yahoo simbol bez tačke = bez
// sufiksa berze), jer stockanalysis.com koristi drugačiju URL šemu za
// međunarodne tikere (po berzi) koju nismo mapirali — za te tikere ruta
// vraća grešku, a pozivalac treba da to tretira kao "nema rezervnog
// podatka", ne kao kvar.
//
// Pošto je HTML struktura sajta van naše kontrole i nismo je mogli testirati
// uživo (ovaj sandbox nema internet pristup), parsiranje je namerno
// tolerantno — ako struktura ne odgovara očekivanoj, vraća se null umesto
// greške koja bi srušila ostatak stranice.

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

async function fetchStockAnalysisPage(ticker: string, path: string): Promise<string | null> {
  try {
    const res = await fetch(`https://stockanalysis.com/stocks/${encodeURIComponent(ticker.toLowerCase())}/${path}/`, {
      headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml" },
      next: { revalidate: 21600 }, // 6h — ovo je rezervni izvor, ne treba live osvežavanje
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

// stockanalysis.com prikazuje brojeve kompaktno (npr. "12.3B", "(450M)",
// "1.2T") — parsira ih u pun broj, uz podršku za negativne vrednosti u
// zagradama (računovodstvena konvencija) i sa predznakom.
function parseCompactNumber(raw: string): number | null {
  let cleaned = raw.replace(/,/g, "").trim();
  let negative = false;
  if (/^\(.*\)$/.test(cleaned)) {
    negative = true;
    cleaned = cleaned.slice(1, -1);
  }
  const match = cleaned.match(/^-?\$?(\d+(\.\d+)?)\s*(K|M|B|T)?$/i);
  if (!match) return null;
  let value = parseFloat(match[1]);
  if (cleaned.startsWith("-") || negative) value = -Math.abs(value);
  const suffix = match[3]?.toUpperCase();
  if (suffix === "K") value *= 1e3;
  if (suffix === "M") value *= 1e6;
  if (suffix === "B") value *= 1e9;
  if (suffix === "T") value *= 1e12;
  return value;
}

// Nalazi red tabele čija labela (prva ćelija) odgovara "rowLabel" i vraća
// prvu brojčanu vrednost posle labele — u stockanalysis.com tabelama je
// najnoviji period uvek prva kolona podataka (TTM ili poslednja godina).
function extractLatestRowValue(html: string, rowLabel: RegExp): number | null {
  const rowRegex = new RegExp(`<tr[^>]*>\\s*<t[dh][^>]*>[\\s\\S]{0,200}?${rowLabel.source}[\\s\\S]*?<\\/tr>`, "i");
  const rowMatch = html.match(rowRegex);
  if (!rowMatch) return null;
  const cellMatches = [...rowMatch[0].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)];
  for (let i = 1; i < cellMatches.length; i++) {
    const text = cellMatches[i][1].replace(/<[^>]+>/g, "").trim();
    const parsed = parseCompactNumber(text);
    if (parsed != null) return parsed;
  }
  return null;
}

export async function GET(request: NextRequest) {
  const symbol = request.nextUrl.searchParams.get("symbol");
  const type = request.nextUrl.searchParams.get("type") || "fcf";
  if (!symbol) {
    return NextResponse.json({ error: "Nedostaje parametar 'symbol'" }, { status: 400 });
  }
  if (symbol.includes(".")) {
    return NextResponse.json({ error: "stockanalysis rezerva trenutno pokriva samo američke tikere (bez sufiksa berze)" }, { status: 404 });
  }

  if (type === "fcf") {
    const html = await fetchStockAnalysisPage(symbol, "financials/cash-flow-statement");
    if (!html) return NextResponse.json({ freeCashflowTtm: null });
    const value = extractLatestRowValue(html, /Free\s*Cash\s*Flow(?!\s*Margin)/i);
    return NextResponse.json({ freeCashflowTtm: value });
  }

  return NextResponse.json({ error: "Nepoznat 'type' parametar" }, { status: 400 });
}
