'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArchiveRestore, Sparkles, Wand2 } from 'lucide-react';
import { cn } from '@/lib/utils';

const nav = [
  { href: '/', label: 'Watermark remover', icon: Wand2 },
  { href: '/compress', label: 'Compress images', icon: ArchiveRestore },
];

export function SiteHeader() {
  const pathname = usePathname();
  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur dark:border-slate-800 dark:bg-slate-950/90">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3">
        <Link href="/" className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-slate-900 dark:text-slate-100" />
          <span className="font-semibold text-slate-900 dark:text-slate-100">
            AI Remover
          </span>
        </Link>
        <nav className="flex gap-1">
          {nav.map(({ href, label, icon: Icon }) => {
            const isActive = href === pathname;
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-100'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100',
                )}
              >
                <Icon className="h-4 w-4" />
                <span className="hidden sm:inline">{label}</span>
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
