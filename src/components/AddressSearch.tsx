'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { fullAddress, type GeocodeHit } from '@/lib/ui/geocode';

/** Ennyit várunk az utolsó leütés után, mielőtt kérdezünk. */
const DEBOUNCE_MS = 400;
const MIN_QUERY_LENGTH = 3;

interface AddressSearchProps {
  onPick: (hit: GeocodeHit) => void;
  compact?: boolean;
}

/**
 * Utcaszintű címkereső.
 *
 * A kerület középpontja csak hozzávetőleges távolságot ad; aki pontos sorrendet
 * akar, itt megadhatja a saját utcáját és házszámát.
 */
export function AddressSearch({ onPick, compact = false }: AddressSearchProps) {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<GeocodeHit[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(-1);
  /**
   * A legutóbb kiválasztott találat szövege.
   *
   * A mezőbe a választás után a teljes cím kerül; arra nem keresünk rá újra.
   * Szándékosan az értéket tároljuk, nem egy „most ne keress" jelzőt: a jelzőt
   * csak egy tényleges újrarenderelés tudná elsütni, és ha a kiválasztott cím
   * történetesen megegyezik a mezőben állóval, bent ragadna — elnyelve a
   * következő gépelés keresését.
   */
  const picked = useRef<string | null>(null);

  const rootRef = useRef<HTMLDivElement>(null);
  const inputId = useId();
  const listboxId = useId();
  const statusId = useId();

  function onQueryChange(next: string) {
    setQuery(next);
    // A rövid töredékre nem kérdezünk — és a korábbi találatokat sem hagyjuk
    // ott, mert már nem ahhoz tartoznak, ami a mezőben áll.
    if (next.trim().length < MIN_QUERY_LENGTH) {
      setHits([]);
      setOpen(false);
      setError(null);
      setLoading(false);
    }
  }

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < MIN_QUERY_LENGTH || query === picked.current) return;

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const response = await fetch(`/api/geocode?q=${encodeURIComponent(trimmed)}`, {
          signal: controller.signal,
        });
        const payload: unknown = await response.json().catch(() => null);
        if (controller.signal.aborted) return;

        if (!response.ok) {
          const message =
            payload && typeof payload === 'object' && 'error' in payload
              ? String((payload as { error: unknown }).error)
              : 'A címkeresés nem sikerült.';
          throw new Error(message);
        }

        setHits(Array.isArray(payload) ? (payload as GeocodeHit[]) : []);
        setError(null);
        setOpen(true);
        setActive(-1);
      } catch (err) {
        if (controller.signal.aborted) return;
        setHits([]);
        setOpen(false);
        setError(err instanceof Error ? err.message : 'A címkeresés nem sikerült.');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  function choose(hit: GeocodeHit) {
    picked.current = fullAddress(hit);
    setQuery(picked.current);
    setOpen(false);
    setHits([]);
    setActive(-1);
    onPick(hit);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (!open || hits.length === 0) return;

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((i) => (i + step + hits.length) % hits.length);
      return;
    }
    if (event.key === 'Enter' && active >= 0) {
      event.preventDefault();
      choose(hits[active]);
    }
  }

  const noMatches =
    open && !loading && hits.length === 0 && query.trim().length >= MIN_QUERY_LENGTH;

  return (
    <div ref={rootRef} className={compact ? 'relative' : 'relative space-y-1.5'}>
      <label
        htmlFor={inputId}
        className={compact ? 'sr-only-text' : 'block text-sm font-medium text-ink-2'}
      >
        Add meg az utcát és a házszámot
      </label>

      <div className="relative">
        <input
          id={inputId}
          type="text"
          role="combobox"
          autoComplete="off"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-describedby={statusId}
          aria-activedescendant={active >= 0 ? `${listboxId}-${active}` : undefined}
          value={query}
          placeholder="pl. Váci utca 12."
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => hits.length > 0 && setOpen(true)}
          className={[
            'w-full rounded-xl border border-line bg-surface text-ink placeholder:text-ink-3',
            'focus:border-pool',
            compact ? 'px-3 py-2 pr-9 text-sm' : 'px-4 py-3.5 pr-11 text-base',
          ].join(' ')}
        />
        <svg
          aria-hidden="true"
          viewBox="0 0 20 20"
          className={[
            'pointer-events-none absolute top-1/2 -translate-y-1/2 text-ink-3',
            compact ? 'right-3 h-4 w-4' : 'right-4 h-5 w-5',
          ].join(' ')}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
        >
          <circle cx="8.75" cy="8.75" r="5.25" />
          <path d="M12.75 12.75 17 17" strokeLinecap="round" />
        </svg>
      </div>

      <p id={statusId} aria-live="polite" className="sr-only-text">
        {loading
          ? 'Címek keresése.'
          : hits.length > 0
            ? `${hits.length} találat. A nyílbillentyűkkel választhatsz.`
            : ''}
      </p>

      {open && hits.length > 0 && (
        <ul
          id={listboxId}
          role="listbox"
          aria-label="Címtalálatok"
          className="absolute left-0 right-0 top-full z-20 mt-1.5 max-h-72 overflow-auto rounded-xl bg-surface py-1 shadow-[0_16px_40px_-18px_rgba(6,38,48,0.6)] ring-1 ring-line"
        >
          {hits.map((hit, i) => (
            <li key={hit.id} role="presentation">
              <button
                id={`${listboxId}-${i}`}
                type="button"
                role="option"
                aria-selected={i === active}
                tabIndex={-1}
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => choose(hit)}
                onPointerEnter={() => setActive(i)}
                className={[
                  'block w-full px-3.5 py-2.5 text-left transition-colors',
                  i === active ? 'bg-pool-soft' : '',
                ].join(' ')}
              >
                <span className="block text-sm font-medium text-ink">{hit.label}</span>
                <span className="block text-xs text-ink-3">{hit.detail}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {noMatches && (
        <p className="text-sm text-ink-2">
          Erre a címre nincs találat Budapesten. Próbáld az utcanévvel, vagy válassz kerületet.
        </p>
      )}

      {error && (
        <p
          role="status"
          className="rounded-xl bg-amber-bg px-3.5 py-2.5 text-sm leading-snug text-amber ring-1 ring-inset ring-amber-line"
        >
          {error}
        </p>
      )}
    </div>
  );
}
