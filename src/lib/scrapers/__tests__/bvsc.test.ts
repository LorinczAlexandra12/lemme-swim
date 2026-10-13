/**
 * A BVSC FacilityPilot sávnaptár-adapter tesztjei.
 *
 * A fixture a letesitmeny.bvsc.hu beágyazott naptárának 2026-09-24-én letöltött
 * VALÓDI HTML-válasza (2026.09.21.–09.27. hét, Új 50 m-es medence). Azért az
 * eredeti fájlon tesztelünk, mert a lényeg éppen a szerkezet: a `div.booking`
 * dobozok `title`/`span` felirata és a `width` százalék.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseBvscCalendar, parseTimeRange, parseWeekRange } from '../adapters/bvsc-facilitypilot';
import type { ParseContext, RawSource } from '../types';

const FIXTURE = path.join(__dirname, 'fixtures', 'bvsc-naptar-20260921.html');

function loadFixture(): RawSource {
  return {
    url: 'https://letesitmeny.bvsc.hu/naptar/beagyazas/1/…?nezet=week&objektum=2&felosztas=hosszanti',
    contentType: 'text/html; charset=utf-8',
    body: readFileSync(FIXTURE),
    fetchedAt: '2026-09-24T16:00:00.000Z',
    fromCache: true,
  };
}

function parse(): { blocks: ReturnType<typeof parseBvscCalendar>; warnings: string[] } {
  const warnings: string[] = [];
  const ctx: ParseContext = { warn: (message) => warnings.push(message) };
  return { blocks: parseBvscCalendar(loadFixture(), ctx), warnings };
}

describe('parseTimeRange', () => {
  it('felismeri a gondolatjeles időtartamot', () => {
    expect(parseTimeRange('edzés úszás · 06:00–09:00')).toEqual({ start: '06:00', end: '09:00' });
    expect(parseTimeRange('6:00-9:00')).toEqual({ start: '06:00', end: '09:00' });
  });

  it('elutasítja a hiányos vagy visszafelé haladó időtartamot', () => {
    expect(parseTimeRange('edzés')).toBeNull();
    expect(parseTimeRange('10:00–10:00')).toBeNull();
  });
});

describe('parseWeekRange', () => {
  it('kiolvassa a hetet a kártyacímből', () => {
    const week = parseWeekRange('Beosztás: 2026.09.21.–2026.09.27. · Új 50 méteres mednece · 50.0 m');
    expect(week?.start.toISOString().slice(0, 10)).toBe('2026-09-21');
    expect(week?.end.toISOString().slice(0, 10)).toBe('2026-09-27');
  });

  it('évfordulón átnyúló hétnél a záró dátum a következő évre esik', () => {
    const week = parseWeekRange('Beosztás: 2026.12.29.–01.04. · Új 50 méteres mednece');
    expect(week?.end.toISOString().slice(0, 10)).toBe('2027-01-04');
  });
});

describe('parseBvscCalendar — valódi naptár-HTML-en', () => {
  it('a hét mind a hét napjára ad dátumozott foglalást', () => {
    const { blocks } = parse();
    const dates = [...new Set(blocks.map((block) => block.date))].sort();
    expect(dates).toEqual([
      '2026-09-21',
      '2026-09-22',
      '2026-09-23',
      '2026-09-24',
      '2026-09-25',
      '2026-09-26',
      '2026-09-27',
    ]);
  });

  it('a szerződésnek megfelelő rekordokat állít elő', () => {
    const { blocks } = parse();
    expect(blocks.length).toBe(27);
    for (const block of blocks) {
      expect(block.poolId).toBe('bvsc-laky-karoly-sportuszoda');
      expect(block.basinId).toBe('50m-versenymedence');
      expect(block.weekday).toBeUndefined();
      expect(block.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(block.start).toMatch(/^([01]\d|2[0-3]):[0-5]\d$/);
      expect(block.end).toMatch(/^([01]\d|2[0-3]):[0-5]\d$/);
      expect(block.start < block.end).toBe(true);
      expect(Number.isInteger(block.lanesOccupied)).toBe(true);
      expect(block.lanesOccupied).toBeGreaterThan(0);
      expect(block.lanesOccupied).toBeLessThanOrEqual(8);
      expect(block.reason.length).toBeGreaterThan(0);
    }
  });

  it('egyetlen napon belül sem ad átfedő blokkokat', () => {
    const { blocks } = parse();
    for (const date of new Set(blocks.map((block) => block.date))) {
      const day = blocks.filter((block) => block.date === date).sort((a, b) => a.start.localeCompare(b.start));
      for (let i = 1; i < day.length; i += 1) {
        expect(day[i - 1].end <= day[i].start).toBe(true);
      }
    }
  });

  it('a hétfő reggeli edzést mind a nyolc sávra foglaltnak látja', () => {
    const { blocks } = parse();
    const morning = blocks.find((block) => block.date === '2026-09-21' && block.start === '06:00');
    expect(morning).toMatchObject({ end: '09:00', lanesOccupied: 8, kind: 'club' });
    expect(morning?.reason).toContain('edzés úszás');
  });

  it('a szombati mérkőzést eseményként osztályozza', () => {
    const { blocks } = parse();
    const match = blocks.find((block) => block.date === '2026-09-26' && block.start === '09:00');
    expect(match).toMatchObject({ end: '15:00', lanesOccupied: 8, kind: 'event' });
  });

  it('a vasárnapi egész napos vízilabdaedzést egyetlen blokként adja vissza', () => {
    const { blocks } = parse();
    const sunday = blocks.filter((block) => block.date === '2026-09-27');
    expect(sunday).toHaveLength(1);
    expect(sunday[0]).toMatchObject({ start: '06:00', end: '21:00', lanesOccupied: 8 });
  });

  it('nem panaszkodik a jelenlegi kiadásra', () => {
    const { warnings } = parse();
    expect(warnings).toEqual([]);
  });

  it('hibát dob, ha a naptártáblázat eltűnik', () => {
    const broken: RawSource = { ...loadFixture(), body: Buffer.from('<html><body>Hiba</body></html>') };
    expect(() => parseBvscCalendar(broken, { warn: () => {} })).toThrow(/table\.calendar/);
  });
});
