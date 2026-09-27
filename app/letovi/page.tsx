import type { Metadata } from "next";
import FlightFinder from "@/components/FlightFinder";

export const metadata: Metadata = {
  title: "Letovi iz Stavangera — poređenje cena aviokarata | Nemvida",
  description:
    "Uporedi procenjene cene aviokarata iz Stavangera (SVG) ka svim destinacijama i rezerviši direktno kod aviokompanije, bez posrednika.",
};

export default function LetoviPage() {
  return (
    <main className="flex-1 w-full">
      <div className="max-w-5xl mx-auto px-4 py-8 space-y-2">
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">Letovi iz Stavangera</h1>
        <p className="text-zinc-600 dark:text-zinc-400 max-w-3xl">
          Uporedi procenjene cene aviokarata iz Stavangera (SVG) ka svim destinacijama koje aviokompanije redovno
          lete, i rezerviši direktno na sajtu aviokompanije — nikad preko posredničke agencije.
        </p>
      </div>
      <div className="max-w-5xl mx-auto px-4 pb-16">
        <FlightFinder />
      </div>
    </main>
  );
}
