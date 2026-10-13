/**
 * A TVE 1887 heti program adapter tesztjei.
 *
 * A fixture a tve1887.hu-ról 2026-09-24-én letöltött VALÓDI PDF
 * (USZODA_HETI-PROGRAM-2026_09_23_mod.pdf, a 2026.09.21–09.27. hétre).
 * Az eredeti fájlon tesztelünk, mert a foglaltság kizárólag a cellák
 * kitöltőszínében van.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodeSubsetText, findLatestProgramUrl, parseTvePdf } from '../adapters/tve-heti-program';
import type { ParseContext, RawSource } from '../types';

const FIXTURE = path.join(__dirname, 'fixtures', 'tve-heti-program-2026_09_23_mod.pdf');

function loadFixture(): RawSource {
  return {
    url: 'https://tve1887.hu/wp-content/uploads/2026/09/USZODA_HETI-PROGRAM-2026_09_23_mod.pdf',
    contentType: 'application/pdf',
    body: readFileSync(FIXTURE),
    fetchedAt: '2026-09-24T16:00:00.000Z',
    fromCache: true,
  };
}

function parse(): { blocks: ReturnType<typeof parseTvePdf>; warnings: string[] } {
  const warnings: string[] = [];
  const ctx: ParseContext = { warn: (message) => warnings.push(message) };
  return { blocks: parseTvePdf(loadFixture(), ctx), warnings };
}

describe('decodeSubsetText', () => {
  it('visszafejti az ASCII glifákat', () => {
    // „TVE EDZ?S" — az ékezetes É glifája fontonként más, ezért kérdőjel.
    expect(decodeSubsetText('#0037#0039#0028#0003#0028#0027#003D#0065#0036')).toBe('TVE EDZ?S');
  });

  it('érintetlenül hagyja a rendes szöveget', () => {
    expect(decodeSubsetText('AKG')).toBe('AKG');
  });
});

describe('findLatestProgramUrl', () => {
  it('a legfrissebb heti programot választja, nem az oldalon maradt régit', () => {
    // Az uszoda.hu oldalon a 2024-es program linkje is bent maradt.
    const html = [
      '<a href="https://tve1887.hu/wp-content/uploads/2025/03/USZODA_HETI-PROGRAM-2024_03_10.pdf">régi</a>',
      '<a href="https://tve1887.hu/wp-content/uploads/2026/09/USZODA_HETI-PROGRAM-2026_09_23_mod.pdf">mai</a>',
    ].join('\n');
    expect(findLatestProgramUrl(html, 'https://tve1887.hu/uszoda/')).toBe(
      'https://tve1887.hu/wp-content/uploads/2026/09/USZODA_HETI-PROGRAM-2026_09_23_mod.pdf',
    );
  });

  it('null, ha nincs heti program az oldalon', () => {
    expect(findLatestProgramUrl('<a href="/hazirend.pdf">házirend</a>', 'https://tve1887.hu/uszoda/')).toBeNull();
  });
});

describe('parseTvePdf — valódi PDF-en', () => {
  it('a szerződésnek megfelelő, dátumozott rekordokat ad', () => {
    const { blocks } = parse();
    expect(blocks.length).toBeGreaterThan(30);
    for (const block of blocks) {
      expect(block.poolId).toBe('tve-sportuszoda');
      expect(block.basinId).toBe('21x285-medence');
      expect(block.weekday).toBeUndefined();
      expect(block.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(block.start).toMatch(/^([01]\d|2[0-3]):[0-5]\d$/);
      expect(block.start < block.end).toBe(true);
      expect(Number.isInteger(block.lanesOccupied)).toBe(true);
      expect(block.lanesOccupied).toBeGreaterThan(0);
      // A medencének nyolc sávja van.
      expect(block.lanesOccupied).toBeLessThanOrEqual(8);
    }
  });

  it('a publikált hét mind a hét napját lefedi', () => {
    const { blocks } = parse();
    expect([...new Set(blocks.map((block) => block.date))].sort()).toEqual([
      '2026-09-21',
      '2026-09-22',
      '2026-09-23',
      '2026-09-24',
      '2026-09-25',
      '2026-09-26',
      '2026-09-27',
    ]);
  });

  it('a rács 06:00-kor kezdődik és 23:00-kor ér véget', () => {
    const { blocks } = parse();
    expect(blocks.map((block) => block.start).sort()[0]).toBe('06:00');
    expect(blocks.map((block) => block.end).sort().at(-1)).toBe('23:00');
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

  it('a hétfő délelőttöt a lakossági (zöld) sávok miatt szabadon hagyja', () => {
    const { blocks } = parse();
    const monday = blocks.filter((block) => block.date === '2026-09-21');
    // 10:30 és 13:00 között a hétfői rácsban minden cella zöld (LAKOSSÁG).
    expect(monday.filter((block) => block.start >= '10:30' && block.start < '13:00')).toEqual([]);
    // 13:00-tól egyetlen bérelt sáv.
    expect(monday.find((block) => block.start === '13:00')).toMatchObject({
      end: '14:00',
      lanesOccupied: 1,
      kind: 'club',
    });
  });

  it('a hétfő délutáni edzést mind a nyolc sávon foglaltnak látja', () => {
    const { blocks } = parse();
    const training = blocks.find((block) => block.date === '2026-09-21' && block.start === '15:00');
    expect(training).toMatchObject({ end: '21:30', lanesOccupied: 8, kind: 'club' });
    expect(training?.reason).toContain('TVE edzés');
  });

  it('a szombati mérkőzéseket eseményként jelöli', () => {
    const { blocks } = parse();
    const match = blocks.find((block) => block.date === '2026-09-26' && block.kind === 'event');
    expect(match).toMatchObject({ start: '08:00', end: '14:30', lanesOccupied: 8 });
  });

  it('a zárva tartást külön jelöli', () => {
    const { blocks } = parse();
    const closed = blocks.find((block) => block.date === '2026-09-27' && block.start === '06:00');
    expect(closed).toMatchObject({ kind: 'closed', lanesOccupied: 8, reason: 'Zárva a TVE heti programja szerint' });
  });

  it('nem tippel klubnevet: az olvashatatlan feliratnál a jelmagyarázat kategóriáját írja', () => {
    const { blocks } = parse();
    const morning = blocks.find((block) => block.date === '2026-09-21' && block.start === '06:00');
    expect(morning?.reason).toContain('támogatók');
    expect(morning?.reason).not.toContain('?');
  });

  it('nem panaszkodik a jelenlegi kiadásra', () => {
    const { warnings } = parse();
    expect(warnings).toEqual([]);
  });

  it('hibát dob, ha a PDF nem értelmezhető', () => {
    const broken: RawSource = { ...loadFixture(), body: Buffer.from('%PDF-1.7\nnem egy heti program') };
    expect(() => parseTvePdf(broken, { warn: () => {} })).toThrow();
  });
});
