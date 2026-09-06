import { notFound } from "next/navigation";
import { getArticle, getAllArticles, LANG_LABELS } from "@/lib/articles";

export function generateStaticParams() {
  return getAllArticles().map((a) => ({ slug: a.slug }));
}

export default async function ArticlePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const article = getArticle(slug);
  if (!article) notFound();

  return (
    <main className="flex-1 w-full max-w-3xl mx-auto px-4 py-8">
      <span className="text-xs font-semibold px-2 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300">
        {LANG_LABELS[article.lang]}
      </span>
      <h1 className="text-3xl font-bold text-zinc-900 dark:text-zinc-50 mt-2">
        {article.title}
      </h1>
      <p className="text-sm text-zinc-500 mt-2 mb-8">
        {article.author} {article.date && `• ${article.date}`}
      </p>
      <div
        className="prose dark:prose-invert max-w-none prose-zinc"
        dangerouslySetInnerHTML={{ __html: article.html }}
      />
    </main>
  );
}
