import { Suspense } from "react";
import Sp500Screener from "@/components/Sp500Screener";

export const metadata = {
  title: "Skener indeksa — S&P 500, Dow, Nasdaq-100 | Nemvida Finance",
  description:
    "Automatska procena fer vrednosti za kompanije iz S&P 500, Dow Jones i Nasdaq-100 indeksa, sortirano po tome koliko su potcenjene ili precenjene.",
};

export default function ListaPage() {
  return (
    <main className="flex-1 w-full">
      <div className="max-w-5xl mx-auto px-4 pt-8">
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
          Skener indeksa
        </h1>
        <p className="text-zinc-600 dark:text-zinc-400 mt-1">
          Automatska procena fer vrednosti za S&P 500, Dow Jones i Nasdaq-100 — isti model kao na stranici za
          procenu vrednosti, primenjen na ceo indeks odjednom, sortirano po tome koliko je akcija potcenjena.
        </p>
      </div>
      <Suspense fallback={null}>
        <Sp500Screener />
      </Suspense>
    </main>
  );
}
