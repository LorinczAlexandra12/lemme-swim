'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { PoolAvailability, SearchQuery } from '@/lib/types';
import { LocationPicker, type Origin } from './LocationPicker';
import { TimeslotPicker, defaultTimeslot, type Timeslot } from './TimeslotPicker';
import { DEFAULT_FILTERS, FilterPanel, type Filters } from './FilterPanel';
import { ResultsList, type ResultsState } from './ResultsList';
import { Waterline } from './Waterline';
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

  const blocked = !origin ? 'Előbb add meg, honnan indulsz.' : slotError;
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
        className="w-full rounded-xl bg-pool px-5 py-4 text-base font-bold text-pool-ink transition-colors hover:bg-pool-hover disabled:cursor-not-allowed disabled:opacity-50"
      >
        {state === 'loading' ? 'Keresés…' : 'Szabad sávok keresése'}
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
      <header
        className={[
          'bg-header text-header-ink transition-[padding]',
          hasSearched ? 'pt-6' : 'pt-12 sm:pt-20',
        ].join(' ')}
      >
        <div className="mx-auto w-full max-w-2xl px-4 sm:px-6">
          <h1
            className={[
              'wordmark font-bold leading-[0.95]',
              hasSearched ? 'text-2xl' : 'text-[2.75rem] sm:text-6xl',
            ].join(' ')}
          >
            Uszoda Tracker
          </h1>
          {!hasSearched && (
            <p className="mt-4 max-w-[38ch] text-base leading-relaxed text-header-ink/85 sm:text-lg">
              Megmutatjuk, hány úszósáv marad szabadon a közeli budapesti uszodákban abban az
              időpontban, amikor úszni indulnál.
            </p>
          )}
        </div>
        <div className={hasSearched ? 'mt-5' : 'mt-10 sm:mt-14'}>
          <Waterline />
        </div>
      </header>

      <main className="mx-auto w-full max-w-2xl flex-1 px-4 pb-16 sm:px-6">
        <form
          onSubmit={onSubmit}
          aria-label="Keresési feltételek"
          className="-mt-2 rounded-2xl bg-surface p-4 shadow-[0_1px_2px_rgba(6,38,48,0.06),0_12px_32px_-20px_rgba(6,38,48,0.45)] ring-1 ring-line sm:p-5"
        >
          {!hasSearched ? (
            <div className="space-y-4">
              <div>
                <h2 className="text-base font-bold text-ink">Honnan indulsz?</h2>
                <p className="mt-1 text-sm leading-snug text-ink-2">
                  A helyzeted csak a távolság kiszámításához kell, és nem hagyja el a
                  böngésződet, amíg nem keresel.
                </p>
              </div>
              <LocationPicker origin={origin} onOriginChange={setOrigin} />
              <div className="border-t border-line pt-4">
                <TimeslotPicker value={slot} onChange={setSlot} error={slotError} />
              </div>
              <div className="border-t border-line pt-4">{searchButton}</div>
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
                  className="shrink-0 rounded-xl bg-surface-2 px-3.5 py-2.5 text-sm font-semibold text-pool ring-1 ring-inset ring-line hover:bg-pool-soft"
                >
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

        <section id="talalatok" aria-label="Találatok" className="mt-6">
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

      <footer className="border-t border-line px-4 py-6 text-center text-xs text-ink-3 sm:px-6">
        Uszoda Tracker — nyilvános uszodabeosztásokból dolgozunk, és megmondjuk, ha egy adat
        régi vagy hiányzik.
      </footer>
    </>
  );
}
