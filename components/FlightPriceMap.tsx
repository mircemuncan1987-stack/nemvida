"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { geoOrthographic, geoPath, geoDistance, type GeoPermissibleObjects } from "d3-geo";
import { feature } from "topojson-client";
import type { Topology, GeometryCollection } from "topojson-specification";
import landTopologyJson from "world-atlas/land-110m.json";
import { STAVANGER, priceScaleColor, formatNok } from "@/lib/flightPricing";

const landTopology = landTopologyJson as unknown as Topology<{ land: GeometryCollection }>;

const SIZE = 720;
const PAD = 26;
const RADIUS = SIZE / 2 - PAD;
const DRAG_SENSITIVITY = 75 / RADIUS; // stepeni po pikselu, standardna d3 formula za globus

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
  const [rotation, setRotation] = useState<[number, number]>([-STAVANGER.lon, -STAVANGER.lat]);
  const dragRef = useRef<{ startX: number; startY: number; start: [number, number]; dragging: boolean } | null>(null);
  const pointsRef = useRef(points);
  useEffect(() => {
    pointsRef.current = points;
  }, [points]);

  // Kad se destinacija izabere (npr. iz padajuće liste), okreni globus da je centrira.
  useEffect(() => {
    if (!selectedIata) return;
    const p = pointsRef.current.find((pt) => pt.iata === selectedIata);
    if (p) setRotation([-p.lon, -p.lat]);
  }, [selectedIata]);

  const projection = useMemo(
    () =>
      geoOrthographic()
        .scale(RADIUS)
        .translate([SIZE / 2, SIZE / 2])
        .rotate(rotation)
        .clipAngle(90),
    [rotation]
  );

  const { spherePath, landPath, projected, min, max } = useMemo(() => {
    const pathGen = geoPath(projection);
    const spherePath = pathGen({ type: "Sphere" } as GeoPermissibleObjects) ?? "";
    const land = feature(landTopology, landTopology.objects.land);
    const landPath = pathGen(land) ?? "";

    const center: [number, number] = [-rotation[0], -rotation[1]];
    const visible = points.filter((p) => geoDistance([p.lon, p.lat], center) < Math.PI / 2 - 0.04);

    const rawProjected = visible
      .map((p) => {
        const xy = projection([p.lon, p.lat]);
        if (!xy) return null;
        return { ...p, x: xy[0], y: xy[1] };
      })
      .filter((p): p is NonNullable<typeof p> => p !== null);

    const projected = separateOverlappingLabels(rawProjected, 32);

    const prices = points.map((p) => p.cheapestTotal);
    const min = prices.length ? Math.min(...prices) : 0;
    const max = prices.length ? Math.max(...prices) : 0;

    return { spherePath, landPath, projected, min, max };
  }, [projection, points, rotation]);

  // Rukovanje se hvata na CELOM kontejneru (i mapa i oznake iznad nje), da
  // prevlačenje radi čak i kad prst/kursor krene tačno sa neke oznake.
  // Tap (bez pomeranja) na oznaci bira destinaciju; pomeranje rotira globus.
  const onPointerDown = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      dragRef.current = { startX: e.clientX, startY: e.clientY, start: rotation, dragging: false };
    },
    [rotation]
  );

  const onPointerMove = useCallback((e: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (!drag.dragging && Math.hypot(dx, dy) > 4) {
      drag.dragging = true;
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    if (drag.dragging) {
      const nextLambda = drag.start[0] + dx * DRAG_SENSITIVITY;
      const nextPhi = Math.max(-90, Math.min(90, drag.start[1] - dy * DRAG_SENSITIVITY));
      setRotation([nextLambda, nextPhi]);
    }
  }, []);

  const onPointerUp = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (drag && !drag.dragging) {
        const target = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
        const markerEl = target?.closest<HTMLElement>("[data-iata]");
        if (markerEl?.dataset.iata) onSelect(markerEl.dataset.iata);
      }
      if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
      dragRef.current = null;
    },
    [onSelect]
  );

  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/40 p-4">
      <div
        className="relative mx-auto touch-none cursor-grab active:cursor-grabbing select-none"
        style={{ width: "100%", maxWidth: SIZE, aspectRatio: "1 / 1" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="absolute inset-0 w-full h-full">
          <path d={spherePath} className="fill-sky-50 dark:fill-zinc-950" />
          <path d={landPath} className="fill-zinc-300 dark:fill-zinc-700" />
          <path d={spherePath} fill="none" className="stroke-zinc-300 dark:stroke-zinc-700" strokeWidth={1.5} />
        </svg>

        {projected.map((p) => {
          const t = max > min ? (p.cheapestTotal - min) / (max - min) : 0;
          const color = priceScaleColor(t);
          const isSelected = selectedIata === p.iata;
          return (
            <button
              key={p.iata}
              type="button"
              data-iata={p.iata}
              onClick={() => onSelect(p.iata)}
              className="group absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-0.5 cursor-pointer"
              style={{ left: `${((p.x / SIZE) * 100).toFixed(4)}%`, top: `${((p.y / SIZE) * 100).toFixed(4)}%` }}
              title={`${p.city}: od ${formatNok(p.cheapestTotal)} (${p.airlineName})`}
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
                {formatNok(p.cheapestTotal)}
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
      <p className="text-xs text-zinc-500 dark:text-zinc-500 mt-2 text-center">
        Prevuci globus da ga okrećeš, i klikni na destinaciju da vidiš detalje i link za rezervaciju. Cene su procene
        za izabrane datume i broj putnika (najjeftinija aviokompanija po destinaciji).
      </p>
    </div>
  );
}
