/**
 * A Tüskecsarnok „Lakossági szabad vízfelületek" adapter tesztjei.
 *
 * A fixture a tuskecsarnok.hu/sportuszoda/ oldal 2026-09-24-én letöltött
 * VALÓDI HTML-je (a 2026.09.21–09.27. hétre vonatkozó szöveggel). A lényeg,
 * amit őriznünk kell: a szabad sávokból visszaszámolt foglaltság SOSEM lehet
 * nagyvonalúbb annál, amit a forrás kimond.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  parseFreeWindows,
  parseNoFreeWindows,
  parseTuskecsarnok,
  parseWeekStart,
} from '../adapters/tuskecsarnok-szabad-vizfelulet';
import type { ParseContext, RawSource } from '../types';

const FIXTURE = path.join(__dirname, 'fixtures', 'tuskecsarnok-sportuszoda-20260924.html');

function loadFixture(): RawSource {
  return {
    url: 'https://tuskecsarnok.hu/sportuszoda/',
    contentType: 'text/html; charset=utf-8',
    body: readFileSync(FIXTURE),
    fetchedAt: '2026-09-24T16:00:00.000Z',
    fromCache: true,
  };
}

function parse(): { blocks: ReturnType<typeof parseTuskecsarnok>; warnings: string[] } {
  const warnings: string[] = [];
  const ctx: ParseContext = { warn: (message) => warnings.push(message) };
  return { blocks: parseTuskecsarnok(loadFixture(), ctx), warnings };
}

describe('parseFreeWindows', () => {
  it('a sávszám a mögötte álló időtartamokra vonatkozik', () => {
    expect(parseFreeWindows('6:00-11:00 és 13:00-16:00 / 4 sáv')).toEqual([
      { start: '06:00', end: '11:00', freeLanes: 4 },
      { start: '13:00', end: '16:00', freeLanes: 4 },
    ]);
  });

  it('kezeli az ablakonként külön megadott sávszámot', () => {
    expect(parseFreeWindows('6:00-11:00 3 sáv és 14:00-16:00 / 4 sáv')).toEqual([
      { start: '06:00', end: '11:00', freeLanes: 3 },
      { start: '14:00', end: '16:00', freeLanes: 4 },
    ]);
  });

  it('elbírja a hiányzó szóközt („/10 sáv")', () => {
    expect(parseFreeWindows('8:00-14:00 /10 sáv')).toEqual([{ start: '08:00', end: '14:00', freeLanes: 10 }]);
  });
});

describe('parseNoFreeWindows', () => {
  it('csak a „nincs szabad sáv" zárójelet veszi figyelembe', () => {
    expect(parseNoFreeWindows('– hétfő: 6:00-11:00 / 4 sáv (11:00-13:00 nincs szabad sáv)')).toEqual([
      { start: '11:00', end: '13:00' },
    ]);
    expect(parseNoFreeWindows('– hétfő: 6:00-11:00 / 4 sáv (12:00-13:00 uszodabál)')).toEqual([]);
  });
});

describe('parseWeekStart', () => {
  it('kiolvassa a hét kezdetét', () => {
    expect(parseWeekStart('Lakossági szabad vízfelületek 2026.09.21-09.27. között:')?.toISOString().slice(0, 10)).toBe(
      '2026-09-21',
    );
  });
});

describe('parseTuskecsarnok — valódi oldalon', () => {
  it('pontosan azt a hat foglalást adja vissza, amit a forrás kimond', () => {
    const { blocks } = parse();
    expect(
      blocks.map((block) => `${block.basinId} ${block.date} ${block.start}-${block.end} ${block.lanesOccupied}`),
    ).toEqual([
      'tanmedence 2026-09-21 11:00-13:00 4',
      'tanmedence 2026-09-22 06:00-11:00 1',
      'tanmedence 2026-09-22 11:00-14:00 4',
      'tanmedence 2026-09-25 06:00-16:00 1',
      'versenymedence-50m 2026-09-21 11:00-13:00 10',
      'versenymedence-50m 2026-09-24 11:00-13:00 10',
    ]);
  });

  it('a szerződésnek megfelelő, dátumozott rekordokat ad', () => {
    const { blocks } = parse();
    for (const block of blocks) {
      expect(block.poolId).toBe('tuskecsarnok-sportuszoda');
      expect(block.weekday).toBeUndefined();
      expect(block.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(block.start < block.end).toBe(true);
      expect(Number.isInteger(block.lanesOccupied)).toBe(true);
      expect(block.lanesOccupied).toBeGreaterThan(0);
    }
  });

  it('nem talál ki foglalást a teljesen szabad napokra (szerda, csütörtök, hétvége)', () => {
    const { blocks } = parse();
    // Szerda a tanmedencében végig 4 szabad sáv → nincs mit rögzíteni.
    expect(blocks.filter((block) => block.date === '2026-09-23' && block.basinId === 'tanmedence')).toEqual([]);
    // A hétvégén mindkét medence teljes egészében lakossági.
    expect(blocks.filter((block) => block.date === '2026-09-26' || block.date === '2026-09-27')).toEqual([]);
  });

  it('mindig figyelmeztet a modell korlátjára', () => {
    const { warnings } = parse();
    expect(warnings.some((warning) => warning.includes('nem nyilatkozik'))).toBe(true);
  });

  it('nem ad átfedő blokkokat ugyanarra a medencére', () => {
    const { blocks } = parse();
    const seen = new Map<string, { start: string; end: string }[]>();
    for (const block of blocks) {
      const key = `${block.basinId}|${block.date}`;
      const list = seen.get(key) ?? [];
      for (const other of list) expect(block.start >= other.end || block.end <= other.start).toBe(true);
      list.push(block);
      seen.set(key, list);
    }
  });

  it('hibát dob, ha a szakasz eltűnik az oldalról', () => {
    const broken: RawSource = { ...loadFixture(), body: Buffer.from('<html><body><p>Felújítás</p></body></html>') };
    expect(() => parseTuskecsarnok(broken, { warn: () => {} })).toThrow(/Lakossági szabad vízfelület/);
  });
});
