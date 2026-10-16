'use client';

import { useId } from 'react';
import { BUDAPEST_DISTRICTS, findDistrict } from '@/lib/ui/districts';

export interface Origin {
  lat: number;
  lon: number;
  /** Amit a felhasználónak mutatunk, pl. "XIII. kerület (Angyalföld)". */
  label: string;
  source: 'district';
}

interface LocationPickerProps {
  origin: Origin | null;
  onOriginChange: (origin: Origin) => void;
  /** Kompakt megjelenés a ragadós vezérlősávban. */
  compact?: boolean;
}

export function LocationPicker({ origin, onOriginChange, compact = false }: LocationPickerProps) {
  const selectId = useId();

  function pickDistrict(code: string) {
    const district = findDistrict(code);
    if (!district) return;
    onOriginChange({
      lat: district.lat,
      lon: district.lon,
      label: district.label,
      source: 'district',
    });
  }

  return (
    <div className="space-y-3">
        <div className="space-y-1.5">
          <label
            htmlFor={selectId}
            className="block text-sm font-semibold text-ink-2"
          >
            Kerület
          </label>
          <select
            id={selectId}
            value={origin ? findLabelCode(origin.label) : ''}
            onChange={(e) => pickDistrict(e.target.value)}
            className={[
              'w-full rounded-xl border border-line bg-surface text-ink',
              'focus:border-pool',
              compact ? 'px-3 py-2 text-sm' : 'px-4 py-3.5 text-base',
            ].join(' ')}
          >
            <option value="" disabled>Kerület kiválasztása…</option>
            {BUDAPEST_DISTRICTS.map((d) => (
              <option key={d.code} value={d.code}>
                {d.label}
              </option>
            ))}
          </select>
        </div>
      {!compact && (
        <p className="text-xs leading-relaxed text-ink-3">
          A távolságokat a kerület középpontjától számoljuk.
        </p>
      )}
    </div>
  );
}

function findLabelCode(label: string): string {
  return BUDAPEST_DISTRICTS.find((d) => d.label === label)?.code ?? '';
}
