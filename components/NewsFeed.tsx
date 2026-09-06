"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { companies } from "@/lib/companies";
import type { FeedItem } from "@/lib/rss";
import SummaryModal from "@/components/SummaryModal";

const REFRESH_MS = 60_000;

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "upravo sada";
  if (minutes < 60) return `pre ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `pre ${hours} h`;
  const days = Math.floor(hours / 24);
  return `pre ${days} d`;
}

export default function NewsFeed() {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [activeItem, setActiveItem] = useState<FeedItem | null>(null);

  const load = useCallback(async () => {
    try {
      const url = selected ? `/api/news?ticker=${selected}` : "/api/news";
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error("fetch failed");
      const data = await res.json();
      setItems(data.items ?? []);
      setUpdatedAt(data.updatedAt ?? null);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [selected]);

  useEffect(() => {
    setLoading(true);
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  const grouped = useMemo(() => items, [items]);

  return (
    <div className="w-full max-w-4xl mx-auto px-4 py-6">
      <div className="flex flex-wrap gap-2 mb-4">
        <button
          onClick={() => setSelected(null)}
          className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
            selected === null
              ? "bg-blue-600 text-white border-blue-600"
              : "border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:border-blue-400"
          }`}
        >
          Sve kompanije
        </button>
        {companies.map((c) => (
          <button
            key={c.ticker}
            onClick={() => setSelected(c.ticker)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
              selected === c.ticker
                ? "bg-blue-600 text-white border-blue-600"
                : "border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:border-blue-400"
            }`}
          >
            {c.ticker}
          </button>
        ))}
      </div>

      <div className="flex items-center justify-between mb-4 text-sm text-zinc-500 dark:text-zinc-400">
        <span className="flex items-center gap-1.5">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
          </span>
          Automatsko osvežavanje uživo
        </span>
        {updatedAt && <span>Ažurirano: {timeAgo(updatedAt)}</span>}
      </div>

      {error && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 text-amber-800 dark:text-amber-300 px-4 py-3 text-sm mb-4">
          Trenutno ne mogu da učitam najnovije vesti. Pokušaću ponovo automatski.
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="h-20 rounded-lg bg-zinc-200/60 dark:bg-zinc-900/60 animate-pulse"
            />
          ))}
        </div>
      ) : grouped.length === 0 ? (
        <p className="text-zinc-500 dark:text-zinc-400 text-center py-12">
          Trenutno nema dostupnih vesti za izabranu kompaniju.
        </p>
      ) : (
        <ul className="space-y-3">
          {grouped.map((item, idx) => (
            <li key={`${item.link}-${idx}`}>
              <button
                onClick={() => setActiveItem(item)}
                className="block w-full text-left rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/50 backdrop-blur-sm p-4 hover:border-blue-400 dark:hover:border-blue-600 hover:bg-white/90 dark:hover:bg-zinc-900/70 transition-colors"
              >
                <div className="flex items-center gap-2 mb-1.5 text-xs">
                  <span className="font-semibold text-blue-600 dark:text-blue-400">
                    {item.ticker}
                  </span>
                  <span className="text-zinc-400">•</span>
                  <span className="text-zinc-500 dark:text-zinc-400">{item.source}</span>
                  <span className="text-zinc-400">•</span>
                  <span className="text-zinc-500 dark:text-zinc-400">
                    {timeAgo(item.isoDate)}
                  </span>
                </div>
                <h3 className="font-medium text-zinc-900 dark:text-zinc-100 leading-snug">
                  {item.title}
                </h3>
              </button>
            </li>
          ))}
        </ul>
      )}

      {activeItem && (
        <SummaryModal item={activeItem} onClose={() => setActiveItem(null)} />
      )}
    </div>
  );
}
