// Ograničava "Sveobuhvatni model" samo na američke i evropske akcije (svi tikeri
// sa tih tržišta), po zahtevu — bez fiksne liste tikera, proverava se
// zemlja sedišta i/ili valuta iz Yahoo Finance podataka.

const US_EU_COUNTRIES = new Set([
  "United States",
  "Germany",
  "France",
  "Netherlands",
  "Italy",
  "Spain",
  "Belgium",
  "Ireland",
  "Austria",
  "Sweden",
  "Denmark",
  "Finland",
  "Norway",
  "Switzerland",
  "Poland",
  "Portugal",
  "Luxembourg",
  "United Kingdom",
  "Czechia",
  "Czech Republic",
  "Hungary",
  "Greece",
  "Romania",
  "Slovakia",
  "Slovenia",
  "Croatia",
  "Iceland",
  "Cyprus",
  "Malta",
  "Estonia",
  "Latvia",
  "Lithuania",
]);

const US_EU_CURRENCIES = new Set([
  "USD",
  "EUR",
  "GBP",
  "GBp",
  "CHF",
  "SEK",
  "NOK",
  "DKK",
  "PLN",
  "CZK",
  "HUF",
  "RON",
  "ISK",
]);

export function isUsOrEuropeanMarket(country: string | null, currency: string | null): boolean {
  if (country && US_EU_COUNTRIES.has(country)) return true;
  if (currency && US_EU_CURRENCIES.has(currency)) return true;
  return false;
}
