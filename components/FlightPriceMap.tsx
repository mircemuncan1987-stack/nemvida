"use client";

import { useMemo } from "react";
import { geoNaturalEarth1, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import type { Topology, GeometryCollection } from "topojson-specification";
import landTopologyJson from "world-atlas/land-110m.json";
import { STAVANGER, priceScaleColor } from "@/lib/flightPricing";

const landTopology = landTopologyJson as unknown as Topology<{ land: GeometryCollection }>;

const WIDTH = 960;
const HEIGHT = 500;
const PAD = 28;

function separateOverlappingLabels<T extends { x: number; y: number }>(pts: T[], minDist: number): T[] {
  const out = pts.map((p) => ({ ...p }));
  for (let iter = 0; iter < 60; iter++) {
    let moved = false;
    for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        const dx = out[j].x - out[i].x;
        const dy = out[j].y - out[i].y;
        const dist = Math.hypot(dx, dy);
        if (dist < minDist) {
          moved = true;
          const push = (minDist - dist) / 2 || minDist / 2;
          const ux = dist > 0.01 ? dx / dist : 1;
          const uy = dist > 0.01 ? dy / dist : 0;
          out[i].x -= ux * push;
          out[i].y -= uy * push;
          out[j].x += ux * push;
          out[j].y += uy * push;
        }
      }
    }
    if (!moved) break;
  }
  return out;
}

export type MapPoint = {
  iata: string;
  city: string;
  lat: number;
  lon: number;
  cheapestTotal: number;
  airlineName: string;
};

export default function FlightPriceMap({
  points,
  selectedIata,
  onSelect,
}: {
  points: MapPoint[];
  selectedIata: string | null;
  onSelect: (iata: string) => void;
}) {
  const { landPath, projected, min, max } = useMemo(() => {
    const pointFeatures = [
      { type: "Feature" as const, properties: {}, geometry: { type: "Point" as const, coordinates: [STAVANGER.lon, STAVANGER.lat] } },
      ...points.map((p) => ({
        type: "Feature" as const,
        properties: {},
        geometry: { type: "Point" as const, coordinates: [p.lon, p.lat] },
      })),
    ];
    const fc = { type: "FeatureCollection" as const, features: pointFeatures };

    const projection = geoNaturalEarth1().fitExtent(
      [
        [PAD, PAD],
        [WIDTH - PAD, HEIGHT - PAD],
      ],
      fc
    );

    const land = feature(landTopology, landTopology.objects.land);
    const pathGen = geoPath(projection);
    const landPath = pathGen(land) ?? "";

    const rawProjected = points
      .map((p) => {
        const xy = projection([p.lon, p.lat]);
        if (!xy) return null;
        return { ...p, x: xy[0], y: xy[1] };
      })
      .filter((p): p is NonNullable<typeof p> => p !== null);

    // Oznake koje su geografski blizu (npr. Gran Kanarija/Tenerife) bi se inače
    // potpuno preklopile - lagano ih razmičemo da cena/naziv ostanu čitljivi.
    const projected = separateOverlappingLabels(rawProjected, 28);

    const prices = points.map((p) => p.cheapestTotal);
    const min = prices.length ? Math.min(...prices) : 0;
    const max = prices.length ? Math.max(...prices) : 0;

    return { landPath, projected, min, max };
  }, [points]);

  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/40 p-4">
      <div className="relative w-full" style={{ aspectRatio: `${WIDTH} / ${HEIGHT}` }}>
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="absolute inset-0 w-full h-full" aria-hidden="true">
          <path d={landPath} className="fill-zinc-200 dark:fill-zinc-800" />
        </svg>

        {projected.map((p) => {
          const t = max > min ? (p.cheapestTotal - min) / (max - min) : 0;
          const color = priceScaleColor(t);
          const isSelected = selectedIata === p.iata;
          return (
            <button
              key={p.iata}
              type="button"
              onClick={() => onSelect(p.iata)}
              className="group absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-0.5 cursor-pointer"
              style={{ left: `${(p.x / WIDTH) * 100}%`, top: `${(p.y / HEIGHT) * 100}%` }}
              title={`${p.city}: od ${p.cheapestTotal} € (${p.airlineName})`}
            >
              <span
                className={`block rounded-full border-2 border-white dark:border-zinc-950 shadow ${
                  isSelected ? "w-4 h-4 ring-2 ring-blue-500" : "w-3 h-3"
                }`}
                style={{ backgroundColor: color }}
              />
              <span
                className={`text-[10px] leading-tight font-semibold px-1 rounded bg-white/90 dark:bg-zinc-950/90 text-zinc-900 dark:text-zinc-100 whitespace-nowrap ${
                  isSelected ? "ring-1 ring-blue-500" : ""
                }`}
              >
                {p.cheapestTotal}&nbsp;€
              </span>
              <span className="hidden group-hover:block text-[10px] text-zinc-600 dark:text-zinc-400 whitespace-nowrap absolute top-full mt-1 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded px-1.5 py-0.5 shadow z-10">
                {p.city} · {p.airlineName}
              </span>
            </button>
          );
        })}

        <div className="absolute left-2 bottom-2 flex items-center gap-2 bg-white/90 dark:bg-zinc-950/90 rounded-lg px-2 py-1 border border-zinc-200 dark:border-zinc-700">
          <span className="text-[10px] text-zinc-600 dark:text-zinc-400">jeftinije</span>
          <span
            className="w-16 h-2 rounded-full"
            style={{
              background: `linear-gradient(to right, ${priceScaleColor(0)}, ${priceScaleColor(0.5)}, ${priceScaleColor(1)})`,
            }}
          />
          <span className="text-[10px] text-zinc-600 dark:text-zinc-400">skuplje</span>
        </div>
      </div>
      <p className="text-xs text-zinc-500 dark:text-zinc-500 mt-2">
        Klikni na destinaciju na mapi da vidiš detalje i link za rezervaciju. Cene su procene za izabrane datume i broj
        putnika (najjeftinija aviokompanija po destinaciji).
      </p>
    </div>
  );
}
