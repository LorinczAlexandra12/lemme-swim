import { describe, expect, it } from 'vitest';
import type { Weekday } from '../types';
import {
  formatDateHu,
  formatDateWithWeekdayHu,
  formatDurationHu,
  formatTimeRangeHu,
  formatWeekdayHu,
  fromMinutes,
  isValidIsoDate,
  isoWeekday,
  overlapMinutes,
  parseIsoDate,
  toMinuteRange,
  toMinutes,
  weekdayNameHu,
} from '../time';

describe('toMinutes / fromMinutes', () => {
  it('"HH:MM" → percek éjféltől', () => {
    expect(toMinutes('00:00')).toBe(0);
    expect(toMinutes('06:30')).toBe(390);
    expect(toMinutes('18:45')).toBe(1125);
    expect(toMinutes('23:59')).toBe(1439);
  });

  it('a 24:00-t a nap végeként fogadja el', () => {
    expect(toMinutes('24:00')).toBe(1440);
  });

  it('érvénytelen időre NaN', () => {
    expect(toMinutes('25:00')).toBeNaN();
    expect(toMinutes('12:60')).toBeNaN();
    expect(toMinutes('délután')).toBeNaN();
    expect(toMinutes('')).toBeNaN();
    expect(toMinutes(undefined as unknown as string)).toBeNaN();
  });

  it('oda-vissza alakítható', () => {
    expect(fromMinutes(toMinutes('07:05'))).toBe('07:05');
    expect(fromMinutes(0)).toBe('00:00');
    expect(fromMinutes(1439)).toBe('23:59');
  });
});

describe('toMinuteRange', () => {
  it('normál intervallumot percekre vált', () => {
    expect(toMinuteRange({ start: '08:00', end: '10:30' })).toEqual({ start: 480, end: 630 });
  });

  it('a "06:00–00:00" zárást éjfélnek érti', () => {
    expect(toMinuteRange({ start: '06:00', end: '00:00' })).toEqual({ start: 360, end: 1440 });
  });

  it('visszafelé haladó intervallumra null', () => {
    expect(toMinuteRange({ start: '10:00', end: '09:00' })).toBeNull();
    expect(toMinuteRange({ start: '10:00', end: '10:00' })).toBeNull();
  });
});

describe('overlapMinutes', () => {
  it('részleges átfedést percben ad meg', () => {
    expect(overlapMinutes({ start: '08:00', end: '10:00' }, { start: '09:30', end: '11:00' })).toBe(30);
  });

  it('teljes tartalmazásnál a rövidebb hosszát adja', () => {
    expect(overlapMinutes({ start: '08:00', end: '12:00' }, { start: '09:00', end: '09:45' })).toBe(45);
  });

  it('érintkező intervallumok nem fednek át', () => {
    expect(overlapMinutes({ start: '08:00', end: '09:00' }, { start: '09:00', end: '10:00' })).toBe(0);
  });

  it('teljesen különálló intervallumokra 0', () => {
    expect(overlapMinutes({ start: '08:00', end: '09:00' }, { start: '15:00', end: '16:00' })).toBe(0);
  });

  it('sorrendtől független', () => {
    const a = { start: '08:00', end: '10:00' };
    const b = { start: '09:30', end: '11:00' };
    expect(overlapMinutes(a, b)).toBe(overlapMinutes(b, a));
  });

  it('érvénytelen bemenetre 0, nem NaN', () => {
    expect(overlapMinutes({ start: 'x', end: '10:00' }, { start: '09:00', end: '11:00' })).toBe(0);
  });
});

describe('parseIsoDate', () => {
  it('érvényes dátumot bont', () => {
    expect(parseIsoDate('2026-09-24')).toEqual({ year: 2026, month: 9, day: 24 });
  });

  it('nem létező naptári napot elutasít', () => {
    expect(parseIsoDate('2026-02-30')).toBeNull();
    expect(parseIsoDate('2025-02-29')).toBeNull();
    expect(parseIsoDate('2026-13-01')).toBeNull();
    expect(parseIsoDate('2026-00-10')).toBeNull();
    expect(parseIsoDate('2026-9-24')).toBeNull();
    expect(parseIsoDate('nem dátum')).toBeNull();
  });

  it('a szökőnapot elfogadja', () => {
    expect(isValidIsoDate('2024-02-29')).toBe(true);
    expect(isValidIsoDate('2000-02-29')).toBe(true);
    expect(isValidIsoDate('1900-02-29')).toBe(false); // 1900 nem szökőév
  });
});

describe('isoWeekday', () => {
  it('ismert dátumokra a helyes ISO hétköznapot adja', () => {
    expect(isoWeekday('2026-09-24')).toBe(4); // csütörtök
    expect(isoWeekday('2026-01-01')).toBe(4); // csütörtök
    expect(isoWeekday('2000-02-29')).toBe(2); // kedd, szökőnap
    expect(isoWeekday('2026-09-28')).toBe(1); // hétfő
    expect(isoWeekday('2026-09-27')).toBe(7); // vasárnap — sosem 0
  });

  it('érvénytelen dátumra null', () => {
    expect(isoWeekday('2026-02-30')).toBeNull();
    expect(isoWeekday('')).toBeNull();
  });

  // --- Nyári időszámítás -----------------------------------------------
  // Ezek a napok azok, amikor a naiv `new Date(iso)` alapú megoldás elcsúszik:
  // az óraátállítás miatt a helyi éjfél 23 vagy 25 órás napba esik.

  it('a tavaszi óraátállítás napját helyesen adja meg', () => {
    // 2026. március 29., vasárnap — ekkor ugrik előre az óra Budapesten.
    expect(isoWeekday('2026-03-29')).toBe(7);
    expect(isoWeekday('2026-03-28')).toBe(6);
    expect(isoWeekday('2026-03-30')).toBe(1);
  });

  it('az őszi óraátállítás napját helyesen adja meg', () => {
    // 2026. október 25., vasárnap — ekkor kerül vissza az óra.
    expect(isoWeekday('2026-10-25')).toBe(7);
    expect(isoWeekday('2026-10-24')).toBe(6);
    expect(isoWeekday('2026-10-26')).toBe(1);
  });

  it('az óraátállítás körüli napokon sem ugrik és nem ismétel', () => {
    // Ha bármelyik nap egy időzóna-hiba miatt elcsúszna, a ciklus megtörne.
    const check = (dates: string[]) => {
      const weekdays = dates.map((d) => isoWeekday(d));
      for (let i = 1; i < weekdays.length; i += 1) {
        const previous = weekdays[i - 1] as Weekday;
        const current = weekdays[i] as Weekday;
        expect(current).toBe(((previous % 7) + 1) as Weekday);
      }
    };

    check([
      '2026-03-26',
      '2026-03-27',
      '2026-03-28',
      '2026-03-29',
      '2026-03-30',
      '2026-03-31',
      '2026-04-01',
    ]);
    check([
      '2026-10-22',
      '2026-10-23',
      '2026-10-24',
      '2026-10-25',
      '2026-10-26',
      '2026-10-27',
      '2026-10-28',
    ]);
  });

  it('hónap- és évfordulón is folytonos', () => {
    expect(isoWeekday('2026-12-31')).toBe(4);
    expect(isoWeekday('2027-01-01')).toBe(5);
    expect(isoWeekday('2024-02-28')).toBe(3);
    expect(isoWeekday('2024-02-29')).toBe(4);
    expect(isoWeekday('2024-03-01')).toBe(5);
  });
});

describe('magyar megjelenítés', () => {
  it('napneveket magyarul ad', () => {
    expect(weekdayNameHu(1)).toBe('hétfő');
    expect(weekdayNameHu(2)).toBe('kedd');
    expect(weekdayNameHu(3)).toBe('szerda');
    expect(weekdayNameHu(4)).toBe('csütörtök');
    expect(weekdayNameHu(5)).toBe('péntek');
    expect(weekdayNameHu(6)).toBe('szombat');
    expect(weekdayNameHu(7)).toBe('vasárnap');
  });

  it('dátumból napnevet ad', () => {
    expect(formatWeekdayHu('2026-09-24')).toBe('csütörtök');
    expect(formatWeekdayHu('2026-09-27')).toBe('vasárnap');
    expect(formatWeekdayHu('hibás')).toBe('');
  });

  it('magyar dátumformátumot ad', () => {
    expect(formatDateHu('2026-09-24')).toBe('2026. szeptember 24.');
    expect(formatDateHu('2026-01-05')).toBe('2026. január 5.');
    expect(formatDateHu('2026-12-31')).toBe('2026. december 31.');
  });

  it('teljes dátumfejlécet ad napnévvel', () => {
    expect(formatDateWithWeekdayHu('2026-09-24')).toBe('2026. szeptember 24., csütörtök');
  });

  it('idősávot nagykötőjellel ír', () => {
    expect(formatTimeRangeHu({ start: '18:00', end: '19:30' })).toBe('18:00–19:30');
  });

  it('időtartamot magyarul ír', () => {
    expect(formatDurationHu(95)).toBe('1 óra 35 perc');
    expect(formatDurationHu(45)).toBe('45 perc');
    expect(formatDurationHu(120)).toBe('2 óra');
    expect(formatDurationHu(0)).toBe('0 perc');
  });
});
