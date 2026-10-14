import { Suspense } from "react";
import WatchlistAnalysis from "@/components/WatchlistAnalysis";

export const metadata = {
  title: "Watchlist | Nemvida Finance",
  description:
    "Lista akcija koje pratiš — procena da li je trenutna cena atraktivna ili skupa, naspram sopstvene istorijske norme svake kompanije i potencijala rasta.",
};

export default function WatchlistPage() {
  return (
    <main className="flex-1 w-full">
      <div className="max-w-4xl mx-auto px-4 pt-8">
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">Watchlist</h1>
        <p className="text-zinc-600 dark:text-zinc-400 mt-1">
          Akcije koje pratiš (ne nužno poseduješ) — procena da li je trenutna cena atraktivna ili skupa, po drugačijoj metodologiji od /portfolio.
        </p>
      </div>
      <Suspense fallback={null}>
        <WatchlistAnalysis />
      </Suspense>
    </main>
  );
}
