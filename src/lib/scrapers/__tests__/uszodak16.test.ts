/**
 * A XVI. kerületi „Szabad pályák a közönség részére" rács tesztjei.
 *
 * A két fixture a uszodak16.hu 2026-09-24-én letöltött VALÓDI válasza. Azért az
 * eredeti fájlokon tesztelünk, mert épp a szerkezet a lényeg: az oldalon több
 * táblázat is van hétköznap-fejléccel (köztük az eseménynaptár), és pontosan
 * azt kell tudnunk bizonyítani, hogy a helyeset választjuk ki.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ERZSEBETLIGETI,
  SZENTMIHALYI,
  parseUszodak16Cell,
  parseUszodak16Grid,
  parseUszodak16TimeRange,
  type Uszodak16Config,
} from '../adapters/uszodak16-szabad-palyak';
import type { ParseContext, RawSource } from '../types';

const FIXTURES: Record<string, string> = {
  [ERZSEBETLIGETI.id]: 'uszodak16-erzsebetligeti-20260924.html',
  [SZENTMIHALYI.id]: 'uszodak16-szentmihalyi-20260924.html',
};

function loadFixture(config: Uszodak16Config): RawSource {
  return {
    url: `${config.landingUrl}?content=dct&did=36`,
    contentType: 'text/html; charset=utf-8',
    body: readFileSync(path.join(__dirname, 'fixtures', FIXTURES[config.id])),
    fetchedAt: '2026-09-24T17:00:00.000Z',
    fromCache: true,
  };
}

function parse(config: Uszodak16Config) {
  const warnings: string[] = [];
  const ctx: ParseContext = { warn: (message) => warnings.push(message) };
  return { blocks: parseUszodak16Grid(loadFixture(config), ctx, config), warnings };
}

describe('parseUszodak16TimeRange', () => {
  it('felismeri a rács félórás sávjait', () => {
    expect(parseUszodak16TimeRange('6:00 - 6:30')).toEqual({ start: '06:00', end: '06:30' });
    expect(parseUszodak16TimeRange('21:00 - 21:30')).toEqual({ start: '21:00', end: '21:30' });
  });

  it('elutasítja a nem időtartam szövegeket', () => {
    expect(parseUszodak16TimeRange('Szabad pályák')).toBeNull();
    expect(parseUszodak16TimeRange('')).toBeNull();
    // Visszafelé haladó vagy értelmetlen óraérték nem csúszhat át.
    expect(parseUszodak16TimeRange('9:00 - 8:00')).toBeNull();
    expect(parseUszodak16TimeRange('25:00 - 26:00')).toBeNull();
  });
});

describe('parseUszodak16Cell', () => {
  it('a szám a SZABAD sávok számát jelenti', () => {
    expect(parseUszodak16Cell('6')).toEqual({ kind: 'free', freeLanes: 6 });
    expect(parseUszodak16Cell(' 2 ')).toEqual({ kind: 'free', freeLanes: 2 });
  });

  it('az „X" zárva, az üres cella ismeretlen', () => {
    expect(parseUszodak16Cell('X')).toEqual({ kind: 'closed' });
    expect(parseUszodak16Cell('x')).toEqual({ kind: 'closed' });
    expect(parseUszodak16Cell('')).toEqual({ kind: 'unknown' });
    expect(parseUszodak16Cell('i')).toEqual({ kind: 'unknown' });
  });
});

describe.each([
  ['Erzsébetligeti', ERZSEBETLIGETI],
  ['Szentmihályi', SZENTMIHALYI],
])('parseUszodak16Grid — %s valódi oldalán', (_name, config) => {
  it('a szerződésnek megfelelő, heti ismétlődő rekordokat ad', () => {
    const { blocks } = parse(config);
    expect(blocks.length).toBeGreaterThan(0);

    for (const block of blocks) {
      expect(block.poolId).toBe(config.poolId);
      expect(block.basinId).toBe(config.basinId);
      // Heti ismétlődő beosztás: weekday van, date nincs.
      expect(block.weekday).toBeGreaterThanOrEqual(1);
      expect(block.weekday).toBeLessThanOrEqual(7);
      expect(block.date).toBeUndefined();
      expect(block.start).toMatch(/^([01]\d|2[0-3]):[0-5]\d$/);
      expect(block.end).toMatch(/^([01]\d|2[0-3]):[0-5]\d$/);
      expect(block.start < block.end).toBe(true);
      expect(Number.isInteger(block.lanesOccupied)).toBe(true);
      expect(block.lanesOccupied).toBeGreaterThan(0);
      expect(block.lanesOccupied).toBeLessThanOrEqual(config.totalLanes);
      expect(block.reason).not.toBe('');
    }
  });

  it('nem panaszkodik a jelenlegi kiadásra', () => {
    expect(parse(config).warnings).toEqual([]);
  });

  it('egyetlen napon belül sem ad átfedő blokkokat', () => {
    const { blocks } = parse(config);
    for (let day = 1; day <= 7; day += 1) {
      const sameDay = blocks
        .filter((b) => b.weekday === day)
        .sort((a, b) => a.start.localeCompare(b.start));
      for (let i = 1; i < sameDay.length; i += 1) {
        expect(sameDay[i].start >= sameDay[i - 1].end).toBe(true);
      }
    }
  });

  it('összevonja az egymás utáni, azonos értékű félórákat', () => {
    const { blocks } = parse(config);
    // Ha nem vonnánk össze, minden blokk pontosan 30 perces lenne.
    const longerThanHalfHour = blocks.filter((b) => {
      const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
      return minutes(b.end) - minutes(b.start) > 30;
    });
    expect(longerThanHalfHour.length).toBeGreaterThan(0);
  });

  it('nem választja az eseménynaptárat rácsnak', () => {
    const { blocks } = parse(config);
    // Az eseménynaptár cellái napsorszámok (1–30). Ha azt olvastuk volna,
    // a blokkok 06:00–21:30-on kívülre esnének, vagy hiányozna a délutáni
    // csúcsidő, ahol a foglaltság a legnagyobb.
    expect(blocks.some((b) => b.start >= '16:00' && b.start < '20:00')).toBe(true);
    for (const block of blocks) {
      expect(block.start >= '06:00').toBe(true);
      expect(block.end <= '21:30').toBe(true);
    }
  });
});

describe('parseUszodak16Grid — hibakezelés', () => {
  it('dob, ha az oldalon nincs rács', () => {
    const empty: RawSource = {
      url: 'https://www.uszodak16.hu/erzsebetligeti-uszoda/',
      contentType: 'text/html',
      body: Buffer.from('<html><body><p>Nincs itt semmi</p></body></html>'),
      fetchedAt: '2026-09-24T17:00:00.000Z',
      fromCache: true,
    };
    // Üres siker TILOS: az azt hazudná, hogy minden sáv szabad.
    expect(() => parseUszodak16Grid(empty, { warn: () => {} }, ERZSEBETLIGETI)).toThrow(
      /rácsot/i,
    );
  });
});
