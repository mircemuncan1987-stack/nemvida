import { Suspense } from "react";
import VerdictTracking from "@/components/VerdictTracking";

export const metadata = {
  title: "Praćenje preporuka | Nemvida Finance",
  description:
    "Evidencija suda modela (i cene) za svaki tiker onog trenutka kad ga analiziraš na pregledu kompanije, sa poređenjem stvarnog učinka od tog datuma naspram SPY.",
};

export default function PracenjePage() {
  return (
    <main className="flex-1 w-full">
      <div className="max-w-5xl mx-auto px-4 pt-8">
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">Praćenje preporuka</h1>
        <p className="text-zinc-600 dark:text-zinc-400 mt-1">
          Sud modela se automatski beleži svaki put kad analiziraš tiker na pregledu kompanije — ovde vidiš kako je
          taj sud prošao od tog datuma naspram SPY.
        </p>
      </div>
      <Suspense fallback={null}>
        <VerdictTracking />
      </Suspense>
    </main>
  );
}
