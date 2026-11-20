import NewsFeed from "@/components/NewsFeed";

export default function Home() {
  return (
    <main className="flex-1 w-full">
      <div className="max-w-4xl mx-auto px-4 pt-8">
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
          Vesti o kompanijama
        </h1>
        <p className="text-zinc-600 dark:text-zinc-400 mt-1">
          Rezime najvažnijih vesti i signala za kompanije koje pratiš — Visa,
          Mastercard, American Express, Nvidia, Amazon, Meta, Alphabet,
          Microsoft, Merck, TSMC i Investor AB — umesto liste članaka.
        </p>
      </div>
      <NewsFeed />
    </main>
  );
}
