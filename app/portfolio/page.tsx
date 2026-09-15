import { Suspense } from "react";
import PortfolioAnalysis from "@/components/PortfolioAnalysis";

export const metadata = {
  title: "Moj portfolio | Nemvida Finance",
  description:
    "Analiza sopstvenog portfelja: sud po poziciji iz sveobuhvatnog modela, koncentracija i diverzifikacija, tehnički pregled, stres-test i poređenje sa SPY.",
};

export default function PortfolioPage() {
  return (
    <main className="flex-1 w-full">
      <div className="max-w-5xl mx-auto px-4 pt-8">
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">Moj portfolio</h1>
        <p className="text-zinc-600 dark:text-zinc-400 mt-1">
          Unesi (ili uvezi iz izveštaja brokera) svoje pozicije — svaka akcija se ocenjuje istim sveobuhvatnim modelom
          kao na /model, uz koncentraciju, tehnički pregled, stres-test i poređenje ukupnog prinosa sa SPY na nivou
          celog portfelja.
        </p>
      </div>
      <Suspense fallback={null}>
        <PortfolioAnalysis />
      </Suspense>
    </main>
  );
}
