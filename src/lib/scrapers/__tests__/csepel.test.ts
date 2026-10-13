/**
 * A csepeli pályabeosztás-adapter tesztjei.
 *
 * A fixture a csepelistrandfurdo.hu-ról 2026-09-24-én letöltött VALÓDI PDF
 * (2025/26 ŐSZ-TÉL szezon). Azért az eredeti fájlon tesztelünk, mert a
 * foglaltság kizárólag a cellák kitöltőszínében van — ezt csak az eredeti
 * PDF-en lehet hitelesen ellenőrizni.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseCsepelHourRange, parseCsepelPdf } from '../adapters/csepel-palyabeosztas';
import type { ParseContext, RawSource } from '../types';

const FIXTURE = path.join(__dirname, 'fixtures', 'csepel-palyabeosztas-2025-26-osz-tel.pdf');

function loadFixture(): RawSource {
  return {
    url: 'https://www.csepelistrandfurdo.hu/wp-content/uploads/2025/11/Palyabeosztas-2025-26-osz-tel-.pdf',
    contentType: 'application/pdf',
    body: readFileSync(FIXTURE),
    fetchedAt: '2026-09-24T16:00:00.000Z',
    fromCache: true,
  };
}

function parse(): { blocks: ReturnType<typeof parseCsepelPdf>; warnings: string[] } {
  const warnings: string[] = [];
  const ctx: ParseContext = { warn: (message) => warnings.push(message) };
  return { blocks: parseCsepelPdf(loadFixture(), ctx), warnings };
}

describe('parseCsepelHourRange', () => {
  it('kezeli a pontos írásmódot', () => {
    expect(parseCsepelHourRange('06.00-07.00')).toEqual({ start: '06:00', end: '07:00' });
    expect(parseCsepelHourRange('6.00-7.00')).toEqual({ start: '06:00', end: '07:00' });
  });

  it('elutasítja a nem idősávot', () => {
    expect(parseCsepelHourRange('Kedd')).toBeNull();
    expect(parseCsepelHourRange('1')).toBeNull();
  });
});

describe('parseCsepelPdf — valódi PDF-en', () => {
  it('a szerződésnek megfelelő, heti ismétlődő rekordokat ad', () => {
    const { blocks } = parse();
    expect(blocks.length).toBeGreaterThan(15);
    for (const block of blocks) {
      expect(block.poolId).toBe('csepeli-strandfurdo');
      expect(block.basinId).toBe('50m-uszomedence');
      expect(block.date).toBeUndefined();
      expect(block.weekday).toBeGreaterThanOrEqual(1);
      expect(block.weekday).toBeLessThanOrEqual(7);
      expect(block.start).toMatch(/^([01]\d|2[0-3]):[0-5]\d$/);
      expect(block.start < block.end).toBe(true);
      // A medencének hét sávja van; ennél több foglalt sáv értelmezési hiba.
      expect(block.lanesOccupied).toBeGreaterThan(0);
      expect(block.lanesOccupied).toBeLessThanOrEqual(7);
      expect(Number.isInteger(block.lanesOccupied)).toBe(true);
    }
  });

  it('egyetlen napon belül sem ad átfedő blokkokat', () => {
    const { blocks } = parse();
    for (let weekday = 1; weekday <= 7; weekday += 1) {
      const day = blocks.filter((block) => block.weekday === weekday).sort((a, b) => a.start.localeCompare(b.start));
      for (let i = 1; i < day.length; i += 1) {
        expect(day[i - 1].end <= day[i].start).toBe(true);
      }
    }
  });

  it('a hétfő reggelt két foglalt sávval, a délelőttöt szabadon látja', () => {
    const { blocks } = parse();
    const monday = blocks.filter((block) => block.weekday === 1);
    expect(monday[0]).toMatchObject({ start: '06:00', end: '07:00', lanesOccupied: 2 });
    // 07:00 és 16:00 között a hétfői rácsban egyetlen színes cella sincs.
    expect(monday.filter((block) => block.start >= '07:00' && block.start < '16:00')).toEqual([]);
  });

  it('a keddi 17 órás csúcsot hat foglalt sávval látja', () => {
    const { blocks } = parse();
    const peak = blocks.find((block) => block.weekday === 2 && block.start === '17:00');
    expect(peak?.lanesOccupied).toBe(6);
  });

  it('a vasárnapot teljesen szabadnak látja (nincs színezett cella)', () => {
    const { blocks } = parse();
    expect(blocks.filter((block) => block.weekday === 7)).toEqual([]);
  });

  it('nem nevez meg klubot olyan blokknál, ahol nem minden sáv ugyanazé', () => {
    const { blocks } = parse();
    const mixed = blocks.find((block) => block.weekday === 1 && block.start === '18:00');
    expect(mixed?.lanesOccupied).toBe(5);
    expect(mixed?.reason).toContain('köztük');
  });

  it('nem panaszkodik a jelenlegi kiadásra', () => {
    const { warnings } = parse();
    expect(warnings).toEqual([]);
  });

  it('hibát dob, ha a PDF nem értelmezhető', () => {
    const broken: RawSource = { ...loadFixture(), body: Buffer.from('%PDF-1.7\nnem egy beosztás') };
    expect(() => parseCsepelPdf(broken, { warn: () => {} })).toThrow();
  });
});
