import ValuationCalculator from "@/components/ValuationCalculator";

export const metadata = {
  title: "Procena unutrašnje vrednosti akcije | Nemvida Finance",
  description:
    "Besplatan alat za procenu unutrašnje (intrinsične) vrednosti akcije preko više modela: DCF, Graham Number, Dividend Discount Model, relativna procena i reverse DCF.",
};

export default function VrednostPage() {
  return (
    <main className="flex-1 w-full">
      <div className="max-w-4xl mx-auto px-4 pt-8">
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
          Procena unutrašnje vrednosti
        </h1>
        <p className="text-zinc-600 dark:text-zinc-400 mt-1">
          Izračunaj procenjenu unutrašnju vrednost bilo koje akcije preko više modela — DCF, Graham Number,
          Dividend Discount Model, relativna procena i reverse DCF — sa pretpostavkama koje sam podešavaš.
        </p>
      </div>
      <ValuationCalculator />
    </main>
  );
}
