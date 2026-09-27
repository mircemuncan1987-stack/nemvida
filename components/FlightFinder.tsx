"use client";

import { useMemo, useRef, useState } from "react";
import { destinations, getAirline } from "@/lib/flights";
import { estimateFare, formatNok, type FareEstimate } from "@/lib/flightPricing";
import FlightPriceMap from "./FlightPriceMap";

function toInputDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function fromInputDate(s: string): Date {
  return new Date(`${s}T12:00:00`);
}

function addDays(d: Date, days: number): Date {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + days);
  return copy;
}

type Option = {
  airlineId: string;
  airlineName: string;
  homepage: string;
  fare: FareEstimate;
  directFlight: boolean;
  seasonal?: boolean;
  seasonalNote?: string;
  bookingUrl: string;
  deepLinkSupported: boolean;
  baggageAddedFee: number;
};

export default function FlightFinder() {
  const today = useMemo(() => new Date(), []);
  const defaultDepart = useMemo(() => addDays(today, 42), [today]);
  const defaultReturn = useMemo(() => addDays(defaultDepart, 7), [defaultDepart]);

  const [destinationIata, setDestinationIata] = useState<string>("");
  const [departDateStr, setDepartDateStr] = useState(toInputDate(defaultDepart));
  const [oneWay, setOneWay] = useState(false);
  const [returnDateStr, setReturnDateStr] = useState(toInputDate(defaultReturn));
  const [adults, setAdults] = useState(2);

  const detailRef = useRef<HTMLDivElement | null>(null);

  const departDate = useMemo(() => fromInputDate(departDateStr), [departDateStr]);
  const returnDate = useMemo(() => (oneWay ? null : fromInputDate(returnDateStr)), [oneWay, returnDateStr]);

  const sortedDestinations = useMemo(() => {
    const byIata = new Map<string, (typeof destinations)[number]["destination"]>();
    for (const route of destinations) byIata.set(route.destination.iata, route.destination);
    return [...byIata.values()].sort((a, b) => a.city.localeCompare(b.city, "sr"));
  }, []);

  // Grupisano po destinaciji: sve avio-opcije, sortirane po ceni.
  const groups = useMemo(() => {
    const byIata = new Map<string, { destination: (typeof destinations)[number]["destination"]; options: Option[] }>();

    for (const route of destinations) {
      const airline = getAirline(route.airlineId);
      if (!airline) continue;
      const fare = estimateFare({
        destination: route.destination,
        departDate,
        returnDate,
        adults,
        airline,
        today,
      });
      const bookingUrl = airline.buildBookingUrl({
        from: "SVG",
        to: route.destination.iata,
        departDate: departDateStr,
        returnDate: oneWay ? undefined : returnDateStr,
        adults,
      });

      const option: Option = {
        airlineId: airline.id,
        airlineName: airline.name,
        homepage: airline.homepage,
        fare,
        directFlight: route.directFlight,
        seasonal: route.seasonal,
        seasonalNote: route.seasonalNote,
        bookingUrl,
        deepLinkSupported: airline.deepLinkSupported,
        baggageAddedFee: fare.baggageFeeAddedPerPassenger,
      };

      const key = route.destination.iata;
      if (!byIata.has(key)) byIata.set(key, { destination: route.destination, options: [] });
      byIata.get(key)!.options.push(option);
    }

    for (const g of byIata.values()) {
      g.options.sort((a, b) => a.fare.partyTotal - b.fare.partyTotal);
    }

    return byIata;
  }, [departDate, returnDate, adults, departDateStr, returnDateStr, oneWay, today]);

  const mapPoints = useMemo(
    () =>
      [...groups.values()].map((g) => ({
        iata: g.destination.iata,
        city: g.destination.city,
        lat: g.destination.lat,
        lon: g.destination.lon,
        cheapestTotal: g.options[0]?.fare.partyTotal ?? 0,
        airlineName: g.options[0]?.airlineName ?? "",
      })),
    [groups]
  );

  const selectedGroup = destinationIata ? groups.get(destinationIata) : null;

  const handleSelect = (iata: string) => {
    setDestinationIata(iata);
    requestAnimationFrame(() => detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/40 p-4 sm:p-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          <label className="flex flex-col gap-1 lg:col-span-2">
            <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">Iz</span>
            <input
              disabled
              value="Stavanger (SVG)"
              className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800 px-3 py-2 text-sm text-zinc-500 dark:text-zinc-400"
            />
          </label>

          <label className="flex flex-col gap-1 lg:col-span-2">
            <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">Destinacija</span>
            <select
              value={destinationIata}
              onChange={(e) => setDestinationIata(e.target.value)}
              className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100"
            >
              <option value="">— Sve destinacije (uporedi sve) —</option>
              {sortedDestinations.map((d) => (
                <option key={d.iata} value={d.iata}>
                  {d.city} ({d.iata})
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-2 mt-5">
            <input type="checkbox" checked={oneWay} onChange={(e) => setOneWay(e.target.checked)} className="w-4 h-4" />
            <span className="text-sm text-zinc-700 dark:text-zinc-300">Samo u jednom pravcu</span>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">Datum polaska</span>
            <input
              type="date"
              value={departDateStr}
              min={toInputDate(today)}
              onChange={(e) => setDepartDateStr(e.target.value)}
              className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">Datum povratka</span>
            <input
              type="date"
              value={returnDateStr}
              min={departDateStr}
              disabled={oneWay}
              onChange={(e) => setReturnDateStr(e.target.value)}
              className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 disabled:opacity-50"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">Broj putnika</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setAdults((n) => Math.max(1, n - 1))}
                className="w-8 h-8 rounded-lg border border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                aria-label="Manje putnika"
              >
                −
              </button>
              <span className="w-8 text-center text-sm font-semibold text-zinc-900 dark:text-zinc-100">{adults}</span>
              <button
                type="button"
                onClick={() => setAdults((n) => Math.min(9, n + 1))}
                className="w-8 h-8 rounded-lg border border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                aria-label="Više putnika"
              >
                +
              </button>
            </div>
          </label>
        </div>
      </div>

      <div className="rounded-xl border border-blue-200 dark:border-blue-900/60 bg-blue-50 dark:bg-blue-950/30 px-4 py-3 text-sm text-blue-900 dark:text-blue-200">
        Prikazane cene su <strong>procene</strong> (na osnovu udaljenosti, sezone i koliko dana unapred kupuješ
        kartu) — <strong>nisu uživo cene</strong> iz sistema aviokompanija. Uvek uključuju procenu predatog kofera.
        Klikni „Proveri i rezerviši“ da vidiš tačnu cenu i kupiš kartu <strong>direktno kod aviokompanije</strong>,
        bez posrednika.
      </div>

      {mapPoints.length > 0 && (
        <FlightPriceMap points={mapPoints} selectedIata={destinationIata || null} onSelect={handleSelect} />
      )}

      <div ref={detailRef} className="scroll-mt-20">
        {selectedGroup ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-50">
                Stavanger (SVG) → {selectedGroup.destination.city} ({selectedGroup.destination.iata})
              </h2>
              <button
                type="button"
                onClick={() => setDestinationIata("")}
                className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
              >
                ← Sve destinacije
              </button>
            </div>
            <div className="space-y-3">
              {selectedGroup.options.map((opt) => (
                <OptionCard key={opt.airlineId} option={opt} adults={adults} />
              ))}
            </div>
          </div>
        ) : (
          <div className="text-center py-10 text-zinc-500 dark:text-zinc-400">
            <p className="text-sm">
              Okreni globus prevlačenjem i klikni na destinaciju da vidiš cenu i link za rezervaciju — ili je izaberi
              iz padajuće liste iznad.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function OptionCard({ option, adults }: { option: Option; adults: number }) {
  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/40 p-4 flex flex-col sm:flex-row sm:items-center gap-4">
      <div className="flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-zinc-900 dark:text-zinc-50">{option.airlineName}</span>
          <Badge tone="neutral">{option.directFlight ? "Direktan let" : "Sa presedanjem"}</Badge>
          <Badge tone="good">Predati kofer uključen</Badge>
          {option.seasonal && <Badge tone="warning">Sezonski let{option.seasonalNote ? ` — ${option.seasonalNote}` : ""}</Badge>}
        </div>
        <div className="mt-2 text-3xl font-bold text-zinc-900 dark:text-zinc-50">{formatNok(option.fare.partyTotal)}</div>
        <div className="text-xs text-zinc-500 dark:text-zinc-400">
          {formatNok(Math.round(option.fare.partyTotal / adults))} po putniku · procena za {adults}{" "}
          {adults === 1 ? "putnika" : "putnika"}
          {option.baggageAddedFee > 0 && (
            <> · uključili smo procenjenih {formatNok(option.baggageAddedFee)} za predati kofer (aviokompanija ga inače ne uključuje po defaultu)</>
          )}
        </div>
        {!option.deepLinkSupported && (
          <div className="text-xs text-amber-700 dark:text-amber-400 mt-1">
            Link vodi na sajt aviokompanije — proveri tačan datum i broj putnika direktno tamo.
          </div>
        )}
      </div>
      <a
        href={option.bookingUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="shrink-0 inline-flex items-center justify-center rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-4 py-2.5 transition-colors"
      >
        Proveri i rezerviši kod {option.airlineName}
      </a>
    </div>
  );
}

function Badge({ tone, children }: { tone: "neutral" | "good" | "warning"; children: React.ReactNode }) {
  const toneClasses =
    tone === "good"
      ? "bg-green-100 text-green-800 dark:bg-green-950/50 dark:text-green-400"
      : tone === "warning"
        ? "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-400"
        : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300";
  return <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${toneClasses}`}>{children}</span>;
}
