"use client";

import { useEffect, useState } from "react";
import type { FeedItem } from "@/lib/rss";

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

export default function SummaryModal({
  item,
  onClose,
}: {
  item: FeedItem;
  onClose: () => void;
}) {
  const [summary, setSummary] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setSummary(null);

    (async () => {
      try {
        const res = await fetch(`/api/summarize?url=${encodeURIComponent(item.link)}`);
        const data = await res.json();
        if (cancelled) return;
        if (data.summary) {
          setSummary(data.summary);
          setNote("Automatski rezime na osnovu teksta izvornog članka.");
        } else if (item.description) {
          setSummary(item.description);
          setNote(
            "Nije bilo moguće preuzeti ceo tekst članka — prikazan je kratak izvod dostupan uz vest."
          );
        } else {
          setSummary("Rezime trenutno nije dostupan za ovaj članak.");
          setNote("Otvori originalni članak za pun tekst.");
        }
      } catch {
        if (cancelled) return;
        if (item.description) {
          setSummary(item.description);
          setNote(
            "Sajt izvora ne dozvoljava automatsko preuzimanje teksta — prikazan je kratak izvod dostupan uz vest."
          );
        } else {
          setSummary("Nije moguće učitati rezime za ovaj članak.");
          setNote("Otvori originalni članak za pun tekst.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [item.link, item.description]);

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-start justify-center p-6 sm:p-10 overflow-y-auto z-50"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white/90 dark:bg-zinc-900/90 backdrop-blur-md border border-zinc-200 dark:border-zinc-800 rounded-xl max-w-xl w-full p-6">
        <div className="text-xs text-zinc-500 dark:text-zinc-400 mb-2">
          <span className="font-semibold text-blue-600 dark:text-blue-400">
            {item.ticker}
          </span>{" "}
          • {item.source} • {timeAgo(item.isoDate)}
        </div>
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50 leading-snug mb-4">
          {item.title}
        </h2>
        <div className="text-xs font-bold uppercase tracking-wide text-blue-600 dark:text-blue-400 mb-2">
          Rezime
        </div>
        <div className="text-sm leading-relaxed text-zinc-800 dark:text-zinc-200 whitespace-pre-line">
          {loading ? (
            <span className="inline-flex items-center gap-2 text-zinc-500">
              <span className="h-4 w-4 rounded-full border-2 border-zinc-300 dark:border-zinc-700 border-t-blue-600 animate-spin" />
              Preuzimam i analiziram tekst članka...
            </span>
          ) : (
            summary
          )}
        </div>
        {!loading && note && (
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-3">{note}</p>
        )}
        <div className="flex flex-wrap gap-2 mt-5">
          <a
            href={item.link}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="px-4 py-2 rounded-lg text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700 transition-colors"
          >
            Pročitaj ceo originalni članak
          </a>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm font-semibold border border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          >
            Zatvori
          </button>
        </div>
      </div>
    </div>
  );
}
