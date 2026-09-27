import type { Airport, AirlineFareProfile } from "./flightPricing";

export type BookingLinkParams = {
  from: string;
  to: string;
  departDate: string; // YYYY-MM-DD
  returnDate?: string;
  adults: number;
};

export type Airline = AirlineFareProfile & {
  id: string;
  name: string;
  homepage: string;
  /**
   * Builder za direktan link ka pretrazi/rezervaciji NA SAJTU AVIOKOMPANIJE
   * (nikad posrednička agencija). Aviokompanije čiji sistem za rezervaciju
   * ne podržava potvrđeno pouzdan "deep link" sa parametrima dobijaju link
   * ka svojoj početnoj/booking stranici umesto pogađanja URL šablona koji
   * bi mogao da vodi na grešku (404).
   */
  buildBookingUrl: (params: BookingLinkParams) => string;
  /** Da li link zaista predpopunjava rutu, datume i broj putnika. */
  deepLinkSupported: boolean;
};

export type Route = {
  destination: Airport;
  airlineId: string;
  seasonal?: boolean;
  seasonalNote?: string;
  directFlight: boolean;
  /**
   * Za destinacije van redovne mreže iz Stavangera: JEDNA karta kod iste
   * aviokompanije, sa presedanjem u njenom čvorištu (npr. KLM preko
   * Amsterdama) - i dalje direktno kod avio-prevoznika, nikad agencija.
   */
  viaHub?: Airport;
  /** Dodatna napomena o rutiranju kad ima više od jednog presedanja. */
  stopsNote?: string;
};

const homepageOnly = (homepage: string) => () => homepage;

export const airlines: Record<string, Airline> = {
  norwegian: {
    id: "norwegian",
    name: "Norwegian",
    homepage: "https://www.norwegian.com/en/booking/",
    buildBookingUrl: homepageOnly("https://www.norwegian.com/en/booking/"),
    deepLinkSupported: false,
    serviceLevel: "low-cost",
    baggageIncludedByDefault: false,
    estimatedBagFeeEurPerLeg: 25,
  },
  sas: {
    id: "sas",
    name: "SAS",
    homepage: "https://www.flysas.com/en/",
    buildBookingUrl: homepageOnly("https://www.flysas.com/en/"),
    deepLinkSupported: false,
    serviceLevel: "full-service",
    baggageIncludedByDefault: false,
    estimatedBagFeeEurPerLeg: 30,
  },
  wideroe: {
    id: "wideroe",
    name: "Widerøe",
    homepage: "https://www.wideroe.no/en",
    buildBookingUrl: homepageOnly("https://www.wideroe.no/en"),
    deepLinkSupported: false,
    serviceLevel: "full-service",
    baggageIncludedByDefault: false,
    estimatedBagFeeEurPerLeg: 25,
  },
  klm: {
    id: "klm",
    name: "KLM",
    homepage: "https://www.klm.com/en-no/flights-from-stavanger",
    buildBookingUrl: homepageOnly("https://www.klm.com/en-no/flights-from-stavanger"),
    deepLinkSupported: false,
    serviceLevel: "full-service",
    baggageIncludedByDefault: false,
    estimatedBagFeeEurPerLeg: 30,
  },
  lufthansa: {
    id: "lufthansa",
    name: "Lufthansa",
    homepage: "https://www.lufthansa.com/no/en/homepage",
    buildBookingUrl: (p) => {
      const slugs: Record<string, string> = { FRA: "frankfurt", MUC: "munich" };
      const slug = slugs[p.to];
      return slug
        ? `https://www.lufthansa.com/lhg/no/en/o-d/cy-cy/stavanger-${slug}`
        : "https://www.lufthansa.com/no/en/homepage";
    },
    deepLinkSupported: false,
    serviceLevel: "full-service",
    baggageIncludedByDefault: false,
    estimatedBagFeeEurPerLeg: 30,
  },
  lot: {
    id: "lot",
    name: "LOT Polish Airlines",
    homepage: "https://www.lot.com/no/en",
    buildBookingUrl: homepageOnly("https://www.lot.com/no/en"),
    deepLinkSupported: false,
    serviceLevel: "full-service",
    baggageIncludedByDefault: false,
    estimatedBagFeeEurPerLeg: 30,
  },
  wizzair: {
    id: "wizzair",
    name: "Wizz Air",
    homepage: "https://wizzair.com/en-gb/",
    buildBookingUrl: (p) =>
      `https://www.wizzair.com/en-gb/booking/select-flight/${p.from}/${p.to}/${p.departDate}/${p.returnDate ?? "null"}/${p.adults}/0/0/null`,
    deepLinkSupported: true,
    serviceLevel: "low-cost",
    baggageIncludedByDefault: false,
    estimatedBagFeeEurPerLeg: 30,
  },
  finnair: {
    id: "finnair",
    name: "Finnair",
    homepage: "https://www.finnair.com/en-int",
    buildBookingUrl: homepageOnly("https://www.finnair.com/en-int"),
    deepLinkSupported: false,
    serviceLevel: "full-service",
    baggageIncludedByDefault: false,
    estimatedBagFeeEurPerLeg: 30,
  },
};

export function getAirline(id: string): Airline | undefined {
  return airlines[id];
}

const airport = (iata: string, city: string, country: string, lat: number, lon: number): Airport => ({
  iata,
  city,
  country,
  lat,
  lon,
});

// Čvorišta aviokompanija koje već lete iz Stavangera - koriste se i kao
// obična evropska destinacija i kao "viaHub" za dugolinijske veze u nastavku.
const AMS = airport("AMS", "Amsterdam", "Holandija", 52.3086, 4.7639);
const FRA = airport("FRA", "Frankfurt", "Nemačka", 50.0379, 8.5622);
const MUC = airport("MUC", "Minhen", "Nemačka", 48.3538, 11.7861);
const CPH = airport("CPH", "Kopenhagen", "Danska", 55.618, 12.656);
const HEL = airport("HEL", "Helsinki", "Finska", 60.3172, 24.9633);
const WAW = airport("WAW", "Varšava", "Poljska", 52.1657, 20.9671);

// Destinacije i aviokompanije koje zaista redovno lete iz Stavangera (SVG/Sola).
// Isključene su "paket" charter destinacije (npr. Rodos, Krit, Palma) koje se
// prodaju samo kroz turističke agencije/pakete, ne kao pojedinačna karta
// direktno kod avio-prevoznika.
export const destinations: Route[] = [
  // Domaće (Norveška)
  { destination: airport("OSL", "Oslo", "Norveška", 60.1939, 11.1004), airlineId: "sas", directFlight: true },
  { destination: airport("OSL", "Oslo", "Norveška", 60.1939, 11.1004), airlineId: "norwegian", directFlight: true },
  { destination: airport("BGO", "Bergen", "Norveška", 60.2934, 5.2181), airlineId: "sas", directFlight: true },
  { destination: airport("BGO", "Bergen", "Norveška", 60.2934, 5.2181), airlineId: "norwegian", directFlight: true },
  { destination: airport("BGO", "Bergen", "Norveška", 60.2934, 5.2181), airlineId: "wideroe", directFlight: true },
  { destination: airport("TRD", "Trondheim", "Norveška", 63.4578, 10.924), airlineId: "sas", directFlight: true },
  { destination: airport("TRD", "Trondheim", "Norveška", 63.4578, 10.924), airlineId: "norwegian", directFlight: true },
  { destination: airport("KRS", "Kristiansand", "Norveška", 58.2042, 8.0853), airlineId: "sas", directFlight: true },
  { destination: airport("KRS", "Kristiansand", "Norveška", 58.2042, 8.0853), airlineId: "norwegian", directFlight: true },
  { destination: airport("TRF", "Sandefjord (Torp)", "Norveška", 59.1867, 10.2586), airlineId: "norwegian", directFlight: true },

  // Redovne međunarodne linije
  { destination: CPH, airlineId: "sas", directFlight: true },
  { destination: CPH, airlineId: "norwegian", directFlight: true },
  { destination: AMS, airlineId: "klm", directFlight: true },
  { destination: FRA, airlineId: "lufthansa", directFlight: true },
  { destination: MUC, airlineId: "lufthansa", directFlight: true },
  { destination: HEL, airlineId: "finnair", directFlight: true },
  { destination: airport("ABZ", "Aberdin", "Ujedinjeno Kraljevstvo", 57.2019, -2.1978), airlineId: "sas", directFlight: true },
  {
    destination: airport("ABZ", "Aberdin", "Ujedinjeno Kraljevstvo", 57.2019, -2.1978),
    airlineId: "wideroe",
    directFlight: true,
  },
  {
    destination: airport("LGW", "London (Gatvik)", "Ujedinjeno Kraljevstvo", 51.1537, -0.1821),
    airlineId: "norwegian",
    directFlight: true,
  },
  { destination: WAW, airlineId: "lot", directFlight: true },
  { destination: airport("KRK", "Krakov", "Poljska", 50.0777, 19.7848), airlineId: "wizzair", directFlight: true },
  { destination: airport("KRK", "Krakov", "Poljska", 50.0777, 19.7848), airlineId: "norwegian", directFlight: true },
  { destination: airport("GDN", "Gdanjsk", "Poljska", 54.3776, 18.4662), airlineId: "wizzair", directFlight: true },

  // Sezonske/odmorišne linije (Norwegian)
  { destination: airport("ALC", "Alikante", "Španija", 38.2822, -0.5582), airlineId: "norwegian", directFlight: true },
  { destination: airport("AGP", "Malaga", "Španija", 36.6749, -4.4991), airlineId: "norwegian", directFlight: true },
  {
    destination: airport("LPA", "Gran Kanarija (Las Palmas)", "Španija", 27.9319, -15.3866),
    airlineId: "norwegian",
    directFlight: true,
  },
  {
    destination: airport("TFS", "Tenerife (Jug)", "Španija", 28.0445, -16.5725),
    airlineId: "norwegian",
    directFlight: true,
  },
  {
    destination: airport("NCE", "Nica", "Francuska", 43.6584, 7.2159),
    airlineId: "norwegian",
    directFlight: true,
    seasonal: true,
    seasonalNote: "leto",
  },
  {
    destination: airport("SPU", "Split", "Hrvatska", 43.5389, 16.298),
    airlineId: "norwegian",
    directFlight: true,
    seasonal: true,
    seasonalNote: "leto",
  },
  {
    destination: airport("DBV", "Dubrovnik", "Hrvatska", 42.5614, 18.2682),
    airlineId: "norwegian",
    directFlight: true,
    seasonal: true,
    seasonalNote: "jun-avgust",
  },
  { destination: airport("PRG", "Prag", "Češka", 50.1008, 14.26), airlineId: "norwegian", directFlight: true },
  {
    destination: airport("AYT", "Antalija", "Turska", 36.8987, 30.8005),
    airlineId: "norwegian",
    directFlight: true,
    seasonal: true,
    seasonalNote: "leto, 1x nedeljno",
  },

  // Svetske destinacije - Stavanger nema sopstvene dugolinijske letove, ali
  // ovih nekoliko aviokompanija prodaje JEDNU kartu (svoj sopstveni kod, ne
  // agencija) sa presedanjem u sopstvenom čvorištu, dalje na sopstvenoj
  // dugolinijskoj mreži. Obeleženo je kao "sa presedanjem", nikad kao
  // direktan let.
  {
    destination: airport("HND", "Tokio", "Japan", 35.5494, 139.7798),
    airlineId: "finnair",
    directFlight: false,
    viaHub: HEL,
  },
  {
    destination: airport("ICN", "Seul", "Južna Koreja", 37.4602, 126.4407),
    airlineId: "lot",
    directFlight: false,
    viaHub: WAW,
  },
  {
    destination: airport("SIN", "Singapur", "Singapur", 1.3644, 103.9915),
    airlineId: "lufthansa",
    directFlight: false,
    viaHub: MUC,
  },
  {
    destination: airport("PVG", "Šangaj", "Kina", 31.1443, 121.8083),
    airlineId: "klm",
    directFlight: false,
    viaHub: AMS,
  },
  {
    destination: airport("HKG", "Hongkong", "Kina", 22.308, 113.9185),
    airlineId: "lufthansa",
    directFlight: false,
    viaHub: FRA,
  },
  {
    destination: airport("BKK", "Bankok", "Tajland", 13.69, 100.7501),
    airlineId: "sas",
    directFlight: false,
    viaHub: CPH,
  },
  {
    destination: airport("BOM", "Mumbaj", "Indija", 19.0887, 72.8679),
    airlineId: "sas",
    directFlight: false,
    viaHub: CPH,
    seasonal: true,
    seasonalNote: "nova linija od okt. 2026",
  },
  {
    destination: airport("JFK", "Njujork", "SAD", 40.6413, -73.7781),
    airlineId: "klm",
    directFlight: false,
    viaHub: AMS,
  },
  {
    destination: airport("IAH", "Hjuston", "SAD", 29.9902, -95.3368),
    airlineId: "lufthansa",
    directFlight: false,
    viaHub: FRA,
  },
  {
    destination: airport("SFO", "San Francisko", "SAD", 37.6213, -122.379),
    airlineId: "lot",
    directFlight: false,
    viaHub: WAW,
  },
  {
    destination: airport("GRU", "Sao Paulo", "Brazil", -23.4356, -46.4731),
    airlineId: "klm",
    directFlight: false,
    viaHub: AMS,
  },
  {
    destination: airport("EZE", "Buenos Ajres", "Argentina", -34.8222, -58.5358),
    airlineId: "klm",
    directFlight: false,
    viaHub: AMS,
  },
  {
    destination: airport("CPT", "Kejptaun", "Južnoafrička Republika", -33.9715, 18.6021),
    airlineId: "klm",
    directFlight: false,
    viaHub: AMS,
    seasonal: true,
    seasonalNote: "uglavnom leto na južnoj hemisferi",
  },
  {
    destination: airport("DXB", "Dubai", "Ujedinjeni Arapski Emirati", 25.2532, 55.3657),
    airlineId: "sas",
    directFlight: false,
    viaHub: CPH,
    seasonal: true,
    seasonalNote: "nova zimska linija 2026/27",
  },
  {
    destination: airport("MEL", "Melburn", "Australija", -37.669, 144.841),
    airlineId: "finnair",
    directFlight: false,
    viaHub: HEL,
    stopsNote: "2 presedanja (Helsinki, Bankok)",
  },
];
