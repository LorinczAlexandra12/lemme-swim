'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { IsoDate } from '@/lib/types';
import { formatHuDate, formatWeekdayName, todayIso } from '@/lib/ui/format';
import {
  HU_WEEKDAY_LONG,
  HU_WEEKDAY_SHORT,
  monthGrid,
  monthLabel,
  monthOf,
  shiftDays,
  shiftMonth,
} from '@/lib/ui/calendar';

interface DateFieldProps {
  value: IsoDate;
  onChange: (value: IsoDate) => void;
  /** Ennél korábbi napot nem lehet választani. Alapból a mai nap. */
  min?: IsoDate;
  label: string;
}

/**
 * Dátumválasztó hétfős naptárral.
 *
 * Saját naptár, nem natív `<input type="date">`: annál a hét első napját a
 * böngésző területi beállítása dönti el, amit az oldal nem tud felülírni.
 */
export function DateField({ value, onChange, min = todayIso(), label }: DateFieldProps) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(() => monthOf(value || min));
  const [focusedIso, setFocusedIso] = useState<IsoDate>(value || min);

  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const labelId = useId();
  const dialogId = useId();

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }, []);

  function openCalendar() {
    const start = value || min;
    setFocusedIso(start);
    setView(monthOf(start));
    setOpen(true);
  }

  // Kattintás a naptáron kívülre: bezárás, de a fókuszt nem rángatjuk vissza —
  // a felhasználó épp máshová mutatott.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  // A rácsban mindig a „fókuszált" nap viszi a tabindexet (roving tabindex).
  useEffect(() => {
    if (!open) return;
    const cell = gridRef.current?.querySelector<HTMLButtonElement>(`[data-iso="${focusedIso}"]`);
    cell?.focus();
  }, [open, focusedIso]);

  function moveFocus(delta: number) {
    const next = shiftDays(focusedIso, delta);
    if (next < min) return;
    setFocusedIso(next);
    setView(monthOf(next));
  }

  function onGridKeyDown(event: React.KeyboardEvent) {
    const keys: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -7,
      ArrowDown: 7,
    };
    if (event.key in keys) {
      event.preventDefault();
      moveFocus(keys[event.key]);
      return;
    }
    if (event.key === 'PageUp' || event.key === 'PageDown') {
      event.preventDefault();
      const { year, month } = shiftMonth(view.year, view.month, event.key === 'PageUp' ? -1 : 1);
      setView({ year, month });
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      close(true);
    }
  }

  function pick(iso: IsoDate) {
    onChange(iso);
    close(true);
  }

  const weeks = monthGrid(view.year, view.month);
  const today = todayIso();
  const prev = shiftMonth(view.year, view.month, -1);
  const canGoBack = `${prev.year}-${String(prev.month + 1).padStart(2, '0')}-31` >= min;

  return (
    <div className="space-y-1.5">
      <span id={labelId} className="block text-sm font-medium text-ink-2">
        {label}
      </span>

      <div ref={rootRef} className="relative">
        <button
          ref={triggerRef}
          type="button"
          aria-labelledby={`${labelId} ${dialogId}-value`}
          aria-expanded={open}
          aria-haspopup="dialog"
          onClick={() => (open ? close(false) : openCalendar())}
          className="flex w-full items-center justify-between gap-3 rounded-xl border border-line bg-surface px-4 py-3 text-left text-base text-ink hover:border-line-strong"
        >
          <span id={`${dialogId}-value`} className="tnum">
            {formatHuDate(value)}
            <span className="text-ink-3">{`, ${formatWeekdayName(value)}`}</span>
          </span>
          <svg
            aria-hidden="true"
            viewBox="0 0 20 20"
            className="h-5 w-5 shrink-0 text-ink-3"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
          >
            <rect x="3" y="4.5" width="14" height="12.5" rx="2.5" />
            <path d="M3 8.5h14M7 2.5v3M13 2.5v3" strokeLinecap="round" />
          </svg>
        </button>

        {open && (
          <div
            role="dialog"
            aria-modal="false"
            aria-label={`${label} — naptár`}
            onKeyDown={onGridKeyDown}
            className="absolute left-0 right-0 top-full z-20 mt-2 rounded-2xl bg-surface p-3 shadow-[0_16px_40px_-18px_rgba(6,38,48,0.6)] ring-1 ring-line sm:w-[21rem]"
          >
            <div className="flex items-center justify-between gap-2 px-1 pb-2">
              <button
                type="button"
                disabled={!canGoBack}
                onClick={() => setView(shiftMonth(view.year, view.month, -1))}
                aria-label="Előző hónap"
                className="rounded-lg p-2 text-ink-2 hover:bg-pool-soft hover:text-pool disabled:opacity-30 disabled:hover:bg-transparent"
              >
                <svg
                  aria-hidden="true"
                  viewBox="0 0 20 20"
                  className="h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M12.5 4 6.5 10l6 6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              <span aria-live="polite" className="text-sm font-bold text-ink tnum">
                {monthLabel(view.year, view.month)}
              </span>
              <button
                type="button"
                onClick={() => setView(shiftMonth(view.year, view.month, 1))}
                aria-label="Következő hónap"
                className="rounded-lg p-2 text-ink-2 hover:bg-pool-soft hover:text-pool"
              >
                <svg
                  aria-hidden="true"
                  viewBox="0 0 20 20"
                  className="h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M7.5 4l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </div>

            {/* Hétfőtől vasárnapig — ahogy az uszodabeosztások is sorolják. */}
            <div className="grid grid-cols-7 border-b border-line pb-1.5">
              {HU_WEEKDAY_SHORT.map((short, i) => (
                <abbr
                  key={short}
                  title={HU_WEEKDAY_LONG[i]}
                  className={[
                    'text-center text-xs font-semibold no-underline',
                    i >= 5 ? 'text-ink-3' : 'text-ink-2',
                  ].join(' ')}
                >
                  {short}
                </abbr>
              ))}
            </div>

            <div ref={gridRef} role="grid" className="grid grid-cols-7 gap-0.5 pt-1.5">
              {weeks.flat().map((cell) => {
                const disabled = cell.iso < min;
                const selected = cell.iso === value;
                const isToday = cell.iso === today;
                return (
                  <button
                    key={cell.iso}
                    type="button"
                    role="gridcell"
                    data-iso={cell.iso}
                    disabled={disabled}
                    aria-selected={selected}
                    aria-label={`${formatHuDate(cell.iso)}, ${formatWeekdayName(cell.iso)}`}
                    tabIndex={cell.iso === focusedIso ? 0 : -1}
                    onClick={() => pick(cell.iso)}
                    onFocus={() => setFocusedIso(cell.iso)}
                    className={[
                      'relative h-10 rounded-lg text-sm tnum transition-colors',
                      selected
                        ? 'bg-pool font-bold text-pool-ink'
                        : disabled
                          ? 'text-ink-3/40'
                          : cell.inMonth
                            ? 'font-medium text-ink hover:bg-pool-soft'
                            : 'text-ink-3 hover:bg-pool-soft',
                      !selected && !disabled && cell.weekend && cell.inMonth ? 'text-ink-2' : '',
                    ].join(' ')}
                  >
                    {Number(cell.iso.slice(8, 10))}
                    {isToday && (
                      <span
                        aria-hidden="true"
                        className={[
                          'absolute bottom-1.5 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full',
                          selected ? 'bg-pool-ink' : 'bg-pool',
                        ].join(' ')}
                      />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
