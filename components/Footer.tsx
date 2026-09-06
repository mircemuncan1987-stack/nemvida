export default function Footer() {
  return (
    <footer className="border-t border-zinc-200 dark:border-zinc-800 mt-auto">
      <div className="max-w-4xl mx-auto px-4 py-6 text-sm text-zinc-500 dark:text-zinc-400 space-y-1">
        <p>
          Sve vesti i članci na ovom sajtu su besplatni i otvoreni za sve čitaoce.
        </p>
        <p>
          Vesti se preuzimaju sa javno dostupnih izvora (Google News, Yahoo
          Finance). Klik na naslov prvo prikazuje automatski generisan
          rezime članka, bez upotrebe plaćenih AI servisa, uz opciju da
          otvoriš ceo originalni tekst.
        </p>
        <p>© {new Date().getFullYear()} Nemvida Finance</p>
      </div>
    </footer>
  );
}
