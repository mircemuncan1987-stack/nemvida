import { NextRequest, NextResponse } from "next/server";
import { explainCorrections, type CorrectionInput } from "@/lib/correctionsExplain";

// Objašnjenje razloga korekcija (Claude) — samo na klik korisnika.
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Jednostavna zaštita od zloupotrebe kredita: najviše 10 poziva u minuti po
// instanci servera (nije savršena na serverless-u, ali ograničava štetu).
const hits: number[] = [];
function rateLimited(): boolean {
  const now = Date.now();
  while (hits.length && now - hits[0] > 60_000) hits.shift();
  if (hits.length >= 10) return true;
  hits.push(now);
  return false;
}

const num = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ status: "unavailable", reason: "Neispravan zahtev." }, { status: 400 });
  }
  const b = body as { ticker?: unknown; companyName?: unknown; corrections?: unknown };
  const ticker = typeof b.ticker === "string" ? b.ticker.trim().slice(0, 20) : "";
  const companyName = typeof b.companyName === "string" ? b.companyName.trim().slice(0, 100) : "";
  if (!ticker || !companyName || !Array.isArray(b.corrections) || b.corrections.length === 0 || b.corrections.length > 60) {
    return NextResponse.json({ status: "unavailable", reason: "Neispravan zahtev." }, { status: 400 });
  }
  const corrections: CorrectionInput[] = [];
  for (const raw of b.corrections as Record<string, unknown>[]) {
    if (!raw || !num(raw.peakTs) || !num(raw.troughTs) || !num(raw.depth) || raw.depth >= 0 || raw.depth < -1) {
      return NextResponse.json({ status: "unavailable", reason: "Neispravni podaci o korekcijama." }, { status: 400 });
    }
    corrections.push({
      peakTs: Math.round(raw.peakTs),
      troughTs: Math.round(raw.troughTs),
      depth: Math.round(raw.depth * 1000) / 1000,
      marketChange: num(raw.marketChange) ? Math.round(raw.marketChange * 1000) / 1000 : null,
    });
  }
  if (rateLimited()) {
    return NextResponse.json({ status: "unavailable", reason: "Previše zahteva — pokušaj za minut." }, { status: 429 });
  }
  return NextResponse.json(await explainCorrections(ticker, companyName, corrections));
}
