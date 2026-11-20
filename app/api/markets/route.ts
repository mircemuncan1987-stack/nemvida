import { NextResponse } from "next/server";
import { fetchAllQuotes } from "@/lib/marketData";

// Pregled tržišta — jedan server-side poziv koji vraća sve instrumente sa
// /trziste (indeksi, fjučersi, energenti, metali, kamate, VIX, NOK kursevi),
// umesto ~30 odvojenih zahteva iz browsera. Rezime vesti je odvojeno, na
// /api/digest, jer traje duže i ne treba da zadržava tabele.

// Dinamička ruta: bez ovoga Next je prerenderuje u toku build-a (kad
// spoljni izvori često nisu dostupni) i servira taj prazan snimak dok se ne
// osveži. Keširanje ostaje na nivou pojedinačnih Yahoo poziva (5 min, vidi
// fetchUpstream), pa se Yahoo ne poziva na svako učitavanje stranice.
export const dynamic = "force-dynamic";

export async function GET() {
  const quotes = await fetchAllQuotes();
  return NextResponse.json({ updatedAt: new Date().toISOString(), quotes });
}
