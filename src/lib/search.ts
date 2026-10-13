/**
 * Keresés: uszodák szűrése és sorrendbe rakása a felhasználó kérése alapján.
 *
 * Vezérelv: a „nem tudjuk” nem ugyanaz, mint a „nincs szabad sáv”. Ahol
 * hiányzik az adat, ott nem ejtjük ki csendben a találatot — hátrébb soroljuk,
 * és a UI jelzi, hogy bizonytalan.
 */

import type { LaneBlock, Pool, PoolAvailability, SearchQuery } from './types';
import { poolAvailability } from './availability';

export interface SearchOptions {
  /** Referencia-időpont a frissesség méréséhez (tesztekben rögzíthető). */
  now?: Date;
}

/** A lista végére kerülő elemek rendezési kulcsa. */
const LAST = Number.POSITIVE_INFINITY;

/**
 * Rendezési kulcs a távolsághoz: az ismeretlen koordinátájú uszoda a lista
 * végére kerül, sosem az elejére.
 */
function distanceKey(distanceKm: number | null): number {
  return distanceKm === null || !Number.isFinite(distanceKm) ? LAST : distanceKm;
}

/**
 * Megfelel-e a találat a minimális szabad sáv szűrőnek.
 *
 * - `0`: ismert adat, és teljesíti a feltételt → elöl
 * - `1`: ismeretlen sávadat → megtartjuk, de hátrébb soroljuk
 * - `null`: ismert adat, de kevesebb a szabad sáv a kértnél → kiesik
 */
function laneRank(result: PoolAvailability, minFreeLanes: number | undefined): number | null {
  if (minFreeLanes === undefined) return 0;
  if (result.totalFreeLanes === null) return 1;
  return result.totalFreeLanes >= minFreeLanes ? 0 : null;
}

/**
 * Uszodák keresése egy idősávra.
 *
 * A szűrők sorrendje: fedett medence (már a medencék összesítésénél),
 * távolság, majd minimális szabad sávszám. A végeredmény távolság szerint
 * növekvő, az ismeretlen távolságúak a végén.
 */
export function searchPools(
  pools: Pool[],
  blocks: LaneBlock[],
  query: SearchQuery,
  options: SearchOptions = {},
): PoolAvailability[] {
  const results: Array<{ result: PoolAvailability; rank: number }> = [];

  for (const pool of pools ?? []) {
    const result = poolAvailability(pool, blocks ?? [], query, { now: options.now });

    // Csak fedett medencét kérő keresésnél a szabadtéri-only uszodák kiesnek:
    // a `poolAvailability` már kiszűrte a medencéket, nem maradt mit mutatni.
    if (result.basins.length === 0) continue;

    // Távolságszűrés: az ismeretlen koordinátájú uszodát nem zárjuk ki, mert
    // nem tudjuk bizonyítani, hogy messze van — a sor végén úgyis hátul lesz.
    if (
      query.maxDistanceKm !== undefined &&
      result.distanceKm !== null &&
      result.distanceKm > query.maxDistanceKm
    ) {
      continue;
    }

    const rank = laneRank(result, query.minFreeLanes);
    if (rank === null) continue;

    results.push({ result, rank });
  }

  results.sort((a, b) => {
    // Először a biztos találatok, utánuk az ismeretlen sávadatúak.
    if (a.rank !== b.rank) return a.rank - b.rank;

    // Kivonás helyett összehasonlítás: az ismeretlen távolság Infinity, és
    // az Infinity - 5 nem véges, ami elrontaná a sorrendet.
    const aKey = distanceKey(a.result.distanceKm);
    const bKey = distanceKey(b.result.distanceKm);
    if (aKey !== bKey) return aKey < bKey ? -1 : 1;

    // Azonos (vagy mindkettőnél ismeretlen) távolság: magyar ábécé szerint,
    // hogy a sorrend futásról futásra stabil legyen.
    return a.result.pool.name.localeCompare(b.result.pool.name, 'hu');
  });

  return results.map((entry) => entry.result);
}
