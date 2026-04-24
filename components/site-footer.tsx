export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-slate-200 bg-white/50 py-6 dark:border-slate-800 dark:bg-slate-950/50">
      <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-2 px-4 text-xs text-slate-500 sm:flex-row">
        <span>© {new Date().getFullYear()} AI Remover — runs entirely in your browser.</span>
        <span>Only process images you own or have rights to.</span>
      </div>
    </footer>
  );
}
