// Sve cene na ovoj stranici su PROCENE, ne uživo cene iz rezervacionih sistema
// aviokompanija (vidi README / napomenu na stranici). Model je namerno jednostavan
// i providan: udaljenost + sezona + koliko unapred se kupuje karta + prtljag.

export type Airport = {
  iata: string;
  city: string;
  country: string;
  lat: number;
  lon: number;
};

export const STAVANGER: Airport = {
  iata: "SVG",
  city: "Stavanger (Sola)",
  country: "Norveška",
  lat: 58.8767,
  lon: 5.6378,
};

/** Haversine udaljenost u kilometrima. */
export function haversineKm(a: Pick<Airport, "lat" | "lon">, b: Pick<Airport, "lat" | "lon">): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const sinDLat = Math.sin(dLat / 2);
  const sinDLon = Math.sin(dLon / 2);
  const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLon * sinDLon;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Cena po km opada sa udaljenošću (kratki letovi su relativno skuplji po km zbog fiksnih troškova). */
function perKmRate(distanceKm: number): number {
  if (distanceKm <= 800) return 0.11;
  if (distanceKm <= 2000) return 0.075;
  return 0.05;
}

function seasonMultiplier(date: Date): number {
  const month = date.getMonth(); // 0=jan
  const day = date.getDate();
  if (month === 11 && day >= 18) return 1.45; // Božić/Nova godina
  if (month === 5 || month === 6 || month === 7) return 1.35; // jun-avg
  if (month === 2 || month === 3) return 1.15; // mart-april (uskršnji period, okvirno)
  if (month === 0 || month === 1 || month === 10) return 0.85; // jan, feb, nov
  return 0.95; // maj, sep, okt, dec (do 18.)
}

function leadTimeMultiplier(daysUntilDeparture: number): number {
  if (daysUntilDeparture < 10) return 1.6;
  if (daysUntilDeparture < 22) return 1.25;
  if (daysUntilDeparture < 46) return 1.0;
  if (daysUntilDeparture < 120) return 0.9;
  return 1.05;
}

export type AirlineFareProfile = {
  /** "puna usluga" aviokompanije imaju viši osnovni deo cene, ali ne nužno i uključen prtljag. */
  serviceLevel: "low-cost" | "full-service";
  /** Da li je predati (rucni ne racunamo) kofer uključen u najjeftiniju tarifu po defaultu. */
  baggageIncludedByDefault: boolean;
  /** Procenjena cena dodavanja predatog kofera po jednoj deonici, ako nije uključen. */
  estimatedBagFeeEurPerLeg?: number;
};

export type FareEstimate = {
  currency: "EUR";
  perPassengerOneLeg: number;
  perPassengerTotal: number;
  partyTotal: number;
  baggageFeeAddedPerPassenger: number;
  baggageIncluded: true; // uvek true u prikazanoj ceni - ili je već uključen, ili ga dodajemo
  distanceKm: number;
};

export function estimateFare(params: {
  destination: Pick<Airport, "lat" | "lon">;
  departDate: Date;
  returnDate?: Date | null;
  adults: number;
  airline: AirlineFareProfile;
  today?: Date;
}): FareEstimate {
  const { destination, departDate, returnDate, adults, airline } = params;
  const today = params.today ?? new Date();
  const distanceKm = haversineKm(STAVANGER, destination);
  const baseFee = airline.serviceLevel === "low-cost" ? 25 : 45;
  const rate = perKmRate(distanceKm);
  const oneWayBase = baseFee + distanceKm * rate;

  const legFare = (d: Date) => {
    const daysUntil = Math.max(0, Math.round((d.getTime() - today.getTime()) / 86_400_000));
    return oneWayBase * seasonMultiplier(d) * leadTimeMultiplier(daysUntil);
  };

  const outboundFare = legFare(departDate);
  const inboundFare = returnDate ? legFare(returnDate) : 0;
  const legsFlown = returnDate ? 2 : 1;

  const bagFeePerLeg = airline.baggageIncludedByDefault ? 0 : airline.estimatedBagFeeEurPerLeg ?? 25;
  const baggageFeeAddedPerPassenger = bagFeePerLeg * legsFlown;

  const perPassengerTotal = outboundFare + inboundFare + baggageFeeAddedPerPassenger;

  return {
    currency: "EUR",
    perPassengerOneLeg: Math.round(outboundFare),
    perPassengerTotal: Math.round(perPassengerTotal),
    partyTotal: Math.round(perPassengerTotal * adults),
    baggageFeeAddedPerPassenger: Math.round(baggageFeeAddedPerPassenger),
    baggageIncluded: true,
    distanceKm: Math.round(distanceKm),
  };
}

// Sekvencijalna plava skala (validirana paleta) za mapu cena: svetlije = jeftinije.
const SEQUENTIAL_BLUE_LIGHT = ["#cde2fb", "#9ec5f4", "#5598e7", "#2a78d6", "#184f95"];
const SEQUENTIAL_BLUE_DARK = ["#9ec5f4", "#6da7ec", "#3987e5", "#1c5cab", "#0d366b"];

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex([r, g, b]: [number, number, number]): string {
  const c = (v: number) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** t u [0,1], 0 = najjeftinije, 1 = najskuplje. */
export function priceScaleColor(t: number, mode: "light" | "dark" = "light"): string {
  const stops = mode === "dark" ? SEQUENTIAL_BLUE_DARK : SEQUENTIAL_BLUE_LIGHT;
  const clamped = Math.max(0, Math.min(1, t));
  const scaled = clamped * (stops.length - 1);
  const i = Math.floor(scaled);
  const frac = scaled - i;
  if (i >= stops.length - 1) return stops[stops.length - 1];
  const a = hexToRgb(stops[i]);
  const b = hexToRgb(stops[i + 1]);
  const mixed: [number, number, number] = [
    a[0] + (b[0] - a[0]) * frac,
    a[1] + (b[1] - a[1]) * frac,
    a[2] + (b[2] - a[2]) * frac,
  ];
  return rgbToHex(mixed);
}
