/**
 * Idő- és dátumkezelés. Minden időpont Europe/Budapest helyi idő.
 *
 * Fontos: ez a modul szándékosan NEM használ `Date`-et a naptári számításokhoz.
 * A `Date` a futtató gép időzónájától függ, ami nyári időszámítás-váltáskor
 * (március végén és október végén) elcsúsztatná a hétköznapot. Helyette tiszta
 * egész-aritmetikával dolgozunk a "YYYY-MM-DD" karakterláncon.
 */

import type { IsoDate, TimeOfDay, Weekday } from './types';

/** Egy időintervallum percekben, éjféltől számolva. */
export interface MinuteRange {
  start: number;
  end: number;
}

/** Egy időintervallum "HH:MM" alakban. */
export interface TimeRange {
  start: TimeOfDay;
  end: TimeOfDay;
}

export const MINUTES_PER_DAY = 24 * 60;

const TIME_RE = /^(\d{1,2}):(\d{2})$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * "HH:MM" → percek éjféltől. Érvénytelen bemenetre `NaN`.
 * A "24:00" külön megengedett: a nap végét jelenti (záróra éjfélkor).
 */
export function toMinutes(time: TimeOfDay): number {
  if (typeof time !== 'string') return Number.NaN;
  const match = TIME_RE.exec(time.trim());
  if (!match) return Number.NaN;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (minutes > 59) return Number.NaN;
  if (hours === 24 && minutes === 0) return MINUTES_PER_DAY;
  if (hours > 23) return Number.NaN;
  return hours * 60 + minutes;
}

/** Percek éjféltől → "HH:MM". A napon túlnyúló értéket levágjuk. */
export function fromMinutes(total: number): TimeOfDay {
  if (!Number.isFinite(total)) return '00:00';
  const clamped = Math.max(0, Math.min(MINUTES_PER_DAY, Math.round(total)));
  const hours = Math.floor(clamped / 60);
  const minutes = clamped % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/** Igaz, ha a "HH:MM" érvényes. */
export function isValidTime(time: TimeOfDay): boolean {
  return Number.isFinite(toMinutes(time));
}

/**
 * Két időpont összehasonlítása: negatív, ha `a` korábbi.
 * Érvénytelen bemenet a lista végére kerül (0-t adunk vissza rendezéskor).
 */
export function compareTimes(a: TimeOfDay, b: TimeOfDay): number {
  const aMin = toMinutes(a);
  const bMin = toMinutes(b);
  if (!Number.isFinite(aMin) || !Number.isFinite(bMin)) return 0;
  return aMin - bMin;
}

/**
 * Egy "HH:MM" intervallum percekre váltva.
 * Ha a záró időpont nem későbbi a kezdésnél, a nap végét (24:00) feltételezzük —
 * a publikált nyitvatartások sokszor "06:00–00:00" alakban jelennek meg.
 * `null`, ha a bemenet értelmezhetetlen.
 */
export function toMinuteRange(range: TimeRange): MinuteRange | null {
  const start = toMinutes(range?.start);
  let end = toMinutes(range?.end);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (end <= start) {
    // "06:00–00:00" → éjfélig tart. Valódi éjfél utáni zárást nem kezelünk.
    if (end === 0) end = MINUTES_PER_DAY;
    else return null;
  }
  return { start, end };
}

/**
 * Két intervallum átfedése percben. 0, ha nincs átfedés vagy a bemenet hibás.
 * A határok félig nyíltak: a 08:00–09:00 és a 09:00–10:00 nem fed át.
 */
export function overlapMinutes(a: TimeRange, b: TimeRange): number {
  const rangeA = toMinuteRange(a);
  const rangeB = toMinuteRange(b);
  if (!rangeA || !rangeB) return 0;
  return Math.max(0, Math.min(rangeA.end, rangeB.end) - Math.max(rangeA.start, rangeB.start));
}

/** Igaz, ha a két intervallum legalább egy percben átfed. */
export function rangesOverlap(a: TimeRange, b: TimeRange): boolean {
  return overlapMinutes(a, b) > 0;
}

// ---------------------------------------------------------------------------
// Naptári számítások — időzóna-függetlenül
// ---------------------------------------------------------------------------

interface CalendarDate {
  year: number;
  month: number; // 1..12
  day: number; // 1..31
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  const lengths = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return lengths[month - 1];
}

/** "YYYY-MM-DD" → naptári mezők, vagy `null`, ha a dátum nem létezik. */
export function parseIsoDate(date: IsoDate): CalendarDate | null {
  if (typeof date !== 'string') return null;
  const match = DATE_RE.exec(date.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day };
}

export function isValidIsoDate(date: IsoDate): boolean {
  return parseIsoDate(date) !== null;
}

/**
 * "YYYY-MM-DD" → ISO hétköznap (1 = hétfő … 7 = vasárnap).
 *
 * Sakamoto algoritmusa: tisztán egész-aritmetika a naptári mezőkön, így
 * a nyári időszámítás váltása és a futtató gép időzónája nem befolyásolja.
 * Érvénytelen dátumra `null`.
 */
export function isoWeekday(date: IsoDate): Weekday | null {
  const parsed = parseIsoDate(date);
  if (!parsed) return null;

  const offsets = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4];
  let year = parsed.year;
  if (parsed.month < 3) year -= 1;

  const sunday0 =
    (year +
      Math.floor(year / 4) -
      Math.floor(year / 100) +
      Math.floor(year / 400) +
      offsets[parsed.month - 1] +
      parsed.day) %
    7;

  // Sakamoto 0 = vasárnap; az ISO szabvány szerint a vasárnap a 7.
  return (sunday0 === 0 ? 7 : sunday0) as Weekday;
}

// ---------------------------------------------------------------------------
// Magyar megjelenítés
// ---------------------------------------------------------------------------

/** A hét napjai magyarul, ISO sorrendben. */
export const WEEKDAY_NAMES_HU: Record<Weekday, string> = {
  1: 'hétfő',
  2: 'kedd',
  3: 'szerda',
  4: 'csütörtök',
  5: 'péntek',
  6: 'szombat',
  7: 'vasárnap',
};

/** Rövidített napnevek, pl. sávdiagram fejlécéhez. */
export const WEEKDAY_ABBR_HU: Record<Weekday, string> = {
  1: 'H',
  2: 'K',
  3: 'Sze',
  4: 'Cs',
  5: 'P',
  6: 'Szo',
  7: 'V',
};

const MONTH_NAMES_HU = [
  'január',
  'február',
  'március',
  'április',
  'május',
  'június',
  'július',
  'augusztus',
  'szeptember',
  'október',
  'november',
  'december',
];

/** ISO hétköznap → magyar napnév, pl. `3` → "szerda". */
export function weekdayNameHu(weekday: Weekday): string {
  return WEEKDAY_NAMES_HU[weekday] ?? '';
}

/** "YYYY-MM-DD" → magyar napnév, pl. "csütörtök". Érvénytelen dátumra "". */
export function formatWeekdayHu(date: IsoDate): string {
  const weekday = isoWeekday(date);
  return weekday === null ? '' : WEEKDAY_NAMES_HU[weekday];
}

/**
 * "YYYY-MM-DD" → magyar dátum, pl. "2026. szeptember 24.".
 * Érvénytelen bemenetet változatlanul visszaadunk, hogy ne tűnjön el adat.
 */
export function formatDateHu(date: IsoDate): string {
  const parsed = parseIsoDate(date);
  if (!parsed) return typeof date === 'string' ? date : '';
  return `${parsed.year}. ${MONTH_NAMES_HU[parsed.month - 1]} ${parsed.day}.`;
}

/** "2026. szeptember 24., csütörtök" — teljes magyar dátumfejléc. */
export function formatDateWithWeekdayHu(date: IsoDate): string {
  const weekday = formatWeekdayHu(date);
  const formatted = formatDateHu(date);
  return weekday ? `${formatted}, ${weekday}` : formatted;
}

/** "18:00–19:30" — magyar helyesírás szerint nagykötőjellel. */
export function formatTimeRangeHu(range: TimeRange): string {
  return `${range.start}–${range.end}`;
}

/** Percek magyar időtartamként, pl. `95` → "1 óra 35 perc". */
export function formatDurationHu(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return '0 perc';
  const rounded = Math.round(minutes);
  const hours = Math.floor(rounded / 60);
  const mins = rounded % 60;
  if (hours === 0) return `${mins} perc`;
  if (mins === 0) return `${hours} óra`;
  return `${hours} óra ${mins} perc`;
}
