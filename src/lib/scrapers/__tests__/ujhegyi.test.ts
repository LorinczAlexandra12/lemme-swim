/**
 * Az Újhegyi pályabeosztás-adapter tesztjei.
 *
 * A vizsgálat VALÓDI, a kobanyasport.hu-ról 2026-09-24-én letöltött PDF-en fut
 * (`fixtures/ujhegyi-palyabeosztas-20260831.pdf`). Ez tudatos döntés: a
 * sávbeosztás lényege a cellák kitöltőszíne, amit csak az eredeti fájlon lehet
 * hitelesen ellenőrizni. Ha a forrás formátuma megváltozik, ezek a tesztek
 * továbbra is zöldek maradnak — a formátumváltást a `npm run scrape` futása és
 * az adapter `warnings` mezője jelzi.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseHourRange, parseUjhegyiPdf } from '../adapters/ujhegyi-palyabeosztas';
import type { ParseContext, RawSource } from '../types';

const FIXTURE = path.join(__dirname, 'fixtures', 'ujhegyi-palyabeosztas-20260831.pdf');

function loadFixture(): RawSource {
  return {
    url: 'https://www.kobanyasport.hu/index_htm_files/aktualis_palyabeosztas_20260831.pdf',
    contentType: 'application/pdf',
    body: readFileSync(FIXTURE),
    fetchedAt: '2026-09-24T12:00:00.000Z',
    fromCache: true,
  };
}

function parse(): { blocks: ReturnType<typeof parseUjhegyiPdf>; warnings: string[] } {
  const warnings: string[] = [];
  const ctx: ParseContext = { warn: (message) => warnings.push(message) };
  return { blocks: parseUjhegyiPdf(loadFixture(), ctx), warnings };
}

describe('parseHourRange', () => {
  it('felismeri a szabályos órasávot', () => {
    expect(parseHourRange('6. - 7 .')).toEqual({ start: '06:00', end: '07:00' });
  });

  it('kezeli a féloraás, pont nélküli írásmódot', () => {
    expect(parseHourRange('7. - 830')).toEqual({ start: '07:00', end: '08:30' });
    expect(parseHourRange('17. - 18.30 ')).toEqual({ start: '17:00', end: '18:30' });
    expect(parseHourRange('20. - 21.00')).toEqual({ start: '20:00', end: '21:00' });
  });

  it('elutasítja az értelmezhetetlen feliratot', () => {
    expect(parseHourRange('9.')).toBeNull();
    expect(parseHourRange(' - 10. ')).toBeNull();
    expect(parseHourRange('tanmedence')).toBeNull();
  });
});

describe('parseUjhegyiPdf — valódi PDF-en', () => {
  it('mind a hét napra ad foglalást', () => {
    const { blocks } = parse();
    const weekdays = new Set(blocks.map((block) => block.weekday));
    expect([...weekdays].sort()).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('a szerződésnek megfelelő rekordokat állít elő', () => {
    const { blocks } = parse();
    expect(blocks.length).toBeGreaterThan(20);
    for (const block of blocks) {
      expect(block.poolId).toBe('ujhegyi-uszoda');
      expect(block.basinId).toBe('belso-uszomedence');
      expect(block.date).toBeUndefined();
      expect(block.weekday).toBeGreaterThanOrEqual(1);
      expect(block.weekday).toBeLessThanOrEqual(7);
      expect(block.start).toMatch(/^([01]\d|2[0-3]):[0-5]\d$/);
      expect(block.end).toMatch(/^([01]\d|2[0-3]):[0-5]\d$/);
      expect(block.start < block.end).toBe(true);
      // A medencének hat sávja van; ennél több foglalt sáv értelmezési hiba lenne.
      expect(block.lanesOccupied).toBeGreaterThan(0);
      expect(block.lanesOccupied).toBeLessThanOrEqual(6);
      expect(Number.isInteger(block.lanesOccupied)).toBe(true);
      expect(block.reason.length).toBeGreaterThan(0);
    }
  });

  it('egyetlen napon belül sem ad átfedő blokkokat (különben duplán vonódna le a sáv)', () => {
    const { blocks } = parse();
    for (let weekday = 1; weekday <= 7; weekday += 1) {
      const day = blocks.filter((block) => block.weekday === weekday).sort((a, b) => a.start.localeCompare(b.start));
      for (let i = 1; i < day.length; i += 1) {
        expect(day[i - 1].end <= day[i].start).toBe(true);
      }
    }
  });

  it('a hétfő reggel 6 és 10 óra közötti sávokat szabadnak látja', () => {
    // A PDF hétfői oldalán a 6–10 órás blokk végig zöld (SZABAD).
    const { blocks } = parse();
    const morning = blocks.filter((block) => block.weekday === 1 && block.start < '10:00');
    expect(morning).toEqual([]);
  });

  it('a hétköznap esti sávokat teljesen foglaltnak látja', () => {
    const { blocks } = parse();
    const evening = blocks.find((block) => block.weekday === 1 && block.start === '19:00');
    expect(evening?.lanesOccupied).toBe(6);
  });

  it('nem talál ismeretlen cellaszínt a jelenlegi kiadásban', () => {
    const { warnings } = parse();
    expect(warnings.filter((warning) => warning.includes('ismeretlen cellaszín'))).toEqual([]);
  });
});
