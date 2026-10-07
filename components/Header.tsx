import Link from "next/link";

export default function Header() {
  return (
    <header className="border-b border-zinc-200 dark:border-zinc-800 sticky top-0 bg-white/90 dark:bg-black/90 backdrop-blur z-10">
      <div className="max-w-5xl mx-auto px-4 py-4 flex flex-wrap items-center justify-between gap-3">
        <Link href="/" className="text-xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50 whitespace-nowrap">
          Nemvida <span className="text-blue-600">Finance</span>
        </Link>
        <nav className="flex flex-wrap gap-x-4 gap-y-1 text-sm font-medium text-zinc-600 dark:text-zinc-400">
          <Link href="/" className="hover:text-blue-600 dark:hover:text-blue-400 whitespace-nowrap">
            Vesti
          </Link>
          <Link href="/pregled" className="hover:text-blue-600 dark:hover:text-blue-400 whitespace-nowrap">
            Pregled
          </Link>
          <Link href="/fisher" className="hover:text-blue-600 dark:hover:text-blue-400 whitespace-nowrap">
            Fišer
          </Link>
          <Link href="/lista" className="hover:text-blue-600 dark:hover:text-blue-400 whitespace-nowrap">
            Skener
          </Link>
          <Link href="/zemlje" className="hover:text-blue-600 dark:hover:text-blue-400 whitespace-nowrap">
            Zemlje
          </Link>
          <Link href="/portfolio" className="hover:text-blue-600 dark:hover:text-blue-400 whitespace-nowrap">
            Portfolio
          </Link>
        </nav>
      </div>
    </header>
  );
}
