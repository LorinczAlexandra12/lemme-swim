/**
 * UI-oldali formázó segédfüggvények. Minden kimenet magyar.
 * (Csak megjelenítés — üzleti logika nincs benne.)
 */

import type { IsoDate, TimeOfDay } from '@/lib/types';

/** "1,8 km" vagy közel esetén "850 m". `null` → "Ismeretlen távolság". */
export function formatDistance(km: number | null): string {
  if (km === null || !Number.isFinite(km)) return 'Ismeretlen távolság';
  if (km < 1) {
    const meters = Math.max(10, Math.round((km * 1000) / 10) * 10);
    return `${meters} m`;
  }
  return `${km.toFixed(1).replace('.', ',')} km`;
}

/** Hosszú magyar dátum, pl. "2026. szeptember 12.". */
export function formatHuDate(iso?: IsoDate): string {
  if (!iso) return '';
  const date = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('hu-HU', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(date);
}

/** Rövid magyar dátum, pl. "2026. szept. 12.". */
export function formatHuDateShort(iso?: IsoDate): string {
  if (!iso) return '';
  const date = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('hu-HU', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(date);
}

/** "szerda" — a kért nap neve. */
export function formatWeekdayName(iso: IsoDate): string {
  const date = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('hu-HU', { weekday: 'long' }).format(date);
}

/** ISO hétköznap (1 = hétfő … 7 = vasárnap) egy dátumból. */
export function weekdayOf(iso: IsoDate): number {
  const date = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(date.getTime())) return 1;
  const js = date.getDay(); // 0 = vasárnap
  return js === 0 ? 7 : js;
}

export function toIsoDate(date: Date): IsoDate {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function todayIso(): IsoDate {
  return toIsoDate(new Date());
}

export function tomorrowIso(): IsoDate {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return toIsoDate(d);
}

/** "HH:MM" → percek éjféltől. Érvénytelen bemenetre NaN. */
export function minutesOfDay(time: TimeOfDay): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time ?? '');
  if (!match) return Number.NaN;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 23 || m > 59) return Number.NaN;
  return h * 60 + m;
}

export function fromMinutes(total: number): TimeOfDay {
  const clamped = Math.max(0, Math.min(23 * 60 + 59, Math.round(total)));
  const h = String(Math.floor(clamped / 60)).padStart(2, '0');
  const m = String(clamped % 60).padStart(2, '0');
  return `${h}:${m}`;
}

/** A következő egész óra, pl. 18:42 → "19:00". Késő este 22:00-nál megáll. */
export function nextFullHour(now = new Date()): TimeOfDay {
  const minutes = now.getHours() * 60 + now.getMinutes();
  const rounded = Math.ceil(minutes / 60) * 60;
  return fromMinutes(Math.min(rounded, 22 * 60));
}

export function addMinutes(time: TimeOfDay, delta: number): TimeOfDay {
  const base = minutesOfDay(time);
  if (Number.isNaN(base)) return time;
  return fromMinutes(base + delta);
}

/** "18:00–19:00" — nagykötőjellel, ahogy a magyar helyesírás kéri. */
export function formatRange(start: TimeOfDay, end: TimeOfDay): string {
  return `${start}–${end}`;
}

/** "4 / 8 sáv szabad" — a sávmérő szöveges párja. */
export function formatLaneCount(free: number | null, total: number | null): string {
  if (free === null || total === null) return 'Nincs sávadat';
  return `${free} / ${total} sáv szabad`;
}
