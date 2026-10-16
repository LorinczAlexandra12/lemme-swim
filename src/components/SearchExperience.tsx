'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { ArrowRight, MapPin, Search, SlidersHorizontal, Waves, X } from 'lucide-react';
import Link from 'next/link';
import type { PoolAvailability, SearchQuery } from '@/lib/types';
import { LocationPicker, type Origin } from './LocationPicker';
import { TimeslotPicker, defaultTimeslot, type Timeslot } from './TimeslotPicker';
import { DEFAULT_FILTERS, FilterPanel, type Filters } from './FilterPanel';
import { ResultsList, type ResultsState } from './ResultsList';
import { ThemeToggle } from './ThemeControls';
import { formatRange, formatWeekdayName, minutesOfDay } from '@/lib/ui/format';

function validateSlot(slot: Timeslot): string | null {
  if (!slot.date) return 'Válassz napot.';
  const start = minutesOfDay(slot.start);
  const end = minutesOfDay(slot.end);
  if (Number.isNaN(start) || Number.isNaN(end)) return 'Add meg a kezdés és a befejezés időpontját.';
  if (end <= start) return 'A befejezés legyen később, mint a kezdés.';
  return null;
}

/**
 * A keresés feltételei abban a pillanatban, amikor a felhasználó a Keresés
 * gombra nyomott.
 *
 * A szerkesztés alatt álló mezőktől elkülönítve tároljuk: a találatok fölötti
 * összefoglaló és az üres állapot szövege így mindig ahhoz a lekérdezéshez
 * tartozik, amelyik a listát adta — nem ahhoz, amit a felhasználó épp átír.
 */
interface Submitted {
  origin: Origin;
  slot: Timeslot;
  filters: Filters;
}

export function SearchExperience() {
  const [origin, setOrigin] = useState<Origin | null>(null);
  const [slot, setSlot] = useState<Timeslot>(defaultTimeslot);
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [panelOpen, setPanelOpen] = useState(true);

  const [submitted, setSubmitted] = useState<Submitted | null>(null);
  const [state, setState] = useState<ResultsState>('idle');
  const [results, setResults] = useState<PoolAvailability[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const collapsedOnce = useRef(false);
  const blockedId = useId();

  const slotError = validateSlot(slot);

  const runSearch = useCallback(async (query: Submitted) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setSubmitted(query);
    setState('loading');
    setErrorMessage(null);

    const { origin: from, slot: when, filters: how } = query;
    const body: SearchQuery = {
      lat: from.lat,
      lon: from.lon,
      date: when.date,
      start: when.start,
      end: when.end,
      // „Minden uszoda": egyetlen szűrőt sem küldünk, így a teljes lista jön
      // vissza. A távolságot továbbra is kiszámoljuk és sorrendezünk vele —
      // csak nem vágunk le vele senkit.
      // 25 km a csúszka teteje: ott sem szűrünk távolságra.
      maxDistanceKm: how.showAll || how.maxDistanceKm >= 25 ? undefined : how.maxDistanceKm,
      minFreeLanes: how.showAll || how.minFreeLanes === 0 ? undefined : how.minFreeLanes,
      indoorOnly: how.showAll ? undefined : how.indoorOnly || undefined,
    };

    try {
      const response = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const message =
          payload && typeof payload === 'object' && 'error' in payload
            ? String((payload as { error: unknown }).error)
            : 'A kereső szolgáltatás hibát adott vissza.';
        throw new Error(message);
      }
      if (controller.signal.aborted) return;
      setResults(Array.isArray(payload) ? (payload as PoolAvailability[]) : []);
      setState('ready');
      if (!collapsedOnce.current) {
        collapsedOnce.current = true;
        setPanelOpen(false);
      }
    } catch (error) {
      if (controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError'))
        return;
      setErrorMessage(
        error instanceof Error && error.message
          ? error.message
          : 'Nem értük el a kereső szolgáltatást.',
      );
      setState('error');
    }
  }, []);

  useEffect(() => () => abortRef.current?.abort(), []);

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!origin || slotError) return;
    void runSearch({ origin, slot, filters });
  }

  /** Az üres állapot „Minden uszoda" gombja: állítjuk a szűrőt és újra keresünk. */
  function showEverything() {
    const relaxed: Filters = { ...DEFAULT_FILTERS, showAll: true };
    setFilters(relaxed);
    if (!submitted) return;
    void runSearch({ ...submitted, filters: relaxed });
  }

  const blocked = !origin ? 'Előbb válassz kerületet.' : slotError;
  const hasSearched = submitted !== null;

  const shown = submitted?.filters ?? filters;
  const filtersAreNarrow =
    !shown.showAll && (shown.maxDistanceKm < 25 || shown.minFreeLanes > 0 || shown.indoorOnly);

  const searchButton = (
    <div className="space-y-2">
      <button
        type="submit"
        disabled={Boolean(blocked)}
        aria-describedby={blocked ? blockedId : undefined}
        className="flex min-h-14 w-full items-center justify-between gap-3 rounded-sm bg-pool px-5 py-4 text-sm font-bold text-pool-ink transition-colors hover:bg-pool-hover disabled:cursor-not-allowed disabled:opacity-40"
      >
        <span className="flex items-center gap-2.5">
          <Search size={18} aria-hidden="true" />
          {state === 'loading' ? 'Keresés…' : 'Szabad sávok keresése'}
        </span>
        <ArrowRight size={18} aria-hidden="true" />
      </button>
      {blocked && (
        <p id={blockedId} className="text-center text-sm text-ink-3">
          {blocked}
        </p>
      )}
    </div>
  );

  return (
    <>
      <header className="industrial-header border-b border-line bg-header text-header-ink">
        <div className="relative mx-auto w-full max-w-5xl px-5 sm:px-8">
          <div className="flex min-h-16 items-center justify-between gap-4 border-b border-line">
            <Link href="/" aria-label="Lemme swim kezdőlap" className="inline-flex items-center gap-2.5 text-sm font-bold">
              <Waves size={22} className="text-pool" aria-hidden="true" />
              <span className="wordmark text-base">Lemme swim</span>
            </Link>
            <div className="flex shrink-0 items-center gap-4">
              <span className="hidden items-center gap-1.5 font-mono text-[11px] text-ink-2 sm:flex">
                <MapPin size={13} aria-hidden="true" />
                BUDAPEST, HU
              </span>
              <ThemeToggle />
            </div>
          </div>
          <div className={hasSearched ? 'py-6' : 'py-8 sm:py-10'}>
            <p className="mb-3 flex items-center gap-2 font-mono text-[11px] uppercase text-ink-2">
              <span className="h-1.5 w-1.5 bg-pool" aria-hidden="true" />
              Úszás / Sávbeosztások
            </p>
          <h1
            className={[
              'wordmark font-semibold leading-tight',
              hasSearched ? 'text-2xl' : 'text-3xl sm:text-5xl',
            ].join(' ')}
          >
            Lemme swim
          </h1>
          {!hasSearched && (
            <p className="mt-3 text-sm text-ink-2 sm:text-base">
              Szabad úszósávok Budapesten.
            </p>
          )}
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-5 pb-12 sm:px-8">
        <form
          onSubmit={onSubmit}
          aria-label="Keresési feltételek"
          className="border-b border-line bg-bg/95 py-6 sm:py-8"
        >
          {!hasSearched ? (
            <div>
              <div className="grid gap-7 md:grid-cols-2 md:gap-8">
                <div className="min-w-0 space-y-4 md:border-r md:border-line md:pr-8">
                  <h2 className="flex items-center gap-3 text-sm font-semibold text-ink">
                    <span className="font-mono text-xs text-ink-3">01 /</span>
                    Melyik kerületből indulsz?
                  </h2>
                  <LocationPicker origin={origin} onOriginChange={setOrigin} />
                </div>
                <div className="min-w-0 border-t border-line pt-6 md:border-0 md:pt-0">
                  <TimeslotPicker value={slot} onChange={setSlot} error={slotError} />
                </div>
              </div>
              <div className="mt-6 grid gap-4 border-t border-line pt-5 md:grid-cols-2 md:gap-8">
                <div className="md:col-start-2">{searchButton}</div>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-ink">{submitted.origin.label}</p>
                  <p className="mt-0.5 text-sm text-ink-2 tnum">
                    {formatWeekdayName(submitted.slot.date)}{' '}
                    {formatRange(submitted.slot.start, submitted.slot.end)}
                    <span className="text-ink-3">
                      {' · '}
                      {submitted.filters.showAll ? (
                        'minden uszoda'
                      ) : (
                        <>
                          {submitted.filters.maxDistanceKm >= 25
                            ? 'bármilyen messze'
                            : `${submitted.filters.maxDistanceKm} km`}
                          {submitted.filters.indoorOnly ? ', csak fedett' : ''}
                        </>
                      )}
                    </span>
                  </p>
                </div>
                <button
                  type="button"
                  aria-expanded={panelOpen}
                  aria-controls="kereses-vezerlok"
                  onClick={() => setPanelOpen((v) => !v)}
                  className="inline-flex shrink-0 items-center gap-2 rounded-sm bg-surface-2 px-3.5 py-2.5 text-sm font-semibold text-ink ring-1 ring-inset ring-line hover:bg-pool-soft"
                >
                  {panelOpen ? <X size={15} aria-hidden="true" /> : <SlidersHorizontal size={15} aria-hidden="true" />}
                  {panelOpen ? 'Bezárás' : 'Módosítás'}
                </button>
              </div>

              <div id="kereses-vezerlok" hidden={!panelOpen} className="space-y-5">
                <div className="border-t border-line pt-4">
                  <LocationPicker origin={origin} onOriginChange={setOrigin} compact />
                </div>
                <div className="border-t border-line pt-4">
                  <TimeslotPicker value={slot} onChange={setSlot} error={slotError} />
                </div>
                <div className="border-t border-line pt-4">
                  <FilterPanel value={filters} onChange={setFilters} />
                </div>
                <div className="border-t border-line pt-4">{searchButton}</div>
              </div>
            </div>
          )}
        </form>

        <section id="talalatok" aria-label="Találatok" className="mt-7">
          <div className="mb-5 flex items-center justify-between gap-4">
            <h2 className="flex items-center gap-3 text-sm font-semibold">
              <span className="font-mono text-xs text-ink-3">03 /</span>
              Találatok
            </h2>
            <span className="font-mono text-[10px] uppercase text-ink-3">Távolság szerint</span>
          </div>
          <ResultsList
            state={state}
            results={results}
            errorMessage={errorMessage}
            date={submitted?.slot.date ?? slot.date}
            start={submitted?.slot.start ?? slot.start}
            end={submitted?.slot.end ?? slot.end}
            onRetry={() => submitted && void runSearch(submitted)}
            onRelaxFilters={showEverything}
            filtersAreNarrow={filtersAreNarrow}
            showAll={shown.showAll}
          />
        </section>
      </main>

      <footer className="border-t border-line bg-bg-deep px-5 py-5 text-xs text-ink-3 sm:px-8">
        <div className="mx-auto flex max-w-[960px] flex-wrap items-center justify-between gap-x-8 gap-y-3">
          <span className="flex items-center gap-2 font-semibold text-ink-2"><Waves size={16} aria-hidden="true" /> Lemme swim</span>
          <span>Nyilvános beosztások. Egyértelmű adatforrások.</span>
          <span className="font-mono text-[10px]">BUDAPEST / HU</span>
        </div>
      </footer>
    </>
  );
}
