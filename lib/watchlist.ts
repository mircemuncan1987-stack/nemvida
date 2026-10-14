// Lista akcija koje korisnik prati (ne poseduje nužno) — odvojeno od
// /portfolio, koji prati stvarne pozicije. Služi kao ulaz za procenu da li je
// trenutna cena atraktivna, naspram sopstvene istorijske norme svake
// kompanije (vidi lib/watchlistAttractiveness.ts).

export interface WatchlistTicker {
  id: string;
  ticker: string;
  name: string;
}

// Prefilled iz liste koju je korisnik poslao (18 pozicija, 10.10.2026) —
// samo početna tačka, može se dodavati/uklanjati. Evropski tikeri su Yahoo
// simboli usklađeni sa postojećim CAC40/DAX40 listama na sajtu.
export const DEFAULT_WATCHLIST: WatchlistTicker[] = [
  { id: "aapl", ticker: "AAPL", name: "Apple" },
  { id: "avgo", ticker: "AVGO", name: "Broadcom" },
  { id: "cost", ticker: "COST", name: "Costco Wholesale" },
  { id: "cat", ticker: "CAT", name: "Caterpillar" },
  { id: "brkb", ticker: "BRK.B", name: "Berkshire Hathaway B" },
  { id: "abbv", ticker: "ABBV", name: "AbbVie" },
  { id: "aph", ticker: "APH", name: "Amphenol" },
  { id: "rtx", ticker: "RTX", name: "RTX" },
  { id: "ph", ticker: "PH", name: "Parker-Hannifin" },
  { id: "mco", ticker: "MCO", name: "Moody's" },
  { id: "asml", ticker: "ASML", name: "ASML Holding" },
  { id: "mc", ticker: "MC.PA", name: "LVMH Moët Hennessy Louis Vuitton" },
  { id: "air", ticker: "AIR.PA", name: "Airbus SE" },
  { id: "su", ticker: "SU.PA", name: "Schneider Electric SE" },
  { id: "sie", ticker: "SIE.DE", name: "Siemens AG" },
  { id: "alv", ticker: "ALV.DE", name: "Allianz SE" },
  { id: "or", ticker: "OR.PA", name: "L'Oréal" },
  { id: "sap", ticker: "SAP.DE", name: "SAP SE" },
];
