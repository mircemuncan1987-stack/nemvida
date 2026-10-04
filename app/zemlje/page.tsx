import { Suspense } from "react";
import CountryOverview from "@/components/CountryOverview";

export const metadata = {
  title: "Ekonomije zemalja | Nemvida Finance",
  description:
    "Uporedi ekonomske performanse zemalja sveta — rast BDP-a, inflacija, nezaposlenost, javni dug, spoljni bilans i nejednakost, iz besplatne javne baze World Bank, sa zelenim i crvenim signalima kao na pregledu kompanije.",
};

export default function ZemljePage() {
  return (
    <main className="flex-1 w-full">
      <div className="max-w-4xl mx-auto px-4 pt-8">
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">Ekonomije zemalja</h1>
        <p className="text-zinc-600 dark:text-zinc-400 mt-1">
          Unesi naziv zemlje — najvažniji makroekonomski pokazatelji (World Bank, besplatna javna baza), grupisani po
          dimenzijama uz zelene i crvene signale, isti princip kao na Pregledu kompanije.
        </p>
      </div>
      <Suspense fallback={null}>
        <CountryOverview />
      </Suspense>
    </main>
  );
}
