'use client';

import { useId } from 'react';

export interface Filters {
  maxDistanceKm: number;
  minFreeLanes: number;
  indoorOnly: boolean;
  /**
   * „Minden uszoda": a teljes budapesti listát mutatjuk, szűrés nélkül — azokat
   * is, amelyeknél nincs sávadatunk. A többi szűrő ilyenkor nem érvényesül, és
   * a felületen le is tiltjuk, hogy ne látsszon hatástalan kapcsolónak.
   */
  showAll: boolean;
}

export const DEFAULT_FILTERS: Filters = {
  maxDistanceKm: 8,
  minFreeLanes: 1,
  indoorOnly: false,
  showAll: false,
};

const MIN_LANE_OPTIONS = [0, 1, 2, 3, 4];

interface FilterPanelProps {
  value: Filters;
  onChange: (value: Filters) => void;
}

export function FilterPanel({ value, onChange }: FilterPanelProps) {
  const distanceId = useId();
  const lanesId = useId();
  const indoorId = useId();
  const allId = useId();
  const allHintId = useId();

  return (
    <fieldset className="space-y-5">
      <legend className="text-sm font-semibold text-ink">Szűrők</legend>

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <label htmlFor={allId} className="text-sm font-medium text-ink-2">
            Minden uszoda
          </label>
          <p id={allHintId} className="mt-0.5 text-xs leading-snug text-ink-3">
            A teljes budapesti lista, szűrés nélkül — azokkal együtt, amelyeknél nincs
            sávadatunk.
          </p>
        </div>
        <button
          id={allId}
          type="button"
          role="switch"
          aria-checked={value.showAll}
          aria-describedby={allHintId}
          onClick={() => onChange({ ...value, showAll: !value.showAll })}
          className={[
            'relative mt-0.5 h-8 w-14 shrink-0 rounded-full transition-colors',
            value.showAll ? 'bg-pool' : 'bg-line-strong',
          ].join(' ')}
        >
          <span
            aria-hidden="true"
            className={[
              'absolute top-1 h-6 w-6 rounded-full bg-surface shadow transition-[left]',
              value.showAll ? 'left-7' : 'left-1',
            ].join(' ')}
          />
          <span className="sr-only-text">{value.showAll ? 'Bekapcsolva' : 'Kikapcsolva'}</span>
        </button>
      </div>

      {/* A natív `disabled` a benne lévő összes vezérlőre öröklődik, így a
          „Minden uszoda" bekapcsolva billentyűzettel sem érhetők el. */}
      <fieldset
        disabled={value.showAll}
        className={[
          'space-y-5 border-t border-line pt-4 transition-opacity',
          value.showAll ? 'opacity-40' : '',
        ].join(' ')}
      >
        <div className="space-y-1">
          <div className="flex items-baseline justify-between gap-3">
            <label htmlFor={distanceId} className="text-sm font-medium text-ink-2">
              Legfeljebb ilyen messze
            </label>
            <output htmlFor={distanceId} className="text-sm font-bold text-ink tnum">
              {value.maxDistanceKm === 25 ? 'bármilyen messze' : `${value.maxDistanceKm} km`}
            </output>
          </div>
          <input
            id={distanceId}
            type="range"
            min={1}
            max={25}
            step={1}
            value={value.maxDistanceKm}
            onChange={(e) => onChange({ ...value, maxDistanceKm: Number(e.target.value) })}
            aria-valuetext={
              value.maxDistanceKm === 25 ? 'bármilyen messze' : `${value.maxDistanceKm} kilométer`
            }
          />
        </div>

        <div className="space-y-2">
          <span id={lanesId} className="block text-sm font-medium text-ink-2">
            Legalább ennyi szabad sáv
          </span>
          <div role="radiogroup" aria-labelledby={lanesId} className="flex gap-2">
            {MIN_LANE_OPTIONS.map((n) => {
              const active = value.minFreeLanes === n;
              return (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => onChange({ ...value, minFreeLanes: n })}
                  className={[
                    'min-w-11 flex-1 rounded-xl py-2.5 text-sm font-bold tnum transition-colors',
                    active
                      ? 'bg-pool text-pool-ink'
                      : 'bg-surface-2 text-ink-2 ring-1 ring-inset ring-line hover:text-pool',
                  ].join(' ')}
                >
                  {n === 0 ? 'mind' : n}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex items-center justify-between gap-3">
          <label htmlFor={indoorId} className="text-sm font-medium text-ink-2">
            Csak fedett medence
          </label>
          <button
            id={indoorId}
            type="button"
            role="switch"
            aria-checked={value.indoorOnly}
            onClick={() => onChange({ ...value, indoorOnly: !value.indoorOnly })}
            className={[
              'relative h-8 w-14 shrink-0 rounded-full transition-colors',
              value.indoorOnly ? 'bg-pool' : 'bg-line-strong',
            ].join(' ')}
          >
            <span
              aria-hidden="true"
              className={[
                'absolute top-1 h-6 w-6 rounded-full bg-surface shadow transition-[left]',
                value.indoorOnly ? 'left-7' : 'left-1',
              ].join(' ')}
            />
            <span className="sr-only-text">
              {value.indoorOnly ? 'Bekapcsolva' : 'Kikapcsolva'}
            </span>
          </button>
        </div>
      </fieldset>
    </fieldset>
  );
}
