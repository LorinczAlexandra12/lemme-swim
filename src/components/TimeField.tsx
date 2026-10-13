'use client';

import { useId } from 'react';
import type { TimeOfDay } from '@/lib/types';
import { minutesOfDay } from '@/lib/ui/format';

/** Ötperces lépcső — ennyi pontosság elég egy úszáshoz, és rövid a lista. */
const MINUTE_STEP = 5;

const HOURS = Array.from({ length: 24 }, (_, h) => String(h).padStart(2, '0'));

interface TimeFieldProps {
  value: TimeOfDay;
  onChange: (value: TimeOfDay) => void;
  label: string;
  invalid?: boolean;
  describedBy?: string;
}

/**
 * Időpontválasztó 24 órás alakban.
 *
 * Saját vezérlő, nem natív `<input type="time">`: az de./du. alakot használ, ha
 * a böngésző területi beállítása úgy kívánja, és ezt az oldal nem tudja
 * felülbírálni. Magyarul az idő mindig 24 órás.
 */
export function TimeField({ value, onChange, label, invalid, describedBy }: TimeFieldProps) {
  const labelId = useId();

  const total = minutesOfDay(value);
  const safe = Number.isNaN(total) ? 0 : total;
  const hour = String(Math.floor(safe / 60)).padStart(2, '0');
  const minute = String(safe % 60).padStart(2, '0');

  // Ha a kapott perc nem esik a lépcsőre (pl. mentett „most" érték), azért
  // felvesszük a listába — különben a select némán másik időpontot mutatna.
  const minutes = Array.from({ length: 60 / MINUTE_STEP }, (_, i) =>
    String(i * MINUTE_STEP).padStart(2, '0'),
  );
  if (!minutes.includes(minute)) {
    minutes.push(minute);
    minutes.sort();
  }

  const selectClass =
    'appearance-none bg-transparent py-3 text-base font-medium text-ink tnum focus-visible:outline-none';

  return (
    <div className="space-y-1.5">
      <span id={labelId} className="block text-sm font-medium text-ink-2">
        {label}
      </span>
      {/* A két legördülő egy mezőként olvasódik: óra, kettőspont, perc. */}
      <div
        className={[
          'flex items-center rounded-xl border bg-surface px-3',
          'focus-within:border-pool',
          invalid ? 'border-danger' : 'border-line',
        ].join(' ')}
      >
        <select
          aria-label={`${label} órája`}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          value={hour}
          onChange={(e) => onChange(`${e.target.value}:${minute}`)}
          className={`${selectClass} pl-1 pr-0.5`}
        >
          {HOURS.map((h) => (
            <option key={h} value={h}>
              {h}
            </option>
          ))}
        </select>
        <span aria-hidden="true" className="px-0.5 text-base font-medium text-ink-3">
          :
        </span>
        <select
          aria-label={`${label} perce`}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          value={minute}
          onChange={(e) => onChange(`${hour}:${e.target.value}`)}
          className={`${selectClass} pl-0.5 pr-0.5`}
        >
          {minutes.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <svg
          aria-hidden="true"
          viewBox="0 0 20 20"
          className="ml-auto h-5 w-5 shrink-0 text-ink-3"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
        >
          <circle cx="10" cy="10" r="7.25" />
          <path d="M10 5.75V10l3 1.75" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    </div>
  );
}
