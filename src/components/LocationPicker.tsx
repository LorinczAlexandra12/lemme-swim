'use client';

import { useId, useState } from 'react';
import { BUDAPEST_DISTRICTS, findDistrict } from '@/lib/ui/districts';
import { fullAddress, type GeocodeHit } from '@/lib/ui/geocode';
import { AddressSearch } from './AddressSearch';

export interface Origin {
  lat: number;
  lon: number;
  /** Amit a felhasználónak mutatunk, pl. "XIII. kerület (Angyalföld)". */
  label: string;
  source: 'geo' | 'district' | 'address';
}

export type GeoStatus = 'idle' | 'pending' | 'denied' | 'unavailable' | 'timeout' | 'unsupported';

/** Minden hibaág kap saját, cselekvésre biztató magyar üzenetet. */
const GEO_MESSAGE: Record<Exclude<GeoStatus, 'idle' | 'pending'>, string> = {
  denied:
    'A böngésző nem engedi a helymeghatározást. Engedélyezd a címsor melletti lakat ikonnál, vagy add meg a címed alább — úgy is működik a kereső.',
  unavailable:
    'A helyzeted most nem állapítható meg. Ez beltérben gyakori. Add meg a címed alább, vagy próbáld újra.',
  timeout: 'A helymeghatározás túl sokáig tartott. Próbáld újra, vagy add meg a címed alább.',
  unsupported: 'Ez a böngésző nem tud helymeghatározást. Add meg a címed alább.',
};

interface LocationPickerProps {
  origin: Origin | null;
  onOriginChange: (origin: Origin) => void;
  /** Kompakt megjelenés a ragadós vezérlősávban. */
  compact?: boolean;
}

export function LocationPicker({ origin, onOriginChange, compact = false }: LocationPickerProps) {
  const [status, setStatus] = useState<GeoStatus>('idle');
  const selectId = useId();

  function requestGeolocation() {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      setStatus('unsupported');
      return;
    }
    setStatus('pending');
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setStatus('idle');
        onOriginChange({
          lat: position.coords.latitude,
          lon: position.coords.longitude,
          label: 'A jelenlegi helyzeted',
          source: 'geo',
        });
      },
      (error) => {
        if (error.code === error.PERMISSION_DENIED) setStatus('denied');
        else if (error.code === error.TIMEOUT) setStatus('timeout');
        else setStatus('unavailable');
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    );
  }

  function pickDistrict(code: string) {
    const district = findDistrict(code);
    if (!district) return;
    setStatus('idle');
    onOriginChange({
      lat: district.lat,
      lon: district.lon,
      label: district.label,
      source: 'district',
    });
  }

  function pickAddress(hit: GeocodeHit) {
    setStatus('idle');
    onOriginChange({
      lat: hit.lat,
      lon: hit.lon,
      label: fullAddress(hit),
      source: 'address',
    });
  }

  const pending = status === 'pending';
  const errorText = status !== 'idle' && status !== 'pending' ? GEO_MESSAGE[status] : null;

  return (
    <div className={compact ? 'space-y-2' : 'space-y-3'}>
      <div className={compact ? 'flex flex-wrap items-center gap-2' : 'space-y-3'}>
        <button
          type="button"
          onClick={requestGeolocation}
          disabled={pending}
          // Másodlagos kinézet: az oldal egyetlen kitöltött gombja a Keresés,
          // mert az indítja el a lekérdezést.
          className={[
            'inline-flex items-center justify-center gap-2 rounded-xl bg-surface-2 font-semibold text-pool',
            'ring-1 ring-inset ring-line transition-colors hover:bg-pool-soft disabled:opacity-70',
            compact ? 'px-3 py-2 text-sm' : 'w-full px-5 py-4 text-base',
          ].join(' ')}
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 20 20"
            className={compact ? 'h-4 w-4' : 'h-5 w-5'}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
          >
            <circle cx="10" cy="10" r="3" />
            <circle cx="10" cy="10" r="7" />
            <path d="M10 1v2M10 17v2M1 10h2M17 10h2" strokeLinecap="round" />
          </svg>
          {pending
            ? 'Helyzet keresése…'
            : origin?.source === 'geo'
              ? 'Helyzet frissítése'
              : 'Helyzetem megosztása'}
        </button>

        {!compact && (
          <div className="flex items-center gap-3">
            <span className="h-px flex-1 bg-line" />
            <span className="text-xs font-medium text-ink-3">vagy</span>
            <span className="h-px flex-1 bg-line" />
          </div>
        )}

        <div className={compact ? 'min-w-48 flex-1' : ''}>
          <AddressSearch onPick={pickAddress} compact={compact} />
        </div>

        <div className={compact ? '' : 'space-y-1.5'}>
          <label
            htmlFor={selectId}
            className={compact ? 'sr-only-text' : 'block text-sm font-medium text-ink-2'}
          >
            Vagy válassz kerületet
          </label>
          <select
            id={selectId}
            value={origin?.source === 'district' ? findLabelCode(origin.label) : ''}
            onChange={(e) => pickDistrict(e.target.value)}
            className={[
              'w-full rounded-xl border border-line bg-surface text-ink',
              'focus:border-pool',
              compact ? 'px-3 py-2 text-sm' : 'px-4 py-3.5 text-base',
            ].join(' ')}
          >
            <option value="">Kerület kiválasztása…</option>
            {BUDAPEST_DISTRICTS.map((d) => (
              <option key={d.code} value={d.code}>
                {d.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {errorText && (
        <p
          role="status"
          className="rounded-xl bg-amber-bg px-3.5 py-2.5 text-sm leading-snug text-amber ring-1 ring-inset ring-amber-line"
        >
          {errorText}
        </p>
      )}

      {origin && !errorText && !compact && (
        <p className="text-sm text-ink-2">
          Innen keresünk: <strong className="font-semibold text-ink">{origin.label}</strong>
          {origin.source === 'district' && (
            <span className="block text-xs text-ink-3">
              A kerület középpontjától mért távolság — a pontos sorrendhez add meg az utcát is.
            </span>
          )}
        </p>
      )}
    </div>
  );
}

function findLabelCode(label: string): string {
  return BUDAPEST_DISTRICTS.find((d) => d.label === label)?.code ?? '';
}
