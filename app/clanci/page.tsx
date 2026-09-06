import { getAllArticles } from "@/lib/articles";
import ArticleList from "@/components/ArticleList";

export const metadata = {
  title: "Stručni članci — Nemvida Finance",
};

export default function ArticlesPage() {
  const articles = getAllArticles();

  return (
    <main className="flex-1 w-full max-w-4xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50 mb-1">
        Stručni članci
      </h1>
      <p className="text-zinc-600 dark:text-zinc-400 mb-6">
        Besplatne analize i pregledi, dostupni svim čitaocima bez registracije.
        Članci mogu biti na srpskom/hrvatskom, engleskom, norveškom ili
        švedskom jeziku.
      </p>

      {articles.length === 0 ? (
        <p className="text-zinc-500">Trenutno nema objavljenih članaka.</p>
      ) : (
        <ArticleList articles={articles} />
      )}
    </main>
  );
}
