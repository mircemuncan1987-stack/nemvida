import { NextRequest, NextResponse } from "next/server";

// Jedina ruta na sajtu koja poziva generativni AI model (Claude) umesto
// fiksnih pravila nad merljivim podacima — Fišerovih 15 pitanja su namerno
// kvalitativna (integritet menadžmenta, odnosi sa zaposlenima...) i ne mogu
// se izračunati iz Yahoo Finance brojeva. Zahteva ANTHROPIC_API_KEY u
// environment varijablama servera.

export const revalidate = 0;

const FISHER_QUESTIONS_SR = `1. Ima li kompanija proizvode ili usluge sa dovoljnim tržišnim potencijalom da omoguće značajan rast prodaje u trajanju od najmanje nekoliko godina?
2. Da li menadžment ima volju da nastavi razvoj novih proizvoda ili procesa koji će dalje povećati ukupni potencijal prodaje, kada rastni potencijal trenutnih atraktivnih proizvodnih linija bude u velikoj meri iskorišćen?
3. Koliko su efikasni napori kompanije u istraživanju i razvoju (R&D) u odnosu na njenu veličinu?
4. Ima li kompanija prodajnu organizaciju iznad proseka?
5. Ima li kompanija profitabilnu profitnu marginu?
6. Šta kompanija radi da bi održala ili poboljšala profitne margine?
7. Ima li kompanija izuzetne odnose sa radnicima i osobljem?
8. Ima li kompanija izuzetne odnose među rukovodstvom (executive relations)?
9. Ima li kompanija dubinu u menadžmentu (dovoljno kvalitetnih ljudi ispod samog vrha)?
10. Koliko su dobri sistemi kompanije za analizu troškova i računovodstvenu kontrolu?
11. Postoje li drugi aspekti poslovanja, specifični za tu granu, koji investitoru daju važne indicije o tome koliko je kompanija izuzetna u odnosu na konkurenciju?
12. Ima li kompanija kratkoročnu ili dugoročnu perspektivu kada je reč o profitu?
13. Da li će rast kompanije u doglednoj budućnosti zahtevati dovoljno finansiranja putem emisije novih akcija, tako da bi veći broj akcija u velikoj meri poništio korist koju postojeći akcionari inače imaju od tog očekivanog rasta?
14. Govori li menadžment slobodno investitorima o poslovanju kada stvari idu dobro, ali se "zatvara" (ćuti) kada nastanu problemi i razočaranja?
15. Ima li kompanija menadžment neupitnog integriteta?`;

function buildPrompt(companyName: string, ticker: string): string {
  return `Analiziraj kompaniju ${companyName} (${ticker}) detaljno za dugoročnog investitora, koristeći okvir Filipa Fišera (Philip Fisher) "What to Buy". Odgovori na sledećih 15 pitanja, redom, obeleženih istim brojevima, u 2-4 rečenice po pitanju:

${FISHER_QUESTIONS_SR}

Zasnuj analizu na najnovijim finansijskim vestima, intervjuima, dostupnim godišnjim izveštajima, kvartalnim izveštajima i investitorskim prezentacijama koje poznaješ. Ako za neko pitanje nemaš pouzdane ili dovoljno sveže informacije, jasno to navedi umesto da izmišljaš odgovor.

Na samom kraju dodaj odeljak naslovljen "Zaključak" sa jasnim odgovorom (3-5 rečenica): da li bi Filip Fišer, na osnovu ovih odgovora, kupio ovu akciju, i zašto.

Piši isključivo na srpskom jeziku.`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractText(content: any): string {
  if (!Array.isArray(content)) return "";
  return content
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((b: any) => b?.type === "text" && typeof b.text === "string")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((b: any) => b.text)
    .join("\n");
}

export async function POST(request: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY nije podešen na serveru — dodaj ga u environment varijable (Vercel → Settings → Environment Variables) da bi ova stranica radila." },
      { status: 500 }
    );
  }

  const body = await request.json().catch(() => null);
  const ticker = typeof body?.ticker === "string" ? body.ticker.trim() : "";
  const companyName = typeof body?.companyName === "string" ? body.companyName.trim() : "";
  if (!ticker || !companyName) {
    return NextResponse.json({ error: "Nedostaje 'ticker' ili 'companyName'." }, { status: 400 });
  }

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_FISHER_MODEL || "claude-sonnet-5",
        max_tokens: 4096,
        messages: [{ role: "user", content: buildPrompt(companyName, ticker) }],
      }),
      signal: AbortSignal.timeout(90000),
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Anthropic API je vratio HTTP ${res.status}: ${errBody.slice(0, 300)}`);
    }

    const data = await res.json();
    const text = extractText(data?.content);
    if (!text) throw new Error("AI model je vratio prazan odgovor.");

    return NextResponse.json({ text });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Nepoznata greška pri pozivu AI modela.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
