import MarketOverview from "@/components/MarketOverview";

export const metadata = {
  title: "Pregled tržišta | Nemvida Finance",
  description:
    "Dnevni i nedeljni pregled tržišta: indeksi (SAD, Azija, Stokholm, Oslo), fjučersi, nafta i gas, plemeniti metali, kamatne stope, VIX, kurs norveške krune i glavne vesti.",
};

export default function TrzistePage() {
  return (
    <main className="flex-1 w-full">
      <div className="max-w-5xl mx-auto px-4 pt-8 pb-4">
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">Pregled tržišta</h1>
        <p className="text-zinc-600 dark:text-zinc-400 mt-1">
          Šta se dešava danas i ove nedelje — indeksi, energenti, metali, kamate, volatilnost i norveška kruna na jednom mestu.
        </p>
      </div>
      <MarketOverview />
    </main>
  );
}
