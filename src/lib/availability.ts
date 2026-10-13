/**
 * Elérhetőség-motor: hány úszósáv marad ténylegesen szabadon egy kért idősávban.
 *
 * Két alapelv vezeti az egész modult:
 *
 * 1. LEGROSSZABB ESET, nem átlag. Ha egy sáv a kért idősáv közepén elfogy,
 *    azt a sávot nem ígérjük oda. A kért ablakot a foglalások határai mentén
 *    részintervallumokra bontjuk, és a legkevesebb szabad sávot adó rész számít.
 *
 * 2. SOSEM TIPPELÜNK. Ha nem tudjuk a medence sávszámát, `null`-t adunk vissza
 *    és `unknown` megbízhatóságot — a „nem tudjuk” más, mint a „nulla szabad”.
 */

import type {
  Basin,
  BasinAvailability,
  Confidence,
  LaneBlock,
  OpeningHours,
  Pool,
  PoolAvailability,
  ScheduleSource,
  SearchQuery,
  Weekday,
} from './types';
import { haversineKm } from './geo';
import { MINUTES_PER_DAY, fromMinutes, isoWeekday, toMinuteRange, toMinutes } from './time';

/** Friss scraper-adatnak ennyi órán belüli futást tekintünk. */
export const LIVE_MAX_AGE_HOURS = 48;
/** Kézzel ellenőrzött adat ennyi napig számít ellenőrzöttnek. */
export const VERIFIED_MAX_AGE_DAYS = 60;

/** Opcionális beállítások — elsősorban a tesztelhetőség és a pool-kontextus miatt. */
export interface AvailabilityOptions {
  /** A sávbeosztás forrása; ebből számoljuk a megbízhatóságot. */
  source?: ScheduleSource;
  /** Referencia-időpont a frissesség méréséhez (tesztekben rögzíthető). */
  now?: Date;
  /** Ha meg van adva, csak ennek az uszodának a foglalásait vesszük figyelembe. */
  poolId?: string;
}

interface MinuteInterval {
  start: number;
  end: number;
}

const NO_SOURCE: ScheduleSource = { type: 'none' };

// ---------------------------------------------------------------------------
// Intervallum-segédek
// ---------------------------------------------------------------------------

/** Egy foglalás időhatárai percben, vagy `null`, ha értelmezhetetlen. */
function blockInterval(block: LaneBlock): MinuteInterval | null {
  return toMinuteRange({ start: block.start, end: block.end });
}

/**
 * `base` mínusz a `holes` intervallumok — a megmaradó darabokat adja vissza.
 * Ezzel írják felül az egyszeri (dátumos) foglalások a heti ismétlődőket:
 * a felülírt időszakot kivágjuk, a heti blokk többi része érvényben marad.
 */
function subtractIntervals(base: MinuteInterval, holes: MinuteInterval[]): MinuteInterval[] {
  let fragments: MinuteInterval[] = [base];

  for (const hole of holes) {
    const next: MinuteInterval[] = [];
    for (const fragment of fragments) {
      if (hole.end <= fragment.start || hole.start >= fragment.end) {
        // Nincs átfedés — a darab érintetlen marad.
        next.push(fragment);
        continue;
      }
      if (hole.start > fragment.start) {
        next.push({ start: fragment.start, end: hole.start });
      }
      if (hole.end < fragment.end) {
        next.push({ start: hole.end, end: fragment.end });
      }
      // Teljes lefedés esetén semmit nem teszünk vissza: a darab eltűnik.
    }
    fragments = next;
  }

  return fragments.filter((f) => f.end > f.start);
}

// ---------------------------------------------------------------------------
// A kért napon érvényes foglalások feloldása
// ---------------------------------------------------------------------------

/**
 * Megállapítja, mely foglalások érvényesek a kért napon egy medencére.
 *
 * Egy blokk akkor érvényes, ha a `date` megegyezik a kért dátummal, VAGY a
 * `weekday` megegyezik a kért dátum ISO hétköznapjával.
 *
 * A dátumhoz kötött blokk FELÜLÍRJA az ugyanarra a medencére és átfedő
 * időszakra vonatkozó heti ismétlődőket: egy verseny vagy egyszeri zárás
 * a szokásos heti beosztás helyébe lép, nem hozzáadódik. A heti blokk
 * felül nem írt része viszont megmarad (darabolva).
 */
export function resolveBlocksForDate(
  basin: Basin,
  blocks: LaneBlock[],
  date: string,
  poolId?: string,
): LaneBlock[] {
  const weekday = isoWeekday(date);

  const relevant = (blocks ?? []).filter(
    (block) =>
      block.basinId === basin.id && (poolId === undefined || block.poolId === poolId),
  );

  // Egyszeri, épp a kért napra szóló foglalások.
  const dated = relevant.filter((block) => block.date === date);
  // Heti ismétlődők: csak akkor, ha nincs saját dátumuk.
  const recurring = relevant.filter(
    (block) => !block.date && weekday !== null && block.weekday === weekday,
  );

  const overrideHoles = dated
    .map(blockInterval)
    .filter((interval): interval is MinuteInterval => interval !== null);

  const survivors: LaneBlock[] = [];
  for (const block of recurring) {
    const interval = blockInterval(block);
    if (!interval) continue;
    for (const fragment of subtractIntervals(interval, overrideHoles)) {
      survivors.push(
        fragment.start === interval.start && fragment.end === interval.end
          ? block
          : // A megmaradó rész pontos időhatárával adjuk vissza, hogy a UI
            // azt mutassa, ami tényleg érvényes.
            { ...block, start: fromMinutes(fragment.start), end: fromMinutes(fragment.end) },
      );
    }
  }

  return [...dated, ...survivors];
}

// ---------------------------------------------------------------------------
// Legrosszabb esetű szabad sávszám
// ---------------------------------------------------------------------------

interface OccupancySpan extends MinuteInterval {
  lanesOccupied: number;
}

/**
 * Végigsöpör a kért ablakon a foglalások határai mentén, és a legkevesebb
 * szabad sávot adó részintervallum értékét adja vissza.
 */
function worstCaseFreeLanes(
  totalLanes: number,
  spans: OccupancySpan[],
  window: MinuteInterval,
): number {
  const clamp = (occupied: number) =>
    // A publikált beosztások néha túlosztanak (több sávot foglalnak, mint amennyi
    // van) — ilyenkor 0 a helyes válasz, nem negatív szám.
    Math.max(0, Math.min(totalLanes, totalLanes - occupied));

  // Nulla hosszú ablak: egyetlen pillanatot vizsgálunk.
  if (window.end <= window.start) {
    const occupied = spans
      .filter((span) => span.start <= window.start && span.end > window.start)
      .reduce((sum, span) => sum + Math.max(0, span.lanesOccupied), 0);
    return clamp(occupied);
  }

  const boundaries = new Set<number>([window.start, window.end]);
  for (const span of spans) {
    if (span.start > window.start && span.start < window.end) boundaries.add(span.start);
    if (span.end > window.start && span.end < window.end) boundaries.add(span.end);
  }

  const points = [...boundaries].sort((a, b) => a - b);

  let worst = totalLanes;
  for (let i = 0; i < points.length - 1; i += 1) {
    const from = points[i];
    const to = points[i + 1];
    const occupied = spans
      .filter((span) => span.start < to && span.end > from)
      .reduce((sum, span) => sum + Math.max(0, span.lanesOccupied), 0);
    worst = Math.min(worst, clamp(occupied));
  }

  return worst;
}

// ---------------------------------------------------------------------------
// Nyitvatartás
// ---------------------------------------------------------------------------

/**
 * Igaz, ha a nyitvatartás a kért ablak EGÉSZÉT lefedi az adott napon.
 *
 * Több bejegyzés is tartozhat ugyanahhoz a naphoz (pl. 06:00–08:00 és
 * 16:00–20:00): ezeket összefésüljük, és a köztük lévő szünet miatt egy
 * 07:00–17:00-s kérés helyesen `false` lesz.
 */
export function isOpenThroughout(
  openingHours: OpeningHours[],
  weekday: Weekday | null,
  window: MinuteInterval,
): boolean {
  if (weekday === null) return false;

  const spans = (openingHours ?? [])
    .filter((entry) => entry.weekday === weekday)
    .map((entry) => toMinuteRange({ start: entry.opens, end: entry.closes }))
    .filter((span): span is MinuteInterval => span !== null)
    .sort((a, b) => a.start - b.start);

  if (spans.length === 0) return false;
  if (window.end <= window.start) {
    // Nulla hosszú ablak: elég, ha az adott pillanat nyitvatartási időbe esik.
    return spans.some((span) => span.start <= window.start && span.end > window.start);
  }

  let covered = window.start;
  for (const span of spans) {
    if (span.start > covered) break; // Szünet a nyitvatartásban — innen nincs fedés.
    covered = Math.max(covered, span.end);
    if (covered >= window.end) return true;
  }

  return covered >= window.end;
}

// ---------------------------------------------------------------------------
// Megbízhatóság
// ---------------------------------------------------------------------------

function parseTimestamp(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

/** "YYYY-MM-DD" → ezredmásodperc (déli 12:00 UTC), hogy az időzóna ne csússzon. */
function parseDateOnly(value: string | undefined): number | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return parseTimestamp(value);
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12);
}

/**
 * Mennyire hihető a sávszám.
 *
 * - `live`: scraper-adat, 48 órán belüli futással
 * - `verified`: kézzel rögzített, 60 napon belül ellenőrizve
 * - `stale`: van adatunk, de régebbi a fenti küszöböknél
 * - `unknown`: nincs sávbeosztásunk, vagy nem ismerjük a sávszámot
 */
export function computeConfidence(
  source: ScheduleSource | undefined,
  lanesKnown: boolean,
  now: Date = new Date(),
): Confidence {
  const effective = source ?? NO_SOURCE;
  if (!lanesKnown || effective.type === 'none') return 'unknown';

  const reference = now.getTime();

  if (effective.type === 'scraper') {
    const scrapedAt = parseTimestamp(effective.lastScrapedAt);
    if (scrapedAt === null) return 'stale';
    const ageHours = (reference - scrapedAt) / (1000 * 60 * 60);
    return ageHours <= LIVE_MAX_AGE_HOURS ? 'live' : 'stale';
  }

  if (effective.type === 'curated') {
    const verifiedAt = parseDateOnly(effective.lastVerified);
    if (verifiedAt === null) return 'stale';
    const ageDays = (reference - verifiedAt) / (1000 * 60 * 60 * 24);
    return ageDays <= VERIFIED_MAX_AGE_DAYS ? 'verified' : 'stale';
  }

  return 'unknown';
}

/** Megbízhatósági rangsor: minél kisebb, annál rosszabb. */
const CONFIDENCE_RANK: Record<Confidence, number> = {
  unknown: 0,
  stale: 1,
  verified: 2,
  live: 3,
};

/** A legrosszabb megbízhatóság a listából. Üres listára `unknown`. */
export function worstConfidence(values: Confidence[]): Confidence {
  if (values.length === 0) return 'unknown';
  return values.reduce((worst, current) =>
    CONFIDENCE_RANK[current] < CONFIDENCE_RANK[worst] ? current : worst,
  );
}

// ---------------------------------------------------------------------------
// Medence-szintű elérhetőség
// ---------------------------------------------------------------------------

/**
 * Egy medence elérhetősége a kért idősávban.
 *
 * A `blocks` lehet az összes foglalás: a medencére (és ha az `options.poolId`
 * meg van adva, az uszodára) szűrünk.
 */
export function basinAvailability(
  basin: Basin,
  blocks: LaneBlock[],
  openingHours: OpeningHours[],
  query: SearchQuery,
  options: AvailabilityOptions = {},
): BasinAvailability {
  const weekday = isoWeekday(query.date);
  const requested = toMinuteRange({ start: query.start, end: query.end });

  // Értelmezhetetlen idősávra a teljes napot vizsgáljuk — így sem ígérünk többet
  // a valóságnál, mert a legrosszabb esetet nézzük.
  const window: MinuteInterval = requested ?? { start: 0, end: MINUTES_PER_DAY };

  const applicable = resolveBlocksForDate(basin, blocks, query.date, options.poolId);

  // Csak a kért ablakot ténylegesen érintő foglalások érdekelnek.
  const spans: OccupancySpan[] = [];
  const touching: LaneBlock[] = [];
  for (const block of applicable) {
    const interval = blockInterval(block);
    if (!interval) continue;
    if (interval.end <= window.start || interval.start >= window.end) continue;
    spans.push({ ...interval, lanesOccupied: block.lanesOccupied });
    touching.push(block);
  }

  touching.sort((a, b) => toMinutes(a.start) - toMinutes(b.start));

  const totalLanes = typeof basin.lanes === 'number' && Number.isFinite(basin.lanes)
    ? basin.lanes
    : null;

  const lanesKnown = totalLanes !== null;
  const freeLanes = lanesKnown ? worstCaseFreeLanes(totalLanes, spans, window) : null;

  return {
    basin,
    totalLanes,
    freeLanes,
    blocks: touching,
    openThroughout: isOpenThroughout(openingHours, weekday, window),
    openingHoursKnown:
      weekday !== null && (openingHours ?? []).some((entry) => entry.weekday === weekday),
    confidence: computeConfidence(options.source, lanesKnown, options.now),
  };
}

// ---------------------------------------------------------------------------
// Uszoda-szintű elérhetőség
// ---------------------------------------------------------------------------

/**
 * Egy uszoda elérhetősége: medencénként összesítve, távolsággal együtt.
 *
 * A távolság légvonalbeli; ha az uszodának nincs hiteles koordinátája,
 * `null` — ilyenkor a UI „ismeretlen távolság”-ot ír, nem nullát.
 */
export function poolAvailability(
  pool: Pool,
  blocks: LaneBlock[],
  query: SearchQuery,
  options: Pick<AvailabilityOptions, 'now'> = {},
): PoolAvailability {
  // Az uszodához tartozó foglalásokat egyszer szűrjük ki, medencénként nem.
  const poolBlocks = (blocks ?? []).filter((block) => block.poolId === pool.id);

  const basins = (pool.basins ?? [])
    .filter((basin) => !query.indoorOnly || basin.indoor)
    .map((basin) =>
      basinAvailability(basin, poolBlocks, pool.openingHours ?? [], query, {
        source: pool.scheduleSource,
        now: options.now,
        poolId: pool.id,
      }),
    );

  const known = basins.filter((entry) => entry.freeLanes !== null);
  const totalFreeLanes =
    known.length === 0 ? null : known.reduce((sum, entry) => sum + (entry.freeLanes ?? 0), 0);

  const distanceKm =
    pool.lat === null || pool.lon === null
      ? null
      : (() => {
          const km = haversineKm({ lat: query.lat, lon: query.lon }, { lat: pool.lat as number, lon: pool.lon as number });
          return Number.isFinite(km) ? km : null;
        })();

  return {
    pool,
    distanceKm,
    basins,
    totalFreeLanes,
    confidence: worstConfidence(basins.map((entry) => entry.confidence)),
  };
}
