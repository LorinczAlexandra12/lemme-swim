import { describe, expect, it } from 'vitest';
import {
  CALENDAR_ROWS,
  HU_WEEKDAY_SHORT,
  monthGrid,
  monthLabel,
  monthOf,
  shiftDays,
  shiftMonth,
} from '@/lib/ui/calendar';

describe('monthGrid', () => {
  it('hétfővel kezdi a hetet', () => {
    // 2026. október 1. csütörtök → a sor hétfővel, szeptember 28-cal indul.
    const [firstWeek] = monthGrid(2026, 9);
    expect(firstWeek[0].iso).toBe('2026-09-28');
    expect(firstWeek[3].iso).toBe('2026-10-01');
  });

  it('a hónap 1-jével kezdődő hetet nem tolja el', () => {
    // 2026. június 1. hétfő — nincs mit kitölteni előtte.
    const [firstWeek] = monthGrid(2026, 5);
    expect(firstWeek[0].iso).toBe('2026-06-01');
    expect(firstWeek[0].inMonth).toBe(true);
  });

  it('vasárnappal kezdődő hónapnál hat napot tölt ki elöl', () => {
    // 2026. február 1. vasárnap → a hete január 26-án, hétfőn kezdődik.
    const [firstWeek] = monthGrid(2026, 1);
    expect(firstWeek[0].iso).toBe('2026-01-26');
    expect(firstWeek[6].iso).toBe('2026-02-01');
    expect(firstWeek[6].inMonth).toBe(true);
  });

  it('mindig teljes, azonos méretű rácsot ad', () => {
    for (let month = 0; month < 12; month += 1) {
      const weeks = monthGrid(2026, month);
      expect(weeks).toHaveLength(CALENDAR_ROWS);
      for (const week of weeks) expect(week).toHaveLength(7);
    }
  });

  it('az utolsó két oszlop a hétvége', () => {
    const [week] = monthGrid(2026, 9);
    expect(week.map((c) => c.weekend)).toEqual([
      false,
      false,
      false,
      false,
      false,
      true,
      true,
    ]);
    expect(HU_WEEKDAY_SHORT[5]).toBe('Szo');
    expect(HU_WEEKDAY_SHORT[6]).toBe('V');
  });

  it('a hónap minden napját pontosan egyszer tartalmazza', () => {
    const inMonth = monthGrid(2026, 1) // február, 28 nap
      .flat()
      .filter((c) => c.inMonth)
      .map((c) => c.iso);
    expect(inMonth).toHaveLength(28);
    expect(new Set(inMonth).size).toBe(28);
    expect(inMonth[0]).toBe('2026-02-01');
    expect(inMonth[27]).toBe('2026-02-28');
  });

  it('szökőévet is helyesen kezel', () => {
    const inMonth = monthGrid(2028, 1).flat().filter((c) => c.inMonth);
    expect(inMonth).toHaveLength(29);
  });
});

describe('shiftMonth', () => {
  it('évfordulón át lép előre és hátra', () => {
    expect(shiftMonth(2026, 11, 1)).toEqual({ year: 2027, month: 0 });
    expect(shiftMonth(2026, 0, -1)).toEqual({ year: 2025, month: 11 });
    expect(shiftMonth(2026, 5, 0)).toEqual({ year: 2026, month: 5 });
  });
});

describe('shiftDays', () => {
  it('hónap- és évhatáron is helyesen lép', () => {
    expect(shiftDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(shiftDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(shiftDays('2026-10-12', 7)).toBe('2026-10-19');
  });

  it('érvénytelen bemenetet változatlanul ad vissza', () => {
    expect(shiftDays('nem-datum', 1)).toBe('nem-datum');
  });
});

describe('monthLabel és monthOf', () => {
  it('magyar hónapnevet ad', () => {
    expect(monthLabel(2026, 9)).toBe('2026. október');
    expect(monthLabel(2026, 0)).toBe('2026. január');
  });

  it('ISO dátumból kiolvassa a hónapot', () => {
    expect(monthOf('2026-10-12')).toEqual({ year: 2026, month: 9 });
  });
});
