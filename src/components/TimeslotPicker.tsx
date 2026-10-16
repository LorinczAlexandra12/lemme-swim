'use client';

import { useId } from 'react';
import type { IsoDate, TimeOfDay } from '@/lib/types';
import { addMinutes, nextFullHour, todayIso, tomorrowIso } from '@/lib/ui/format';
import { DateField } from './DateField';
import { TimeField } from './TimeField';

export interface Timeslot {
  date: IsoDate;
  start: TimeOfDay;
  end: TimeOfDay;
}

export function defaultTimeslot(): Timeslot {
  const start = nextFullHour();
  return { date: todayIso(), start, end: addMinutes(start, 60) };
}

const QUICK_SLOTS: { label: string; build: () => Timeslot }[] = [
  {
    label: 'Most',
    build: () => {
      const now = new Date();
      const start = `${String(now.getHours()).padStart(2, '0')}:${String(
        Math.floor(now.getMinutes() / 5) * 5,
      ).padStart(2, '0')}`;
      return { date: todayIso(), start, end: addMinutes(start, 60) };
    },
  },
  { label: 'Ma este', build: () => ({ date: todayIso(), start: '18:00', end: '20:00' }) },
  {
    label: 'Holnap reggel',
    build: () => ({ date: tomorrowIso(), start: '06:00', end: '08:00' }),
  },
];

interface TimeslotPickerProps {
  value: Timeslot;
  onChange: (value: Timeslot) => void;
  /** Magyar hibaüzenet, ha a vége nem későbbi a kezdésnél. */
  error?: string | null;
}

export function TimeslotPicker({ value, onChange, error }: TimeslotPickerProps) {
  const errorId = useId();

  function isActive(slot: Timeslot) {
    return slot.date === value.date && slot.start === value.start && slot.end === value.end;
  }

  return (
    <fieldset className="min-w-0 space-y-4">
      <legend className="flex items-center gap-3 text-sm font-semibold text-ink">
        <span className="font-mono text-xs text-ink-3">02 /</span>
        Mikor úsznál?
      </legend>

      <div className="grid grid-cols-3 border border-line bg-surface">
        {QUICK_SLOTS.map((q) => {
          const slot = q.build();
          const active = isActive(slot);
          return (
            <button
              key={q.label}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(q.build())}
              className={[
                'min-h-11 px-2 py-2 text-xs font-semibold transition-colors sm:text-sm',
                active
                  ? 'bg-pool text-pool-ink'
                  : 'text-ink-2 hover:bg-surface-2 hover:text-pool',
              ].join(' ')}
            >
              {q.label}
            </button>
          );
        })}
      </div>

      <DateField
        label="Nap"
        value={value.date}
        onChange={(date) => onChange({ ...value, date })}
      />

      <div className="grid grid-cols-2 gap-3">
        <TimeField
          label="Kezdés"
          value={value.start}
          onChange={(start) => onChange({ ...value, start })}
          invalid={Boolean(error)}
          describedBy={error ? errorId : undefined}
        />
        <TimeField
          label="Befejezés"
          value={value.end}
          onChange={(end) => onChange({ ...value, end })}
          invalid={Boolean(error)}
          describedBy={error ? errorId : undefined}
        />
      </div>

      {error && (
        <p
          id={errorId}
          role="alert"
          className="rounded-xl bg-danger-bg px-3.5 py-2.5 text-sm font-medium text-danger"
        >
          {error}
        </p>
      )}
    </fieldset>
  );
}
