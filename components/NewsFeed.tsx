"use client";

import { useState } from "react";
import { companies, findCompany } from "@/lib/companies";
import NewsDigestView from "@/components/NewsDigestView";

// Stranica Vesti: umesto liste članaka (većina je iza pretplate), za
// izabranu kompaniju — ili sve zajedno — prikazuje se sintetizovani rezime
// najvažnijih vesti i signala (vidi lib/newsDigest.ts). Izvori su i dalje
// dostupni ispod rezimea, sklopljeni.
export default function NewsFeed() {
  const [selected, setSelected] = useState<string | null>(null);
  const company = selected ? findCompany(selected) : null;

  const pill = (active: boolean) =>
    `px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
      active ? "bg-blue-600 text-white border-blue-600" : "border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:border-blue-400"
    }`;

  return (
    <div className="w-full max-w-4xl mx-auto px-4 py-6">
      <div className="flex flex-wrap gap-2 mb-5">
        <button onClick={() => setSelected(null)} className={pill(selected === null)}>
          Sve kompanije
        </button>
        {companies.map((c) => (
          <button key={c.ticker} onClick={() => setSelected(c.ticker)} className={pill(selected === c.ticker)} title={c.displayName}>
            {c.ticker}
          </button>
        ))}
      </div>

      <NewsDigestView
        scope="company"
        ticker={selected}
        title={company ? `${company.displayName} — rezime vesti` : "Sve praćene kompanije — rezime vesti"}
      />
    </div>
  );
}
