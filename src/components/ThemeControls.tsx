'use client';

import { useSyncExternalStore, type ReactNode } from 'react';
import { Moon, Sun } from 'lucide-react';
import { ThemeProvider as NextThemeProvider, useTheme } from 'next-themes';

const subscribe = () => () => {};

export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <NextThemeProvider attribute="data-theme" defaultTheme="dark" enableSystem={false} storageKey="uszoda-theme">
      {children}
    </NextThemeProvider>
  );
}

export function ThemeToggle() {
  const mounted = useSyncExternalStore(subscribe, () => true, () => false);
  const { resolvedTheme, setTheme } = useTheme();
  const dark = !mounted || resolvedTheme === 'dark';
  const label = dark ? 'Világos mód bekapcsolása' : 'Sötét mód bekapcsolása';

  return (
    <button
      type="button"
      role="switch"
      aria-label="Sötét mód"
      aria-checked={dark}
      title={label}
      disabled={!mounted}
      onClick={() => setTheme(dark ? 'light' : 'dark')}
      className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-line bg-surface text-pool transition-colors hover:border-pool hover:bg-pool-soft"
    >
      {dark ? <Sun size={20} aria-hidden="true" /> : <Moon size={20} aria-hidden="true" />}
    </button>
  );
}