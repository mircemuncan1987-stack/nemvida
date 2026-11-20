import { NextRequest, NextResponse } from "next/server";
import { getDigest } from "@/lib/newsDigest";

// Rezime vesti (Claude). ?scope=market za /trziste, ?scope=company[&ticker=V]
// za stranicu Vesti (bez tikera = sve praćene kompanije zajedno).
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const scope = request.nextUrl.searchParams.get("scope") === "market" ? "market" : "company";
  const ticker = request.nextUrl.searchParams.get("ticker");
  const result = await getDigest(scope, ticker);
  return NextResponse.json(result);
}
