import OverviewCard from "@/components/OverviewCard";

export const metadata = {
  title: "Pregled kompanije | Nemvida Finance",
  description:
    "Kompaktan pregled kompanije na jednoj strani — poslovanje, rast, konkurentska prednost, menadžment, rizik i valuacija, u boji, na srpskom — isti podaci i pragovi kao sveobuhvatni model.",
};

export default function PregledPage() {
  return (
    <main className="flex-1 w-full">
      <div className="max-w-4xl mx-auto px-4 pt-8">
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">Pregled kompanije</h1>
        <p className="text-zinc-600 dark:text-zinc-400 mt-1">
          Sve najvažnije na jednoj strani — pretraži tiker ili naziv kompanije. Isti podaci i pragovi kao{" "}
          <a href="/model" className="underline">sveobuhvatni model</a>, samo sažeto i vizuelno, u boji.
        </p>
      </div>
      <OverviewCard />
    </main>
  );
}
