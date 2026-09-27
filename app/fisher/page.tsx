import { Suspense } from "react";
import FisherAnalysis from "@/components/FisherAnalysis";

export const metadata = {
  title: "Fišerov checklist (15 pitanja) | Nemvida Finance",
  description:
    "Checklist Fišerovih (Philip Fisher) 15 kvalitativnih pitanja iz knjige Common Stocks and Uncommon Profits, prevedenih na srpski — unapred popunjen za oko 100 najvećih S&P 500 kompanija, uz mogućnost da izmeniš bilo koji odgovor.",
};

export default function FisherPage() {
  return (
    <main className="flex-1 w-full">
      <div className="max-w-3xl mx-auto px-4 pt-8">
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">Fišerov checklist</h1>
        <p className="text-zinc-600 dark:text-zinc-400 mt-1">
          Unesi ticker — otvara se checklist Fišerovih (Philip Fisher) 15 pitanja iz knjige &quot;Common Stocks and
          Uncommon Profits&quot;. Za oko 100 najvećih S&P 500 kompanija odgovori su unapred popunjeni iz baze; za
          ostale kreneš od praznog checklist-a. Sve se čuva lokalno po tikeru, i sve možeš izmeniti.
        </p>
      </div>
      <Suspense fallback={null}>
        <FisherAnalysis />
      </Suspense>
    </main>
  );
}
