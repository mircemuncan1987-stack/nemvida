import { Suspense } from "react";
import CompareTickers from "@/components/CompareTickers";

export const metadata = {
  title: "Uporedi kompanije | Nemvida Finance",
  description:
    "Uporedi do 5 kompanija koje sam izabereš, jedno pored drugog — isti sveobuhvatni model kao na pregledu kompanije, sa istaknutom najboljom vrednošću u svakom redu.",
};

export default function UporediPage() {
  return (
    <main className="flex-1 w-full">
      <div className="max-w-5xl mx-auto px-4 pt-8">
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">Uporedi kompanije</h1>
        <p className="text-zinc-600 dark:text-zinc-400 mt-1">
          Unesi do 5 tikera (npr. direktne konkurente) i uporedi ih jedno pored drugog — isti sveobuhvatni model kao
          na pregledu kompanije.
        </p>
      </div>
      <Suspense fallback={null}>
        <CompareTickers />
      </Suspense>
    </main>
  );
}
