"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { ArticleMeta } from "@/lib/articles";
import type { ArticleLang } from "@/lib/articleLangs";
import { LANG_LABELS } from "@/lib/articleLangs";

export default function ArticleList({ articles }: { articles: ArticleMeta[] }) {
  const [lang, setLang] = useState<ArticleLang | "all">("all");

  const langsPresent = useMemo(() => {
    const set = new Set(articles.map((a) => a.lang));
    return Array.from(set);
  }, [articles]);

  const filtered = lang === "all" ? articles : articles.filter((a) => a.lang === lang);

  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-6">
        <button
          onClick={() => setLang("all")}
          className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
            lang === "all"
              ? "bg-blue-600 text-white border-blue-600"
              : "border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:border-blue-400"
          }`}
        >
          Svi jezici
        </button>
        {langsPresent.map((l) => (
          <button
            key={l}
            onClick={() => setLang(l)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
              lang === l
                ? "bg-blue-600 text-white border-blue-600"
                : "border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:border-blue-400"
            }`}
          >
            {LANG_LABELS[l]}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <p className="text-zinc-500">Nema članaka na izabranom jeziku.</p>
      ) : (
        <ul className="space-y-4">
          {filtered.map((article) => (
            <li key={article.slug}>
              <Link
                href={`/clanci/${article.slug}`}
                className="block rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/50 backdrop-blur-sm p-4 hover:border-blue-400 dark:hover:border-blue-600 hover:bg-white/90 dark:hover:bg-zinc-900/70 transition-colors"
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-semibold px-2 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300">
                    {LANG_LABELS[article.lang]}
                  </span>
                </div>
                <h2 className="font-semibold text-lg text-zinc-900 dark:text-zinc-50">
                  {article.title}
                </h2>
                <p className="text-sm text-zinc-500 mt-1">
                  {article.author} {article.date && `• ${article.date}`}
                </p>
                {article.excerpt && (
                  <p className="text-zinc-600 dark:text-zinc-400 mt-2">
                    {article.excerpt}
                  </p>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
