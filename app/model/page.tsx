import { Suspense } from "react";
import ModelAnalysis from "@/components/ModelAnalysis";

export const metadata = {
  title: "Sveobuhvatni finansijski model | Nemvida Finance",
  description:
    "Sveobuhvatan, objektivan model analize za američke i evropske akcije: finansijski trend, rast, filteri rasta i valuacije, konkurentska prednost, rizik, kvalitet menadžmenta, bull/bear debata i finalna sinteza — sve iz merljivih podataka.",
};

export default function ModelPage() {
  return (
    <main className="flex-1 w-full">
      <div className="max-w-4xl mx-auto px-4 pt-8">
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
          Sveobuhvatni finansijski model
        </h1>
        <p className="text-zinc-600 dark:text-zinc-400 mt-1">
          Devet analitičkih dimenzija za američke i evropske akcije — finansijski trend (5 god.), potencijal rasta,
          filter rasta, filter valuacije, konkurentska prednost, analiza rizika, kvalitet menadžmenta, bull vs bear
          debata i finalna sinteza (kupovina/držanje/izbegavanje). Sve iz merljivih podataka, bez subjektivnih ocena.
        </p>
      </div>
      <Suspense fallback={null}>
        <ModelAnalysis />
      </Suspense>
    </main>
  );
}
