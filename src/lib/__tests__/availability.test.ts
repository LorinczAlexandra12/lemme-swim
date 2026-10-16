import { describe, expect, it } from 'vitest';
import type { Basin, LaneBlock, OpeningHours, Pool, ScheduleSource, SearchQuery } from '../types';
import {
  basinAvailability,
  computeConfidence,
  isOpenThroughout,
  poolAvailability,
  resolveBlocksForDate,
  worstConfidence,
} from '../availability';

// 2026-09-24 csütörtök (ISO 4) — minden teszt erre a napra kérdez.
const DATE = '2026-09-24';
const THURSDAY = 4;
const NOW = new Date('2026-09-24T12:00:00Z');

const BASIN: Basin = {
  id: '50m-fedett',
  name: '50 m-es fedett medence',
  lengthM: 50,
  lanes: 8,
  indoor: true,
};

/** Hétfőtől vasárnapig 06:00–22:00. */
const FULL_WEEK: OpeningHours[] = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
  weekday: weekday as OpeningHours['weekday'],
  opens: '06:00',
  closes: '22:00',
}));

const CURATED_FRESH: ScheduleSource = { type: 'curated', lastVerified: '2026-09-01' };

function block(partial: Partial<LaneBlock>): LaneBlock {
  return {
    poolId: 'teszt-uszoda',
    basinId: BASIN.id,
    start: '18:00',
    end: '19:00',
    lanesOccupied: 2,
    kind: 'club',
    reason: 'Egyesületi edzés',
    ...partial,
  };
}

function query(partial: Partial<SearchQuery> = {}): SearchQuery {
  return {
    lat: 47.5,
    lon: 19.05,
    date: DATE,
    start: '18:00',
    end: '20:00',
    ...partial,
  };
}

// ---------------------------------------------------------------------------

describe('basinAvailability — legrosszabb esetű sávszám', () => {
  it('a legkevesebb szabad sávot adja, nem az átlagot', () => {
    // 18:00–19:00 → 5 sáv foglalt (3 szabad), 19:00–20:00 → 2 foglalt (6 szabad).
    // Az átlag 4,5 lenne; a helyes válasz a legrosszabb rész: 3.
    const blocks = [
      block({ weekday: THURSDAY, start: '18:00', end: '19:00', lanesOccupied: 5 }),
      block({ weekday: THURSDAY, start: '19:00', end: '20:00', lanesOccupied: 2 }),
    ];

    const result = basinAvailability(BASIN, blocks, FULL_WEEK, query());
    expect(result.freeLanes).toBe(3);
    expect(result.totalLanes).toBe(8);
  });

  it('a kért idősáv közepén elfogyó sávot nem ígéri oda', () => {
    // Csak 19:00–19:30 között van nagy foglalás — mégis ez határozza meg.
    const blocks = [block({ weekday: THURSDAY, start: '19:00', end: '19:30', lanesOccupied: 6 })];

    const result = basinAvailability(BASIN, blocks, FULL_WEEK, query());
    expect(result.freeLanes).toBe(2);
  });

  it('átfedő foglalásokat összeadja a közös részen', () => {
    // 18:30–19:00 között mindkettő aktív: 3 + 4 = 7 foglalt sáv, 1 marad.
    const blocks = [
      block({ weekday: THURSDAY, start: '18:00', end: '19:00', lanesOccupied: 3 }),
      block({ weekday: THURSDAY, start: '18:30', end: '19:30', lanesOccupied: 4 }),
    ];

    const result = basinAvailability(BASIN, blocks, FULL_WEEK, query());
    expect(result.freeLanes).toBe(1);
  });

  it('a kért ablakon kívüli foglalás nem számít', () => {
    const blocks = [block({ weekday: THURSDAY, start: '06:00', end: '08:00', lanesOccupied: 8 })];

    const result = basinAvailability(BASIN, blocks, FULL_WEEK, query());
    expect(result.freeLanes).toBe(8);
    expect(result.blocks).toHaveLength(0);
  });

  it('a pontosan érintkező foglalás nem számít bele', () => {
    // 17:00–18:00 véget ér, amikor a kérés kezdődik.
    const blocks = [block({ weekday: THURSDAY, start: '17:00', end: '18:00', lanesOccupied: 8 })];

    const result = basinAvailability(BASIN, blocks, FULL_WEEK, query());
    expect(result.freeLanes).toBe(8);
  });

  it('foglalás nélkül minden sáv szabad', () => {
    const result = basinAvailability(BASIN, [], FULL_WEEK, query());
    expect(result.freeLanes).toBe(8);
  });

  it('más medence foglalása nem szivárog át', () => {
    const blocks = [
      block({ basinId: '33m-tanmedence', weekday: THURSDAY, lanesOccupied: 8 }),
    ];
    const result = basinAvailability(BASIN, blocks, FULL_WEEK, query());
    expect(result.freeLanes).toBe(8);
  });
});

describe('basinAvailability — túlosztás kezelése', () => {
  it('a sávszámnál több foglalás esetén 0, nem negatív szám', () => {
    const smallBasin: Basin = { ...BASIN, lanes: 6 };
    const blocks = [block({ weekday: THURSDAY, start: '18:00', end: '20:00', lanesOccupied: 9 })];

    const result = basinAvailability(smallBasin, blocks, FULL_WEEK, query());
    expect(result.freeLanes).toBe(0);
  });

  it('több túlosztott foglalás összege sem megy negatívba', () => {
    const blocks = [
      block({ weekday: THURSDAY, start: '18:00', end: '20:00', lanesOccupied: 6 }),
      block({ weekday: THURSDAY, start: '18:00', end: '20:00', lanesOccupied: 6 }),
    ];
    const result = basinAvailability(BASIN, blocks, FULL_WEEK, query());
    expect(result.freeLanes).toBe(0);
  });

  it('a "closed" blokk elviszi az egész medencét', () => {
    const blocks = [
      block({
        weekday: THURSDAY,
        start: '18:00',
        end: '20:00',
        lanesOccupied: 8,
        kind: 'closed',
        reason: 'Technikai szünet',
      }),
    ];
    const result = basinAvailability(BASIN, blocks, FULL_WEEK, query());
    expect(result.freeLanes).toBe(0);
  });
});

describe('basinAvailability — dátumos blokk felülírja a hetit', () => {
  it('az egyszeri verseny kiüti az azonos időre eső heti edzést', () => {
    const blocks = [
      block({ weekday: THURSDAY, start: '18:00', end: '19:00', lanesOccupied: 6, reason: 'BVSC edzés' }),
      block({
        date: DATE,
        start: '18:00',
        end: '20:00',
        lanesOccupied: 2,
        kind: 'event',
        reason: 'Diákolimpia selejtező',
      }),
    ];

    const result = basinAvailability(BASIN, blocks, FULL_WEEK, query());

    // Ha összeadnánk, 8 - (6 + 2) = 0 jönne ki. A felülírás után 8 - 2 = 6.
    expect(result.freeLanes).toBe(6);
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0].kind).toBe('event');
  });

  it('a heti blokk fel nem írt része érvényben marad, darabolva', () => {
    const blocks = [
      block({ weekday: THURSDAY, start: '17:00', end: '20:00', lanesOccupied: 6, reason: 'BVSC edzés' }),
      block({
        date: DATE,
        start: '18:00',
        end: '19:00',
        lanesOccupied: 1,
        kind: 'maintenance',
        reason: 'Vízcsere',
      }),
    ];

    const result = basinAvailability(BASIN, blocks, FULL_WEEK, query({ start: '17:00', end: '20:00' }));

    // 17:00–18:00 → 6 foglalt (2 szabad)
    // 18:00–19:00 → csak a karbantartás, 1 foglalt (7 szabad)
    // 19:00–20:00 → újra 6 foglalt (2 szabad)
    expect(result.freeLanes).toBe(2);

    const fragments = result.blocks.filter((b) => b.reason === 'BVSC edzés');
    expect(fragments).toHaveLength(2);
    expect(fragments.map((b) => `${b.start}–${b.end}`).sort()).toEqual(['17:00–18:00', '19:00–20:00']);
  });

  it('az egynapos zárás felülírja az egész napi heti beosztást', () => {
    const blocks = [
      block({ weekday: THURSDAY, start: '06:00', end: '22:00', lanesOccupied: 4 }),
      block({
        date: DATE,
        start: '06:00',
        end: '22:00',
        lanesOccupied: 8,
        kind: 'closed',
        reason: 'Rendkívüli zárva tartás',
      }),
    ];

    const resolved = resolveBlocksForDate(BASIN, blocks, DATE);
    expect(resolved).toHaveLength(1);
    expect(resolved[0].kind).toBe('closed');
  });

  it('más napra szóló dátumos blokk nem írja felül a hetit', () => {
    const blocks = [
      block({ weekday: THURSDAY, start: '18:00', end: '19:00', lanesOccupied: 6 }),
      block({ date: '2026-09-25', start: '18:00', end: '19:00', lanesOccupied: 2, kind: 'event' }),
    ];

    const result = basinAvailability(BASIN, blocks, FULL_WEEK, query());
    expect(result.freeLanes).toBe(2); // 8 - 6, a másnapi esemény nem számít
    expect(result.blocks).toHaveLength(1);
  });

  it('más hétköznapra szóló heti blokk nem számít', () => {
    const blocks = [block({ weekday: 1, start: '18:00', end: '20:00', lanesOccupied: 8 })];
    const result = basinAvailability(BASIN, blocks, FULL_WEEK, query());
    expect(result.freeLanes).toBe(8);
  });

  it('a dátumos blokk akkor is érvényes, ha nincs hozzá heti párja', () => {
    const blocks = [block({ date: DATE, start: '18:00', end: '20:00', lanesOccupied: 3 })];
    const result = basinAvailability(BASIN, blocks, FULL_WEEK, query());
    expect(result.freeLanes).toBe(5);
  });
});

describe('basinAvailability — ismeretlen sávszám', () => {
  it('null sávszám esetén nem tippel', () => {
    const unknownBasin: Basin = { ...BASIN, lanes: null };
    const blocks = [block({ weekday: THURSDAY, start: '18:00', end: '20:00', lanesOccupied: 3 })];

    const result = basinAvailability(unknownBasin, blocks, FULL_WEEK, query(), {
      source: CURATED_FRESH,
      now: NOW,
    });

    expect(result.totalLanes).toBeNull();
    expect(result.freeLanes).toBeNull();
    expect(result.confidence).toBe('unknown');
    // A foglalásokat attól még megmutatjuk.
    expect(result.blocks).toHaveLength(1);
  });

  it('ismeretlen sávszám mellett sem lesz 0 a szabad sáv', () => {
    const unknownBasin: Basin = { ...BASIN, lanes: null };
    const result = basinAvailability(unknownBasin, [], FULL_WEEK, query());
    expect(result.freeLanes).not.toBe(0);
    expect(result.freeLanes).toBeNull();
  });
});

describe('isOpenThroughout — osztott nyitvatartás', () => {
  const split: OpeningHours[] = [
    { weekday: THURSDAY, opens: '06:00', closes: '08:00' },
    { weekday: THURSDAY, opens: '16:00', closes: '20:00' },
  ];

  it('a két sáv közti szünetet átívelő kérésre hamis', () => {
    expect(isOpenThroughout(split, THURSDAY, { start: 7 * 60, end: 17 * 60 })).toBe(false);
  });

  it('az egyik sávon belüli kérésre igaz', () => {
    expect(isOpenThroughout(split, THURSDAY, { start: 6 * 60 + 30, end: 7 * 60 + 30 })).toBe(true);
    expect(isOpenThroughout(split, THURSDAY, { start: 16 * 60 + 30, end: 19 * 60 })).toBe(true);
  });

  it('a sáv pontos határai még beleférnek', () => {
    expect(isOpenThroughout(split, THURSDAY, { start: 6 * 60, end: 8 * 60 })).toBe(true);
    expect(isOpenThroughout(split, THURSDAY, { start: 6 * 60, end: 8 * 60 + 1 })).toBe(false);
  });

  it('egymáshoz érő sávokat összefésül', () => {
    const contiguous: OpeningHours[] = [
      { weekday: THURSDAY, opens: '06:00', closes: '12:00' },
      { weekday: THURSDAY, opens: '12:00', closes: '20:00' },
    ];
    expect(isOpenThroughout(contiguous, THURSDAY, { start: 8 * 60, end: 18 * 60 })).toBe(true);
  });

  it('fordított sorrendben megadott sávokkal is működik', () => {
    const reversed = [...split].reverse();
    expect(isOpenThroughout(reversed, THURSDAY, { start: 16 * 60 + 30, end: 19 * 60 })).toBe(true);
    expect(isOpenThroughout(reversed, THURSDAY, { start: 7 * 60, end: 17 * 60 })).toBe(false);
  });

  it('másik napra szóló nyitvatartás nem számít', () => {
    expect(isOpenThroughout(split, 1, { start: 6 * 60 + 30, end: 7 * 60 })).toBe(false);
  });

  it('nyitvatartás nélkül hamis', () => {
    expect(isOpenThroughout([], THURSDAY, { start: 6 * 60, end: 7 * 60 })).toBe(false);
    expect(isOpenThroughout(split, null, { start: 6 * 60, end: 7 * 60 })).toBe(false);
  });

  it('az éjfélig tartó nyitvatartást kezeli', () => {
    const lateNight: OpeningHours[] = [{ weekday: THURSDAY, opens: '06:00', closes: '00:00' }];
    expect(isOpenThroughout(lateNight, THURSDAY, { start: 22 * 60, end: 23 * 60 + 59 })).toBe(true);
  });

  it('a basinAvailability átveszi az osztott nyitvatartást', () => {
    const result = basinAvailability(BASIN, [], split, query({ start: '07:00', end: '17:00' }));
    expect(result.openThroughout).toBe(false);

    const inside = basinAvailability(BASIN, [], split, query({ start: '17:00', end: '19:00' }));
    expect(inside.openThroughout).toBe(true);
  });

  it('megkülönbözteti a "zárva"-t a "nincs nyitvatartási adat"-tól', () => {
    // Van adatunk a napra, de a kért ablak kívül esik: ez bizonyítottan zárva.
    const closed = basinAvailability(BASIN, [], split, query({ start: '09:00', end: '10:00' }));
    expect(closed.openThroughout).toBe(false);
    expect(closed.openingHoursKnown).toBe(true);
    expect(closed.openIntervals).toEqual([]);

    // A kért napról egyáltalán nincs bejegyzésünk (pl. a Nyéki Imre kihagyja a
    // péntekjét). Ilyenkor a "zárva" magabiztosan téves állítás lenne.
    const unknown = basinAvailability(BASIN, [], split, query({ date: '2026-09-25' }));
    expect(unknown.openThroughout).toBe(false);
    expect(unknown.openingHoursKnown).toBe(false);
  });
});

describe('basinAvailability — partial opening hours', () => {
  const lateOpening: OpeningHours[] = [{ weekday: THURSDAY, opens: '07:00', closes: '22:00' }];

  it('keeps the open portion and ignores bookings before opening', () => {
    const blocks = [
      block({ weekday: THURSDAY, start: '06:00', end: '07:00', lanesOccupied: 8, kind: 'closed' }),
      block({ weekday: THURSDAY, start: '07:00', end: '07:30', lanesOccupied: 3 }),
    ];
    const result = basinAvailability(BASIN, blocks, lateOpening, query({ start: '06:00', end: '08:00' }));
    expect(result.openThroughout).toBe(false);
    expect(result.openingHoursKnown).toBe(true);
    expect(result.openIntervals).toEqual([{ start: '07:00', end: '08:00' }]);
    expect(result.freeLanes).toBe(5);
    expect(result.blocks).toHaveLength(1);
  });

  it('ignores bookings after an early closing', () => {
    const blocks = [block({ weekday: THURSDAY, start: '19:00', end: '20:00', lanesOccupied: 8 })];
    const result = basinAvailability(BASIN, blocks, [{ weekday: THURSDAY, opens: '06:00', closes: '19:00' }], query());
    expect(result.openIntervals).toEqual([{ start: '18:00', end: '19:00' }]);
    expect(result.freeLanes).toBe(8);
    expect(result.blocks).toHaveLength(0);
  });

  it('uses the worst availability across split opening periods, excluding the closed gap', () => {
    const hours: OpeningHours[] = [
      { weekday: THURSDAY, opens: '16:00', closes: '20:00' },
      { weekday: THURSDAY, opens: '06:00', closes: '08:00' },
    ];
    const blocks = [
      block({ weekday: THURSDAY, start: '08:00', end: '16:00', lanesOccupied: 8 }),
      block({ weekday: THURSDAY, start: '16:00', end: '17:00', lanesOccupied: 5 }),
    ];
    const result = basinAvailability(BASIN, blocks, hours, query({ start: '07:00', end: '17:00' }));
    expect(result.openIntervals).toEqual([{ start: '07:00', end: '08:00' }, { start: '16:00', end: '17:00' }]);
    expect(result.freeLanes).toBe(3);
    expect(result.blocks).toHaveLength(1);
  });

  it('merges overlapping and contiguous opening periods', () => {
    const hours: OpeningHours[] = [
      { weekday: THURSDAY, opens: '06:00', closes: '08:00' },
      { weekday: THURSDAY, opens: '07:00', closes: '09:00' },
      { weekday: THURSDAY, opens: '09:00', closes: '10:00' },
    ];
    const result = basinAvailability(BASIN, [], hours, query({ start: '06:00', end: '10:00' }));
    expect(result.openThroughout).toBe(true);
    expect(result.openIntervals).toEqual([{ start: '06:00', end: '10:00' }]);
  });

  it('does not treat opening exactly at the requested end as an overlap', () => {
    const result = basinAvailability(BASIN, [], lateOpening, query({ start: '06:00', end: '07:00' }));
    expect(result.openIntervals).toEqual([]);
    expect(result.freeLanes).toBe(0);
  });

  it('keeps missing opening hours distinct from confirmed closure', () => {
    const result = basinAvailability(BASIN, [], [], query());
    expect(result.openingHoursKnown).toBe(false);
    expect(result.openIntervals).toEqual([]);
    expect(result.freeLanes).toBe(8);
  });

  it('preserves midnight closing times', () => {
    const result = basinAvailability(BASIN, [], [{ weekday: THURSDAY, opens: '07:00', closes: '00:00' }], query({ start: '06:00', end: '00:00' }));
    expect(result.openIntervals).toEqual([{ start: '07:00', end: '24:00' }]);
  });
});

describe('computeConfidence', () => {
  it('friss scraper-adat "live"', () => {
    const source: ScheduleSource = {
      type: 'scraper',
      adapter: 'bvsc',
      lastScrapedAt: '2026-09-23T08:00:00Z',
    };
    expect(computeConfidence(source, true, NOW)).toBe('live');
  });

  it('48 óránál régebbi scraper-adat "stale"', () => {
    const source: ScheduleSource = {
      type: 'scraper',
      lastScrapedAt: '2026-09-20T08:00:00Z',
    };
    expect(computeConfidence(source, true, NOW)).toBe('stale');
  });

  it('időbélyeg nélküli scraper "stale"', () => {
    expect(computeConfidence({ type: 'scraper' }, true, NOW)).toBe('stale');
  });

  it('60 napon belül ellenőrzött kurált adat "verified"', () => {
    expect(computeConfidence({ type: 'curated', lastVerified: '2026-09-01' }, true, NOW)).toBe(
      'verified',
    );
  });

  it('60 napnál régebben ellenőrzött kurált adat "stale"', () => {
    expect(computeConfidence({ type: 'curated', lastVerified: '2026-06-01' }, true, NOW)).toBe(
      'stale',
    );
  });

  it('forrás nélkül "unknown"', () => {
    expect(computeConfidence({ type: 'none' }, true, NOW)).toBe('unknown');
    expect(computeConfidence(undefined, true, NOW)).toBe('unknown');
  });

  it('ismeretlen sávszám mindent felülír', () => {
    const fresh: ScheduleSource = { type: 'scraper', lastScrapedAt: '2026-09-24T11:00:00Z' };
    expect(computeConfidence(fresh, false, NOW)).toBe('unknown');
  });
});

describe('worstConfidence', () => {
  it('a legrosszabbat választja', () => {
    expect(worstConfidence(['live', 'verified', 'stale'])).toBe('stale');
    expect(worstConfidence(['live', 'unknown'])).toBe('unknown');
    expect(worstConfidence(['live', 'live'])).toBe('live');
    expect(worstConfidence(['verified', 'live'])).toBe('verified');
  });

  it('üres listára "unknown"', () => {
    expect(worstConfidence([])).toBe('unknown');
  });
});

// ---------------------------------------------------------------------------

function pool(partial: Partial<Pool> = {}): Pool {
  return {
    id: 'teszt-uszoda',
    name: 'Teszt uszoda',
    address: 'Budapest, Teszt utca 1.',
    lat: 47.5194,
    lon: 19.0389,
    basins: [BASIN],
    openingHours: FULL_WEEK,
    scheduleSource: CURATED_FRESH,
    ...partial,
  };
}

describe('poolAvailability', () => {
  it('összesíti a medencék szabad sávjait', () => {
    const second: Basin = { ...BASIN, id: '33m', name: '33 m-es medence', lanes: 4 };
    const blocks = [
      block({ weekday: THURSDAY, start: '18:00', end: '20:00', lanesOccupied: 3 }),
      block({ basinId: '33m', weekday: THURSDAY, start: '18:00', end: '20:00', lanesOccupied: 1 }),
    ];

    const result = poolAvailability(pool({ basins: [BASIN, second] }), blocks, query(), { now: NOW });

    expect(result.basins).toHaveLength(2);
    expect(result.basins[0].freeLanes).toBe(5);
    expect(result.basins[1].freeLanes).toBe(3);
    expect(result.totalFreeLanes).toBe(8);
  });

  it('haversine-nal számol távolságot', () => {
    const result = poolAvailability(
      pool(),
      [],
      query({ lat: 47.4831, lon: 19.052 }),
      { now: NOW },
    );
    expect(result.distanceKm).not.toBeNull();
    expect(result.distanceKm as number).toBeGreaterThan(4.0);
    expect(result.distanceKm as number).toBeLessThan(4.3);
  });

  it('koordináta nélküli uszodánál a távolság null', () => {
    const result = poolAvailability(pool({ lat: null, lon: null }), [], query(), { now: NOW });
    expect(result.distanceKm).toBeNull();
  });

  it('az uszoda megbízhatósága a legrosszabb medencéé', () => {
    const unknownBasin: Basin = { ...BASIN, id: 'kulso', lanes: null, indoor: false };
    const result = poolAvailability(pool({ basins: [BASIN, unknownBasin] }), [], query(), {
      now: NOW,
    });

    expect(result.basins[0].confidence).toBe('verified');
    expect(result.basins[1].confidence).toBe('unknown');
    expect(result.confidence).toBe('unknown');
  });

  it('ha egyik medence sávszáma sem ismert, a összeg null', () => {
    const unknownBasin: Basin = { ...BASIN, lanes: null };
    const result = poolAvailability(pool({ basins: [unknownBasin] }), [], query(), { now: NOW });
    expect(result.totalFreeLanes).toBeNull();
  });

  it('a részben ismert sávszámot összegzi, a null medencét kihagyja az összegből', () => {
    const unknownBasin: Basin = { ...BASIN, id: 'kulso', lanes: null };
    const result = poolAvailability(pool({ basins: [BASIN, unknownBasin] }), [], query(), {
      now: NOW,
    });
    expect(result.totalFreeLanes).toBe(8);
  });

  it('indoorOnly esetén csak a fedett medencéket veszi', () => {
    const outdoor: Basin = { ...BASIN, id: 'szabadteri', indoor: false, lanes: 6 };
    const result = poolAvailability(
      pool({ basins: [BASIN, outdoor] }),
      [],
      query({ indoorOnly: true }),
      { now: NOW },
    );
    expect(result.basins).toHaveLength(1);
    expect(result.basins[0].basin.id).toBe('50m-fedett');
    expect(result.totalFreeLanes).toBe(8);
  });

  it('másik uszoda foglalása nem szivárog át', () => {
    const blocks = [
      block({ poolId: 'masik-uszoda', weekday: THURSDAY, start: '18:00', end: '20:00', lanesOccupied: 8 }),
    ];
    const result = poolAvailability(pool(), blocks, query(), { now: NOW });
    expect(result.basins[0].freeLanes).toBe(8);
  });
});
