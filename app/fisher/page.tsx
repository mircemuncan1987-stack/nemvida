import { Suspense } from "react";
import FisherAnalysis from "@/components/FisherAnalysis";

export const metadata = {
  title: "Fišerov checklist (15 pitanja) | Nemvida Finance",
  description:
    "Checklist Fišerovih (Philip Fisher) 15 kvalitativnih pitanja iz knjige Common Stocks and Uncommon Profits, prevedenih na srpski, za sopstveno istraživanje po tikeru — bez AI-generisanih odgovora.",
};

export default function FisherPage() {
  return (
    <main className="flex-1 w-full">
      <div className="max-w-3xl mx-auto px-4 pt-8">
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">Fišerov checklist</h1>
        <p className="text-zinc-600 dark:text-zinc-400 mt-1">
          Unesi ticker — otvara se checklist Fišerovih (Philip Fisher) 15 pitanja iz knjige &quot;Common Stocks and
          Uncommon Profits&quot;, za tvoje sopstvene odgovore i zaključak. Čuva se lokalno po tikeru.
        </p>
      </div>
      <Suspense fallback={null}>
        <FisherAnalysis />
      </Suspense>
    </main>
  );
}
