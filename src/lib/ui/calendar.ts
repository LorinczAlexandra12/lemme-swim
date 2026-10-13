/**
 * Naptárrács hétfős kezdéssel.
 *
 * A natív `<input type="date">` a böngésző területi beállítása szerint kezdi a
 * hetet — egy en-US gépen vasárnappal. Magyarországon a hét hétfővel kezdődik,
 * és az uszodabeosztások is hétfőtől vasárnapig sorolják a napokat, ezért a
 * naptárat magunk rajzoljuk. Ez a modul csak a dátumszámítás, megjelenítés
 * nélkül — így tesztelhető.
 */

import type { IsoDate } from '@/lib/types';
import { toIsoDate } from './format';

/** A rács mindig 6 sor: így a hónapok között lépkedve nem ugrál a magasság. */
export const CALENDAR_ROWS = 6;

export const HU_MONTHS = [
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
] as const;

/** Oszlopfejlécek hétfőtől vasárnapig. */
export const HU_WEEKDAY_SHORT = ['H', 'K', 'Sze', 'Cs', 'P', 'Szo', 'V'] as const;

export const HU_WEEKDAY_LONG = [
  'hétfő',
  'kedd',
  'szerda',
  'csütörtök',
  'péntek',
  'szombat',
  'vasárnap',
] as const;

export interface CalendarCell {
  iso: IsoDate;
  /** Hamis a rácsot kitöltő előző/következő havi napokra. */
  inMonth: boolean;
  /** 6 = szombat, 7 = vasárnap — a hétvégi nyitvatartás máshogy alakul. */
  weekend: boolean;
}

/** Egy hónap megjelenítendő címkéje, pl. "2026. október". */
export function monthLabel(year: number, month: number): string {
  return `${year}. ${HU_MONTHS[month]}`;
}

/** Hónapléptetés évfordulóval együtt. `month` 0–11. */
export function shiftMonth(
  year: number,
  month: number,
  delta: number,
): { year: number; month: number } {
  const total = year * 12 + month + delta;
  return { year: Math.floor(total / 12), month: ((total % 12) + 12) % 12 };
}

/** ISO hétköznap egy Date-ből: 1 = hétfő … 7 = vasárnap. */
function isoWeekday(date: Date): number {
  const js = date.getDay(); // 0 = vasárnap
  return js === 0 ? 7 : js;
}

/**
 * Egy hónap rácsa hetekre bontva, hétfős kezdéssel.
 *
 * A rács elejét az előző hónap, a végét a következő hónap napjai töltik ki, így
 * minden sor teljes hét — a felhasználó látja, melyik nap hová esik.
 */
export function monthGrid(year: number, month: number): CalendarCell[][] {
  const first = new Date(year, month, 1);
  // Hány napot kell visszalépni, hogy hétfőn kezdjünk.
  const lead = isoWeekday(first) - 1;

  const weeks: CalendarCell[][] = [];
  const cursor = new Date(year, month, 1 - lead);

  for (let row = 0; row < CALENDAR_ROWS; row += 1) {
    const week: CalendarCell[] = [];
    for (let col = 0; col < 7; col += 1) {
      week.push({
        iso: toIsoDate(cursor),
        inMonth: cursor.getMonth() === month,
        weekend: col >= 5,
      });
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(week);
  }

  return weeks;
}

/** Napléptetés ISO dátumon — a nyílbillentyűs navigációhoz. */
export function shiftDays(iso: IsoDate, delta: number): IsoDate {
  const date = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(date.getTime())) return iso;
  date.setDate(date.getDate() + delta);
  return toIsoDate(date);
}

/** Az ISO dátum év/hónap része, a rács kirajzolásához. */
export function monthOf(iso: IsoDate): { year: number; month: number } {
  const date = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(date.getTime())) {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  }
  return { year: date.getFullYear(), month: date.getMonth() };
}
