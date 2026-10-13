/**
 * A Pesterzsébeti Uszoda sávbeosztás-adapter tesztjei.
 *
 * A fixture-ök a `/melyvizes-medence/` és a `/tanmedence/` aloldal 2026-09-24-én
 * letöltött VALÓDI HTML-je. A lényeg éppen a szerkezet: a több pályára szóló
 * foglalások `colspan`-nal vannak összevonva, és pontosan azt kell bizonyítani,
 * hogy ezeket pályánként bontjuk ki.
 *
 * Az adapter ma már CSAK a mélyvizes medencét tölti le (a tanmedence kikerült az
 * adathalmazból). A tanmedence fixture-t mégis megtartjuk: egyedül abban van
 * egymásba lógó idősáv, és a levágó ágat máshol nem tudnánk valódi adaton
 * bizonyítani. Az alsó blokkban ezért közvetlenül a lapértelmezőt hívjuk vele,
 * nem az adaptert.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  classifyPesterzsebetCell,
  parsePesterzsebet,
  parsePesterzsebetPage,
  parsePesterzsebetTimeRange,
} from '../adapters/pesterzsebeti-savbeosztas';
import type { ParseContext, RawSource } from '../types';

function fixture(name: string): string {
  return readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');
}

function envelope(): RawSource {
  const pages = [
    {
      basinId: 'melyvizes-medence',
      url: 'https://www.pesterzsebetiuszoda.hu/melyvizes-medence/',
      html: fixture('pesterzsebeti-melyvizes-20260924.html'),
    },
  ];
  return {
    url: 'https://www.pesterzsebetiuszoda.hu/savbeosztas/',
    contentType: 'application/json',
    body: Buffer.from(JSON.stringify({ pages }), 'utf8'),
    fetchedAt: '2026-09-24T18:00:00.000Z',
    fromCache: true,
  };
}

function parse() {
  const warnings: string[] = [];
  const ctx: ParseContext = { warn: (message) => warnings.push(message) };
  return { blocks: parsePesterzsebet(envelope(), ctx), warnings };
}

describe('parsePesterzsebetTimeRange', () => {
  it('felismeri a pontos és a negyedórás sávokat', () => {
    expect(parsePesterzsebetTimeRange('6.00-7.00')).toEqual({ start: '06:00', end: '07:00' });
    expect(parsePesterzsebetTimeRange('8.15-9.15')).toEqual({ start: '08:15', end: '09:15' });
  });

  it('elutasítja a fejléc- és lábjegyzetszövegeket', () => {
    expect(parsePesterzsebetTimeRange('0.pálya')).toBeNull();
    expect(parsePesterzsebetTimeRange('')).toBeNull();
    expect(parsePesterzsebetTimeRange('9.00-8.00')).toBeNull();
  });
});

describe('classifyPesterzsebetCell', () => {
  it('felismeri az iskolai foglalást', () => {
    expect(classifyPesterzsebetCell('iskola')).toBe('school');
    expect(classifyPesterzsebetCell('iskolai-óvodai oktatás')).toBe('school');
  });

  it('az ismeretlen feliratot semleges "club"-nak veszi', () => {
    expect(classifyPesterzsebetCell('foglalt')).toBe('club');
  });
});

describe('parsePesterzsebet — a valódi oldalakon', () => {
  it('a szerződésnek megfelelő, heti ismétlődő rekordokat ad', () => {
    const { blocks } = parse();
    expect(blocks.length).toBeGreaterThan(0);

    for (const block of blocks) {
      expect(block.poolId).toBe('pesterzsebeti-uszoda');
      expect(block.basinId).toBe('melyvizes-medence');
      expect(block.date).toBeUndefined();
      expect(block.weekday).toBeGreaterThanOrEqual(1);
      expect(block.weekday).toBeLessThanOrEqual(7);
      expect(block.start < block.end).toBe(true);
      expect(Number.isInteger(block.lanesOccupied)).toBe(true);
      expect(block.lanesOccupied).toBeGreaterThan(0);
      expect(block.reason).not.toBe('');
    }
  });

  it('a foglaltság sosem lépi túl a 10 pályát', () => {
    const { blocks } = parse();
    for (const block of blocks) {
      expect(block.lanesOccupied).toBeLessThanOrEqual(10);
    }
  });

  it('a tanmedencéről egyetlen blokkot sem ad vissza', () => {
    // A tanmedence kikerült az adathalmazból; ha valaha visszakerülne a `PAGES`
    // közé, annak tudatos döntésnek kell lennie, nem véletlennek.
    const { blocks } = parse();
    expect(blocks.some((b) => b.basinId === 'tanmedence')).toBe(false);
  });

  it('a colspan-os foglalást több pályaként számolja', () => {
    const { blocks } = parse();
    // A mélyvizes medence hétfő 8.00-9.00 sorában egy `colspan="3"` cella áll
    // „iskola" felirattal. Ha nem bontanánk ki, 1 sáv foglaltságot adna.
    const monday = blocks.find(
      (b) => b.basinId === 'melyvizes-medence' && b.weekday === 1 && b.start === '08:00',
    );
    expect(monday).toBeDefined();
    expect(monday?.lanesOccupied).toBeGreaterThanOrEqual(3);
    expect(monday?.kind).toBe('school');
  });

  it('hétfőtől szombatig ad adatot, vasárnapra nem', () => {
    const { blocks } = parse();
    const days = [...new Set(blocks.map((b) => b.weekday))].sort();
    expect(days).toEqual([1, 2, 3, 4, 5, 6]);
    // Vasárnapra nincs táblázat: az adat hiánya nem foglaltság.
    expect(blocks.some((b) => b.weekday === 7)).toBe(false);
  });

  it('egyetlen napon sem ad átfedő blokkokat', () => {
    const { blocks } = parse();
    for (let day = 1; day <= 7; day += 1) {
      const sameDay = blocks
        .filter((b) => b.weekday === day)
        .sort((a, b) => a.start.localeCompare(b.start));
      for (let i = 1; i < sameDay.length; i += 1) {
        expect(sameDay[i].start >= sameDay[i - 1].end).toBe(true);
      }
    }
  });

  it('ismeretlen medencét nem dolgoz fel, csak figyelmeztet', () => {
    const warnings: string[] = [];
    const raw: RawSource = {
      url: 'https://www.pesterzsebetiuszoda.hu/savbeosztas/',
      contentType: 'application/json',
      body: Buffer.from(
        JSON.stringify({
          pages: [
            {
              basinId: 'melyvizes-medence',
              url: 'x',
              html: fixture('pesterzsebeti-melyvizes-20260924.html'),
            },
            {
              basinId: 'tanmedence',
              url: 'y',
              html: fixture('pesterzsebeti-tanmedence-20260924.html'),
            },
          ],
        }),
      ),
      fetchedAt: '2026-09-24T18:00:00.000Z',
      fromCache: true,
    };
    const blocks = parsePesterzsebet(raw, { warn: (message) => warnings.push(message) });
    expect(blocks.some((b) => b.basinId === 'tanmedence')).toBe(false);
    expect(warnings.some((w) => w.includes('tanmedence'))).toBe(true);
  });
});

describe('parsePesterzsebetPage — az átfedő idősávok levágása', () => {
  it('a rács sorrendjét követve vágja el az egymásba lógó sávokat', () => {
    // A tanmedence csütörtöki rácsában a „8.15-9.15" után „9.00-10.00" jön.
    // Az adapter ezt a medencét már nem tölti le, de a levágó ág egyedül ezen a
    // valódi adaton bizonyítható, ezért közvetlenül hívjuk.
    const warnings: string[] = [];
    const blocks = parsePesterzsebetPage(
      fixture('pesterzsebeti-tanmedence-20260924.html'),
      {
        basinId: 'tanmedence',
        lanes: 5,
        url: 'https://www.pesterzsebetiuszoda.hu/tanmedence/',
        label: 'Tanmedence',
      },
      { warn: (message) => warnings.push(message) },
    );

    expect(warnings.some((w) => w.includes('átfedő'))).toBe(true);
    for (let day = 1; day <= 7; day += 1) {
      const sameDay = blocks
        .filter((b) => b.weekday === day)
        .sort((a, b) => a.start.localeCompare(b.start));
      for (let i = 1; i < sameDay.length; i += 1) {
        expect(sameDay[i].start >= sameDay[i - 1].end).toBe(true);
      }
    }
    for (const block of blocks) expect(block.start < block.end).toBe(true);
  });

  it('dob, ha egyik oldalon sincs táblázat', () => {
    const empty: RawSource = {
      url: 'https://www.pesterzsebetiuszoda.hu/savbeosztas/',
      contentType: 'application/json',
      body: Buffer.from(
        JSON.stringify({
          pages: [{ basinId: 'melyvizes-medence', url: 'x', html: '<html></html>' }],
        }),
      ),
      fetchedAt: '2026-09-24T18:00:00.000Z',
      fromCache: true,
    };
    // Üres siker TILOS: azt hazudná, hogy minden pálya szabad.
    expect(() => parsePesterzsebet(empty, { warn: () => {} })).toThrow();
  });
});
