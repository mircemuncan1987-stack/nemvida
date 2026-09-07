import PatternFinder from "@/components/PatternFinder";

export const metadata = {
  title: "Pattern Finder — kvantitativna analiza akcija | Nemvida Finance",
  description:
    "Besplatan alat za istorijsku statističku analizu bilo kog tikera: sezonalnost, dani u nedelji, Fed sastanci, insajderi, institucije, short interest i sektor.",
};

export default function AnalizaPage() {
  return (
    <main className="flex-1 w-full">
      <div className="max-w-4xl mx-auto px-4 pt-8">
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
          Pattern Finder
        </h1>
        <p className="text-zinc-600 dark:text-zinc-400 mt-1">
          Kvantitativna istorijska analiza obrazaca za bilo koji tiker — sezonalnost, dani u nedelji, Fed
          sastanci, insajderi, institucije, short interest i sektor. Podaci se preuzimaju preko servera
          sajta (bez oslanjanja na nepouzdane javne CORS proxy servise).
        </p>
      </div>
      <PatternFinder />
    </main>
  );
}
