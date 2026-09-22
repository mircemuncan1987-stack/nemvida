import { Suspense } from "react";
import RecommendationsScreener from "@/components/RecommendationsScreener";

export const metadata = {
  title: "Preporuke za portfolio | Nemvida Finance",
  description:
    "Kompanije koje ispunjavaju uslove sveobuhvatnog modela (Kupovina, jaki fundamenti, bez crvenih zastavica) i koje najbolje popunjavaju sektorske praznine u tvom postojećem portfelju.",
};

export default function PreporukePage() {
  return (
    <main className="flex-1 w-full">
      <div className="max-w-5xl mx-auto px-4 pt-8">
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">Preporuke za portfolio</h1>
        <p className="text-zinc-600 dark:text-zinc-400 mt-1">
          Kompanije iz izabranog indeksa koje ispunjavaju uslove kao na pregledu kompanije, a koje već nisu u tvom
          portfelju i najbolje popunjavaju sektorske praznine u njemu.
        </p>
      </div>
      <Suspense fallback={null}>
        <RecommendationsScreener />
      </Suspense>
    </main>
  );
}
