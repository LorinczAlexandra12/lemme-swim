'use client';

import type { IsoDate, PoolAvailability } from '@/lib/types';
import { PoolCard } from './PoolCard';
import { formatRange, formatWeekdayName } from '@/lib/ui/format';

export type ResultsState = 'idle' | 'loading' | 'ready' | 'error';

interface ResultsListProps {
  state: ResultsState;
  results: PoolAvailability[];
  errorMessage?: string | null;
  date: IsoDate;
  start: string;
  end: string;
  onRetry: () => void;
  /** Tippek az üres állapothoz: mit lazítson a felhasználó. */
  onRelaxFilters: () => void;
  filtersAreNarrow: boolean;
  /** „Minden uszoda" módban a teljes listát mutatjuk, nem csak a közelieket. */
  showAll: boolean;
}

function PoolCardSkeleton() {
  return (
    <li className="rounded-2xl bg-surface p-4 ring-1 ring-line sm:p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="w-full space-y-2">
          <div className="skeleton h-5 w-2/3 rounded" />
          <div className="skeleton h-3.5 w-1/2 rounded" />
        </div>
        <div className="skeleton h-5 w-16 shrink-0 rounded" />
      </div>
      <div className="mt-5 flex gap-3.5">
        <div className="skeleton h-[72px] w-28 rounded-md sm:w-36" />
        <div className="flex-1 space-y-2">
          <div className="skeleton h-7 w-20 rounded" />
          <div className="skeleton h-3.5 w-28 rounded" />
          <div className="skeleton h-6 w-24 rounded-full" />
        </div>
      </div>
    </li>
  );
}

export function ResultsList({
  state,
  results,
  errorMessage,
  date,
  start,
  end,
  onRetry,
  onRelaxFilters,
  filtersAreNarrow,
  showAll,
}: ResultsListProps) {
  if (state === 'idle') {
    return (
      <p className="rounded-2xl bg-surface px-5 py-8 text-center text-sm text-ink-2 ring-1 ring-line">
        Add meg, honnan indulsz és mikor úsznál, majd nyomd meg a keresést.
      </p>
    );
  }

  if (state === 'loading') {
    return (
      <>
        <p aria-live="polite" className="sr-only-text">
          Uszodák keresése folyamatban.
        </p>
        <ul className="space-y-4">
          <PoolCardSkeleton />
          <PoolCardSkeleton />
          <PoolCardSkeleton />
        </ul>
      </>
    );
  }

  if (state === 'error') {
    return (
      <div
        role="alert"
        className="rounded-2xl bg-danger-bg px-5 py-6 text-center ring-1 ring-inset ring-danger/25"
      >
        <p className="text-base font-semibold text-danger">A keresés nem sikerült</p>
        <p className="mx-auto mt-1.5 max-w-sm text-sm leading-snug text-danger/90">
          {errorMessage ?? 'Nem értük el a kereső szolgáltatást. Ellenőrizd a kapcsolatot.'}
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 rounded-xl bg-pool px-5 py-3 text-sm font-semibold text-pool-ink hover:bg-pool-hover"
        >
          Keresés újra
        </button>
      </div>
    );
  }

  if (results.length === 0) {
    return (
      <div className="rounded-2xl bg-surface px-5 py-8 text-center ring-1 ring-line">
        <p className="text-base font-semibold text-ink">Nincs találat erre az időpontra</p>
        <p className="mx-auto mt-1.5 max-w-sm text-sm leading-snug text-ink-2">
          {formatWeekdayName(date)} {formatRange(start, end)} között egy uszoda sem felel meg a
          szűrőknek. Próbálj nagyobb távolságot, kevesebb szabad sávot, vagy másik idősávot.
        </p>
        {filtersAreNarrow && (
          <button
            type="button"
            onClick={onRelaxFilters}
            className="mt-4 rounded-xl bg-pool px-5 py-3 text-sm font-semibold text-pool-ink hover:bg-pool-hover"
          >
            Minden uszoda mutatása
          </button>
        )}
      </div>
    );
  }

  return (
    <>
      <p aria-live="polite" className="mb-3 text-sm text-ink-2">
        <strong className="font-semibold text-ink tnum">{results.length}</strong>{' '}
        {showAll ? 'uszoda Budapesten, távolság szerint.' : 'uszoda a közelben, távolság szerint.'}
      </p>
      <ul className="space-y-4">
        {results.map((r, i) => (
          <PoolCard key={r.pool.id} result={r} date={date} animate={i < 4} />
        ))}
      </ul>
      <p className="mt-6 text-xs leading-relaxed text-ink-3">
        A sávszámok a nyilvános beosztásokból származnak, és változhatnak. Ahol nincs friss
        adatunk, azt külön jelezzük — ilyenkor indulás előtt érdemes az uszoda saját oldalát
        megnézni.
      </p>
    </>
  );
}
