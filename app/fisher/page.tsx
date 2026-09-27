import { Suspense } from "react";
import FisherAnalysis from "@/components/FisherAnalysis";

export const metadata = {
  title: "Fišerova analiza (15 pitanja) | Nemvida Finance",
  description:
    "AI analiza kompanije kroz Fišerovih (Philip Fisher) 15 kvalitativnih pitanja iz knjige Common Stocks and Uncommon Profits — jedina stranica na sajtu koja koristi slobodan AI tekst umesto fiksnih pravila.",
};

export default function FisherPage() {
  return (
    <main className="flex-1 w-full">
      <div className="max-w-3xl mx-auto px-4 pt-8">
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">Fišerova analiza</h1>
        <p className="text-zinc-600 dark:text-zinc-400 mt-1">
          Unesi ticker — AI (Claude) odgovara na Fišerovih (Philip Fisher) 15 pitanja iz knjige &quot;Common Stocks
          and Uncommon Profits&quot; i zaključuje da li bi Fišer kupio ovu akciju.
        </p>
      </div>
      <Suspense fallback={null}>
        <FisherAnalysis />
      </Suspense>
    </main>
  );
}
