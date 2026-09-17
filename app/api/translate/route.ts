import { NextRequest, NextResponse } from "next/server";

// MyMemory je besplatan mašinski prevodilac bez potrebe za API ključem —
// koristi se samo za opis poslovanja kompanije (Yahoo Finance ga vraća
// isključivo na engleskom). Anonimni zahtevi imaju ograničenje dužine
// (~500 karaktera po pozivu), pa se tekst deli na rečenice i svaka se
// prevodi posebno, a prevodi se spajaju u konačan tekst.
const MAX_CHUNK_CHARS = 450;

function splitIntoChunks(text: string): string[] {
  const sentences = text.match(/[^.!?]+[.!?]*\s*/g) || [text];
  const chunks: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    if (current && (current + sentence).length > MAX_CHUNK_CHARS) {
      chunks.push(current.trim());
      current = sentence;
    } else {
      current += sentence;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

async function translateChunk(chunk: string): Promise<string> {
  const res = await fetch(
    `https://api.mymemory.translated.net/get?q=${encodeURIComponent(chunk)}&langpair=en|sr`,
    { signal: AbortSignal.timeout(10000) }
  );
  if (!res.ok) throw new Error(`MyMemory HTTP ${res.status}`);
  const data = await res.json();
  const translated = data?.responseData?.translatedText;
  if (!translated || typeof translated !== "string") throw new Error("Prazan odgovor prevodioca");
  return translated;
}

export async function GET(request: NextRequest) {
  const text = request.nextUrl.searchParams.get("text");
  if (!text) {
    return NextResponse.json({ error: "Nedostaje parametar 'text'" }, { status: 400 });
  }

  try {
    const chunks = splitIntoChunks(text);
    const translatedChunks: string[] = [];
    // Sekvencijalno (ne paralelno) da se ne bi udarilo u limit besplatnog
    // servisa naglim naletom zahteva za jedan dugačak opis.
    for (const chunk of chunks) {
      translatedChunks.push(await translateChunk(chunk));
    }
    return NextResponse.json({ translated: translatedChunks.join(" ") });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Nepoznata greška pri prevodu";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
