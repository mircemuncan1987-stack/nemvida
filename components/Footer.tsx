export default function Footer() {
  return (
    <footer className="border-t border-zinc-200 dark:border-zinc-800 mt-auto">
      <div className="max-w-4xl mx-auto px-4 py-6 text-sm text-zinc-500 dark:text-zinc-400 space-y-1">
        <p>
          Vesti se preuzimaju sa javno dostupnih izvora (Google News, Yahoo
          Finance), a rezime najvažnijih vesti i signala piše veštačka
          inteligencija (Claude, Anthropic) na osnovu naslova i kratkih opisa.
          Tržišni podaci kasne do ~15 minuta. Ništa na sajtu nije preporuka za
          kupovinu ili prodaju.
        </p>
        <p>© {new Date().getFullYear()} Nemvida Finance</p>
      </div>
    </footer>
  );
}
