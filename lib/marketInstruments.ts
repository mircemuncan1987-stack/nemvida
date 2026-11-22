// Instrumenti za stranicu "Pregled tržišta" (/trziste). Yahoo Finance simboli
// iz opšteg znanja — ne mogu se proveriti uživo iz razvojnog okruženja. Za
// instrumente gde Yahoo koristi više mogućih simbola (npr. Oslo i Stokholm
// indeksi), navedeno je više kandidata redom — server uzima prvi koji vrati
// podatke, umesto da cela stavka ostane prazna zbog jednog pogrešnog simbola.

export type MarketGroupId = "sad" | "azija" | "nordijski" | "fjucersi" | "energenti" | "metali" | "kamate" | "volatilnost" | "valute";

// "price" = obična cena/vrednost indeksa; "yield" = prinos u procentima
// (promena se prikazuje u baznim poenima, ne u procentima, jer je to
// standard za kamatne stope); "fx" = devizni kurs (više decimala).
export type InstrumentKind = "price" | "yield" | "fx";

export interface MarketInstrument {
  id: string;
  name: string;
  symbols: string[];
  kind: InstrumentKind;
  unit?: string; // npr. "USD/barel" — kad valuta iz Yahoo-a sama nije dovoljno jasna
}

export interface MarketGroup {
  id: MarketGroupId;
  title: string;
  description: string;
  instruments: MarketInstrument[];
  dailyOnly?: boolean; // prikazuje samo cenu i dnevnu promenu (npr. fjučersi)
}

export const MARKET_GROUPS: MarketGroup[] = [
  {
    id: "sad",
    title: "Amerika",
    description: "Glavni američki berzanski indeksi.",
    instruments: [
      { id: "spx", name: "S&P 500", symbols: ["^GSPC"], kind: "price" },
      { id: "ixic", name: "Nasdaq Composite", symbols: ["^IXIC"], kind: "price" },
      { id: "dji", name: "Dow Jones", symbols: ["^DJI"], kind: "price" },
    ],
  },
  {
    id: "azija",
    title: "Azija",
    description: "Tokio i Šangaj.",
    instruments: [
      { id: "n225", name: "Nikkei 225 (Tokio)", symbols: ["^N225"], kind: "price" },
      { id: "sse", name: "Shanghai Composite (Šangaj)", symbols: ["000001.SS"], kind: "price" },
    ],
  },
  {
    id: "nordijski",
    title: "Skandinavija",
    description: "Stokholmska i Oslo berza.",
    instruments: [
      { id: "omxs30", name: "OMX Stockholm 30", symbols: ["^OMX", "^OMXS30"], kind: "price" },
      { id: "osebx", name: "Oslo Børs (OSEBX)", symbols: ["OSEBX.OL", "^OSEBX", "OBX.OL"], kind: "price" },
    ],
  },
  {
    id: "fjucersi",
    dailyOnly: true,
    title: "Fjučersi",
    description: "Terminski ugovori na američke indekse — trguju se skoro 24h, pa pokazuju raspoloženje i pre otvaranja berze.",
    instruments: [
      { id: "es", name: "S&P 500 fjučers", symbols: ["ES=F"], kind: "price" },
      { id: "nq", name: "Nasdaq 100 fjučers", symbols: ["NQ=F"], kind: "price" },
      { id: "ym", name: "Dow Jones fjučers", symbols: ["YM=F"], kind: "price" },
    ],
  },
  {
    id: "energenti",
    title: "Energenti",
    description: "Nafta i gas (fjučers cene).",
    instruments: [
      { id: "brent", name: "Brent nafta", symbols: ["BZ=F"], kind: "price", unit: "USD/barel" },
      { id: "wti", name: "WTI nafta", symbols: ["CL=F"], kind: "price", unit: "USD/barel" },
      { id: "ng", name: "Prirodni gas (SAD, Henry Hub)", symbols: ["NG=F"], kind: "price", unit: "USD/MMBtu" },
      { id: "ttf", name: "Prirodni gas (Evropa, TTF)", symbols: ["TTF=F"], kind: "price", unit: "EUR/MWh" },
    ],
  },
  {
    id: "metali",
    title: "Plemeniti metali",
    description: "Fjučers cene po troj unci.",
    instruments: [
      { id: "gold", name: "Zlato", symbols: ["GC=F"], kind: "price", unit: "USD/unca" },
      { id: "silver", name: "Srebro", symbols: ["SI=F"], kind: "price", unit: "USD/unca" },
      { id: "platinum", name: "Platina", symbols: ["PL=F"], kind: "price", unit: "USD/unca" },
      { id: "palladium", name: "Paladijum", symbols: ["PA=F"], kind: "price", unit: "USD/unca" },
    ],
  },
  {
    id: "kamate",
    title: "Kamatne stope (američke državne obveznice)",
    description: "Prinos na 5, 10 i 30 godina — globalna referentna kriva. Promena u baznim poenima (1 b.p. = 0,01 p.p.).",
    instruments: [
      { id: "us5y", name: "5 godina", symbols: ["^FVX"], kind: "yield" },
      { id: "us10y", name: "10 godina", symbols: ["^TNX"], kind: "yield" },
      { id: "us30y", name: "30 godina", symbols: ["^TYX"], kind: "yield" },
    ],
  },
  {
    id: "volatilnost",
    title: "Volatilnost",
    description: "VIX — očekivana volatilnost S&P 500 narednih 30 dana (\"indeks straha\"). Ispod ~15 mirno tržište, iznad ~25 povišen strah, iznad ~35 panika.",
    instruments: [{ id: "vix", name: "VIX", symbols: ["^VIX"], kind: "price", unit: "poeni" }],
  },
  {
    id: "valute",
    title: "Norveška kruna (NOK)",
    description: "Koliko NOK košta jedna jedinica strane valute — rast znači slabiju krunu.",
    instruments: [
      { id: "usdnok", name: "USD/NOK", symbols: ["USDNOK=X", "NOK=X"], kind: "fx" },
      { id: "eurnok", name: "EUR/NOK", symbols: ["EURNOK=X"], kind: "fx" },
      { id: "gbpnok", name: "GBP/NOK", symbols: ["GBPNOK=X"], kind: "fx" },
      { id: "seknok", name: "SEK/NOK", symbols: ["SEKNOK=X"], kind: "fx" },
      { id: "dkknok", name: "DKK/NOK", symbols: ["DKKNOK=X"], kind: "fx" },
      { id: "chfnok", name: "CHF/NOK", symbols: ["CHFNOK=X"], kind: "fx" },
    ],
  },
];

export interface InstrumentQuote {
  id: string;
  symbol: string | null; // simbol koji je stvarno vratio podatke
  price: number | null;
  currency: string | null;
  dayChange: number | null; // apsolutna promena u odnosu na prethodno zatvaranje
  dayChangePercent: number | null;
  weekChange: number | null; // u odnosu na zatvaranje pre 5 trgovačkih dana
  weekChangePercent: number | null;
  asOf: number | null; // unix sekunde poslednje cene
  spark: number[]; // dnevna zatvaranja za poslednji mesec, za mini-grafikon
}
