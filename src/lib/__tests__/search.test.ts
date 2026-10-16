import { describe, expect, it } from 'vitest';
import type { Basin, LaneBlock, OpeningHours, Pool, SearchQuery } from '../types';
import { searchPools } from '../search';

const DATE = '2026-09-24'; // csütörtök
const THURSDAY = 4;
const NOW = new Date('2026-09-24T12:00:00Z');

const FULL_WEEK: OpeningHours[] = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
  weekday: weekday as OpeningHours['weekday'],
  opens: '06:00',
  closes: '22:00',
}));

function basin(partial: Partial<Basin> = {}): Basin {
  return {
    id: '50m-fedett',
    name: '50 m-es fedett medence',
    lengthM: 50,
    lanes: 8,
    indoor: true,
    ...partial,
  };
}

function pool(partial: Partial<Pool>): Pool {
  return {
    id: 'uszoda',
    name: 'Uszoda',
    address: 'Budapest',
    lat: 47.5,
    lon: 19.05,
    basins: [basin()],
    openingHours: FULL_WEEK,
    scheduleSource: { type: 'curated', lastVerified: '2026-09-01' },
    ...partial,
  };
}

function query(partial: Partial<SearchQuery> = {}): SearchQuery {
  return { lat: 47.5, lon: 19.05, date: DATE, start: '18:00', end: '20:00', ...partial };
}

// A felhasználótól mért nagyjábóli távolságok: 0,55 km / 5,6 km / ismeretlen.
const NEAR = pool({ id: 'kozeli', name: 'Közeli uszoda', lat: 47.505, lon: 19.05 });
const FAR = pool({ id: 'tavoli', name: 'Távoli uszoda', lat: 47.55, lon: 19.05 });
const NO_COORDS = pool({ id: 'ismeretlen', name: 'Ismeretlen helyű uszoda', lat: null, lon: null });

describe('searchPools — sorrend', () => {
  it('távolság szerint növekvő sorrendbe rak', () => {
    const results = searchPools([FAR, NEAR], [], query(), { now: NOW });
    expect(results.map((r) => r.pool.id)).toEqual(['kozeli', 'tavoli']);
  });

  it('az ismeretlen távolságú uszoda a lista VÉGÉRE kerül, sosem az elejére', () => {
    const results = searchPools([NO_COORDS, FAR, NEAR], [], query(), { now: NOW });
    expect(results.map((r) => r.pool.id)).toEqual(['kozeli', 'tavoli', 'ismeretlen']);
    expect(results[results.length - 1].distanceKm).toBeNull();
  });

  it('a bemeneti sorrend nem számít', () => {
    const permutations = [
      [NEAR, FAR, NO_COORDS],
      [NO_COORDS, NEAR, FAR],
      [FAR, NO_COORDS, NEAR],
    ];
    for (const pools of permutations) {
      const results = searchPools(pools, [], query(), { now: NOW });
      expect(results.map((r) => r.pool.id)).toEqual(['kozeli', 'tavoli', 'ismeretlen']);
    }
  });

  it('több ismeretlen távolságú uszodát magyar ábécé szerint rendez', () => {
    const a = pool({ id: 'b-uszoda', name: 'Zápor uszoda', lat: null, lon: null });
    const b = pool({ id: 'a-uszoda', name: 'Ártézi uszoda', lat: null, lon: null });
    const results = searchPools([a, b], [], query(), { now: NOW });
    expect(results.map((r) => r.pool.id)).toEqual(['a-uszoda', 'b-uszoda']);
  });

  it('kiszámolja a távolságot minden találatra', () => {
    const results = searchPools([NEAR], [], query(), { now: NOW });
    expect(results[0].distanceKm as number).toBeGreaterThan(0.4);
    expect(results[0].distanceKm as number).toBeLessThan(0.7);
  });
});

describe('searchPools — távolságszűrő', () => {
  it('a megadott sugáron kívüli uszodát kihagyja', () => {
    const results = searchPools([NEAR, FAR], [], query({ maxDistanceKm: 2 }), { now: NOW });
    expect(results.map((r) => r.pool.id)).toEqual(['kozeli']);
  });

  it('az ismeretlen koordinátájú uszodát nem zárja ki távolság alapján', () => {
    // Nem tudjuk bizonyítani, hogy messze van — meghagyjuk, de hátul.
    const results = searchPools([NEAR, FAR, NO_COORDS], [], query({ maxDistanceKm: 2 }), {
      now: NOW,
    });
    expect(results.map((r) => r.pool.id)).toEqual(['kozeli', 'ismeretlen']);
  });
});

describe('searchPools — minimális szabad sáv', () => {
  const busyBlock = (poolId: string, lanesOccupied: number): LaneBlock => ({
    poolId,
    basinId: '50m-fedett',
    weekday: THURSDAY,
    start: '18:00',
    end: '20:00',
    lanesOccupied,
    kind: 'club',
    reason: 'Egyesületi edzés',
  });

  it('kiejti azt az uszodát, ahol biztosan kevés a szabad sáv', () => {
    // Közeli: 8 - 6 = 2 szabad; Távoli: 8 - 1 = 7 szabad.
    const blocks = [busyBlock('kozeli', 6), busyBlock('tavoli', 1)];
    const results = searchPools([NEAR, FAR], blocks, query({ minFreeLanes: 4 }), { now: NOW });
    expect(results.map((r) => r.pool.id)).toEqual(['tavoli']);
  });

  it('az ismeretlen sávadatú uszodát megtartja, és távolság szerint rendezi', () => {
    const unknownLanes = pool({
      id: 'sav-ismeretlen',
      name: 'Sávadat nélküli uszoda',
      // Nagyon közel van — távolság alapján ő lenne az első.
      lat: 47.5005,
      lon: 19.05,
      basins: [basin({ lanes: null })],
    });

    const blocks = [busyBlock('kozeli', 1), busyBlock('tavoli', 1)];
    const results = searchPools([unknownLanes, NEAR, FAR], blocks, query({ minFreeLanes: 4 }), {
      now: NOW,
    });

    expect(results.map((r) => r.pool.id)).toEqual(['sav-ismeretlen', 'kozeli', 'tavoli']);
    expect(results[0].totalFreeLanes).toBeNull();
    expect(results[0].confidence).toBe('unknown');
  });

  it('szűrő nélkül a legközelebbi nyer akkor is, ha ismeretlen a sávadata', () => {
    const unknownLanes = pool({
      id: 'sav-ismeretlen',
      name: 'Sávadat nélküli uszoda',
      lat: 47.5005,
      lon: 19.05,
      basins: [basin({ lanes: null })],
    });

    const results = searchPools([NEAR, unknownLanes], [], query(), { now: NOW });
    expect(results.map((r) => r.pool.id)).toEqual(['sav-ismeretlen', 'kozeli']);
  });

  it('a legrosszabb esetű sávszám dönt, nem az átlag', () => {
    // 18:00–19:00 → 8 - 5 = 3 szabad, 19:00–20:00 → 8 szabad. Átlag 5,5 lenne.
    const blocks: LaneBlock[] = [
      { ...busyBlock('kozeli', 5), end: '19:00' },
    ];
    const results = searchPools([NEAR], blocks, query({ minFreeLanes: 4 }), { now: NOW });
    expect(results).toHaveLength(0);

    const looser = searchPools([NEAR], blocks, query({ minFreeLanes: 3 }), { now: NOW });
    expect(looser).toHaveLength(1);
    expect(looser[0].totalFreeLanes).toBe(3);
  });

  it('a minFreeLanes: 0 is szűrőnek számít, de mindenkit átenged', () => {
    const blocks = [busyBlock('kozeli', 99)];
    const results = searchPools([NEAR], blocks, query({ minFreeLanes: 0 }), { now: NOW });
    expect(results).toHaveLength(1);
    expect(results[0].totalFreeLanes).toBe(0);
  });
});

describe('searchPools — fedett medence szűrő', () => {
  it('kiejti a csak szabadtéri uszodát', () => {
    const outdoorOnly = pool({
      id: 'strand',
      name: 'Strand',
      lat: 47.5005,
      lon: 19.05,
      basins: [basin({ id: 'szabadteri', indoor: false })],
    });

    const results = searchPools([outdoorOnly, NEAR], [], query({ indoorOnly: true }), { now: NOW });
    expect(results.map((r) => r.pool.id)).toEqual(['kozeli']);
  });

  it('vegyes uszodából csak a fedett medencéket mutatja', () => {
    const mixed = pool({
      id: 'vegyes',
      name: 'Vegyes uszoda',
      basins: [basin(), basin({ id: 'szabadteri', indoor: false, lanes: 6 })],
    });

    const results = searchPools([mixed], [], query({ indoorOnly: true }), { now: NOW });
    expect(results[0].basins).toHaveLength(1);
    expect(results[0].totalFreeLanes).toBe(8);
  });

  it('szűrő nélkül minden medence látszik', () => {
    const mixed = pool({
      id: 'vegyes',
      name: 'Vegyes uszoda',
      basins: [basin(), basin({ id: 'szabadteri', indoor: false, lanes: 6 })],
    });

    const results = searchPools([mixed], [], query(), { now: NOW });
    expect(results[0].basins).toHaveLength(2);
    expect(results[0].totalFreeLanes).toBe(14);
  });
});

describe('searchPools — peremesetek', () => {
  it('keeps a late-opening pool when lanes are available during the open portion', () => {
    const late = pool({
      id: 'late-opening',
      openingHours: [{ weekday: THURSDAY, opens: '07:00', closes: '22:00' }],
    });
    const blocks: LaneBlock[] = [{
      poolId: late.id,
      basinId: '50m-fedett',
      weekday: THURSDAY,
      start: '06:00',
      end: '07:00',
      lanesOccupied: 8,
      kind: 'closed',
      reason: 'Closed before opening',
    }];
    const results = searchPools([late], blocks, query({ start: '06:00', end: '08:00', minFreeLanes: 1 }), { now: NOW });
    expect(results).toHaveLength(1);
    expect(results[0].totalFreeLanes).toBe(8);
    expect(results[0].basins[0].openIntervals).toEqual([{ start: '07:00', end: '08:00' }]);
  });

  it('does not offer a fully closed pool when free lanes are required', () => {
    const late = pool({ openingHours: [{ weekday: THURSDAY, opens: '08:00', closes: '22:00' }] });
    expect(searchPools([late], [], query({ start: '06:00', end: '08:00', minFreeLanes: 1 }), { now: NOW })).toHaveLength(0);
    const unfiltered = searchPools([late], [], query({ start: '06:00', end: '08:00' }), { now: NOW });
    expect(unfiltered).toHaveLength(1);
    expect(unfiltered[0].totalFreeLanes).toBe(0);
  });

  it('üres uszodalistára üres eredmény', () => {
    expect(searchPools([], [], query(), { now: NOW })).toEqual([]);
  });

  it('medence nélküli uszodát kihagy', () => {
    const empty = pool({ id: 'ures', name: 'Medence nélküli', basins: [] });
    expect(searchPools([empty], [], query(), { now: NOW })).toHaveLength(0);
  });

  it('nem módosítja a bemeneti tömböt', () => {
    const pools = [FAR, NEAR];
    const snapshot = [...pools];
    searchPools(pools, [], query(), { now: NOW });
    expect(pools).toEqual(snapshot);
  });
});
