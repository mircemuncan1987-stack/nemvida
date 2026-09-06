# Nemvida Finance

Besplatan i otvoren sajt sa finansijskim vestima u realnom vremenu i
stručnim člancima za kompanije: Visa (V), Mastercard (MA), American Express
(AXP), Nvidia (NVDA), Amazon (AMZN), Meta Platforms (META), Alphabet
(GOOGL), Microsoft (MSFT), Merck (MRK), TSMC i Investor AB.

## Kako radi

- **Vesti** (`/`) — naslovna strana agregira vesti sa javno dostupnih RSS
  izvora (Google News, Yahoo Finance) preko `/api/news` rute. Podaci na
  serveru se osvežavaju na svakih 5 minuta (`revalidate: 300`), a stranica
  u browseru automatski povlači nove podatke na svakih 60 sekundi — bez
  potrebe da čitalac ručno osvežava stranicu.
- **Stručni članci** (`/clanci`) — Markdown fajlovi u `content/articles/`.
  Svaki članak ima `title`, `date`, `author`, `excerpt` i `lang`
  (`sr`, `en`, `no` ili `sv`) polja u zaglavlju (frontmatter).
- **Rezime vesti** — klik na naslov vesti otvara prozorčić sa automatskim
  rezimeom članka umesto da odmah vodi na sajt izvora. Ruta
  `/api/summarize` na serveru prvo pokušava preko javnog "reader" servisa
  (`r.jina.ai`), koji dobro probija bot-zaštitu i Google-ove preusmeravajuće
  linkove, a ako to ne uspe pokušava direktan pristup originalnom sajtu.
  Zatim se uklanjaju nebitni delovi (meniji, reklame, "pretplati se" i sl.)
  i algoritamski (bez plaćenih AI servisa) izdvaja 3-4 najvažnije rečenice
  na osnovu učestalosti ključnih reči i pozicije u tekstu (vidi
  `lib/summarize.ts`). Neki sajtovi i dalje mogu blokirati oba pokušaja —
  tada se prikazuje kratak izvod koji već stiže uz RSS vest.
- Sav sadržaj je besplatan, bez registracije i bez paywall-a.

## Dodavanje novog članka

Napravi novi `.md` fajl u `content/articles/`, npr. `moj-clanak.md`:

```md
---
title: "Naslov članka"
date: "2026-09-10"
author: "Ime Prezime"
lang: "sr"
excerpt: "Kratak opis članka."
---

Tekst članka u Markdown formatu.
```

## Dodavanje nove kompanije za praćenje vesti

Dodaj novi unos u `lib/companies.ts` sa `ticker`, `name`, `displayName`,
`yahooSymbol` (Yahoo Finance simbol, ako postoji) i `searchTerms`.

## Pokretanje lokalno

```bash
npm install
npm run dev
```

## Deploy

Sajt je standardna Next.js aplikacija (App Router) i može se hostovati na
Vercel-u (preporučeno, besplatan plan je dovoljan) ili bilo kom hostingu
koji podržava Node.js / Next.js. Za pravo osvežavanje vesti u realnom
vremenu neophodan je hosting sa izlaznim pristupom internetu (za RSS
fidove) — ovo NIJE testirano u razvojnom okruženju sa ograničenom mrežom,
ali radiće čim se sajt postavi na produkcioni hosting.
