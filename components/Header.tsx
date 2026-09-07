import Link from "next/link";

export default function Header() {
  return (
    <header className="border-b border-zinc-200 dark:border-zinc-800 sticky top-0 bg-white/90 dark:bg-black/90 backdrop-blur z-10">
      <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
        <Link href="/" className="text-xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
          Nemvida <span className="text-blue-600">Finance</span>
        </Link>
        <nav className="flex gap-5 text-sm font-medium text-zinc-600 dark:text-zinc-400">
          <Link href="/" className="hover:text-blue-600 dark:hover:text-blue-400">
            Vesti
          </Link>
          <Link href="/clanci" className="hover:text-blue-600 dark:hover:text-blue-400">
            Stručni članci
          </Link>
          <Link href="/vrednost" className="hover:text-blue-600 dark:hover:text-blue-400">
            Procena vrednosti
          </Link>
        </nav>
      </div>
    </header>
  );
}
