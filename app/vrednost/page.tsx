import ValuationCalculator from "@/components/ValuationCalculator";

export const metadata = {
  title: "Procena vrednosti akcije | Nemvida Finance",
  description:
    "Besplatan alat za procenu akcije preko više kvantitativnih modela (DCF, Graham Number, Dividend Discount Model, relativna procena, reverse DCF) i objektivnih kvalitativnih pokazatelja (finansijsko zdravlje, profitabilnost, rast, konsenzus analitičara).",
};

export default function VrednostPage() {
  return (
    <main className="flex-1 w-full">
      <div className="max-w-4xl mx-auto px-4 pt-8">
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
          Procena vrednosti akcije
        </h1>
        <p className="text-zinc-600 dark:text-zinc-400 mt-1">
          Sud o akciji zasnovan na kvantitativnoj proceni cene (DCF, Graham Number, Dividend Discount Model,
          relativna procena, reverse DCF) i objektivnim kvalitativnim pokazateljima (finansijsko zdravlje,
          profitabilnost, rast, konsenzus analitičara) — sve iz merljivih podataka, bez subjektivnih ocena.
        </p>
      </div>
      <ValuationCalculator />
    </main>
  );
}
