'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Scissors, Shield, Shrink, Sparkles, Wand2, ZoomIn } from 'lucide-react';
import { cn } from '@/lib/utils';

const nav = [
  { href: '/', label: 'Watermark', icon: Wand2 },
  { href: '/upscale', label: 'Upscale', icon: ZoomIn },
  { href: '/compress', label: 'Compress', icon: Shrink },
  { href: '/background', label: 'Background', icon: Scissors },
  { href: '/metadata', label: 'Metadata', icon: Shield },
];

export function SiteHeader() {
  const pathname = usePathname();
  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur dark:border-slate-800 dark:bg-slate-950/90">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3">
        <Link href="/" className="flex shrink-0 items-center gap-2">
          <Sparkles className="h-5 w-5 text-slate-900 dark:text-slate-100" />
          <span className="font-semibold text-slate-900 dark:text-slate-100">
            AI Remover
          </span>
        </Link>
        <nav className="flex flex-wrap justify-end gap-1">
          {nav.map(({ href, label, icon: Icon }) => {
            const isActive = href === pathname;
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  'flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors sm:px-3',
                  isActive
                    ? 'bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-100'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100',
                )}
              >
                <Icon className="h-4 w-4" />
                <span className="hidden md:inline">{label}</span>
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
