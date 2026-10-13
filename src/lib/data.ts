/**
 * Adatbetöltő réteg.
 *
 * A `data/pools.json` és `data/blocks.json` statikus importtal jön be, nem
 * `fs`-sel: így a Next build becsomagolja, és Vercelen (szerver nélküli
 * futtatókörnyezetben) is működik, ahol a projektkönyvtár nem olvasható.
 *
 * Mindkét betöltő VALIDÁL: a hibás rekordot kihagyjuk és figyelmeztetünk,
 * ahelyett hogy az egész oldal elszállna egy elgépelt sávszám miatt.
 */

import poolsFile from '../../data/pools.json';
import blocksFile from '../../data/blocks.json';
import type { Basin, BlockKind, LaneBlock, OpeningHours, Pool, ScheduleSource, Weekday } from './types';

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const BLOCK_KINDS: BlockKind[] = ['club', 'school', 'course', 'event', 'maintenance', 'closed'];
const SOURCE_TYPES: ScheduleSource['type'][] = ['scraper', 'curated', 'none'];

/** Hibás rekordok gyűjtője — a betöltés végén egyszer írjuk ki. */
type Problems = string[];

function warn(problems: Problems, message: string): null {
  problems.push(message);
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

/** Szám vagy `null`. A hiányzó érték szándékosan `null` — „nem tudjuk”. */
function asNumberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asWeekday(value: unknown): Weekday | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 7
    ? (value as Weekday)
    : undefined;
}

// ---------------------------------------------------------------------------
// Uszodák
// ---------------------------------------------------------------------------

function parseBasin(raw: unknown, poolId: string, problems: Problems): Basin | null {
  if (!isRecord(raw)) return warn(problems, `${poolId}: egy medence nem objektum.`);

  const id = asString(raw.id);
  const name = asString(raw.name);
  if (!id || !name) return warn(problems, `${poolId}: medence id vagy név hiányzik.`);

  const lengthM = asNumberOrNull(raw.lengthM);
  // A sávszám szándékosan lehet null: ilyenkor a motor `unknown` megbízhatóságot ad,
  // és a UI nem mutat szabad sávszámot. Sosem tippelünk helyette értéket.
  const lanes = asNumberOrNull(raw.lanes);
  if (lanes !== null && (!Number.isInteger(lanes) || lanes < 0)) {
    return warn(problems, `${poolId}/${id}: a sávszám nemnegatív egész vagy null legyen.`);
  }

  return {
    id,
    name,
    lengthM: lengthM ?? 0,
    lanes,
    indoor: raw.indoor === true,
    ...(asString(raw.seasonNote) ? { seasonNote: asString(raw.seasonNote) } : {}),
    ...(asNumberOrNull(raw.waterTempC) !== null ? { waterTempC: asNumberOrNull(raw.waterTempC) as number } : {}),
  };
}

function parseOpeningHours(raw: unknown, poolId: string, problems: Problems): OpeningHours | null {
  if (!isRecord(raw)) return warn(problems, `${poolId}: egy nyitvatartási bejegyzés nem objektum.`);

  const weekday = asWeekday(raw.weekday);
  const opens = asString(raw.opens);
  const closes = asString(raw.closes);

  if (weekday === undefined) return warn(problems, `${poolId}: érvénytelen hétköznap a nyitvatartásban.`);
  if (!opens || !TIME_RE.test(opens) || !closes || !TIME_RE.test(closes)) {
    return warn(problems, `${poolId}: érvénytelen nyitvatartási időpont (ÓÓ:PP kell).`);
  }

  return {
    weekday,
    opens,
    closes,
    ...(asString(raw.seasonNote) ? { seasonNote: asString(raw.seasonNote) } : {}),
  };
}

function parseScheduleSource(raw: unknown): ScheduleSource {
  if (!isRecord(raw)) return { type: 'none' };

  const type = SOURCE_TYPES.includes(raw.type as ScheduleSource['type'])
    ? (raw.type as ScheduleSource['type'])
    : 'none';

  return {
    type,
    ...(asString(raw.adapter) ? { adapter: asString(raw.adapter) } : {}),
    ...(asString(raw.url) ? { url: asString(raw.url) } : {}),
    ...(asString(raw.format) ? { format: raw.format as ScheduleSource['format'] } : {}),
    ...(asString(raw.lastVerified) ? { lastVerified: asString(raw.lastVerified) } : {}),
    ...(asString(raw.lastScrapedAt) ? { lastScrapedAt: asString(raw.lastScrapedAt) } : {}),
    ...(asString(raw.note) ? { note: asString(raw.note) } : {}),
  };
}

function parsePool(raw: unknown, problems: Problems): Pool | null {
  if (!isRecord(raw)) return warn(problems, 'Egy uszoda-rekord nem objektum.');

  const id = asString(raw.id);
  const name = asString(raw.name);
  const address = asString(raw.address);
  if (!id || !name) return warn(problems, `Uszoda id vagy név hiányzik (${String(raw.id ?? '?')}).`);

  const lat = asNumberOrNull(raw.lat);
  const lon = asNumberOrNull(raw.lon);
  // Csak együtt érvényesek, és csak hihető tartományban. Rossz koordináta
  // rosszabb a hiányzónál: oda küldené a felhasználót, ahol nincs uszoda.
  const hasValidCoords =
    lat !== null && lon !== null && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
  if ((lat !== null || lon !== null) && !hasValidCoords) {
    problems.push(`${id}: érvénytelen koordináta, távolság nélkül jelenik meg.`);
  }

  const basins = Array.isArray(raw.basins)
    ? raw.basins.map((b) => parseBasin(b, id, problems)).filter((b): b is Basin => b !== null)
    : [];

  const openingHours = Array.isArray(raw.openingHours)
    ? raw.openingHours
        .map((h) => parseOpeningHours(h, id, problems))
        .filter((h): h is OpeningHours => h !== null)
    : [];

  return {
    id,
    name,
    ...(asString(raw.shortName) ? { shortName: asString(raw.shortName) } : {}),
    ...(asString(raw.district) ? { district: asString(raw.district) } : {}),
    address: address ?? '',
    lat: hasValidCoords ? lat : null,
    lon: hasValidCoords ? lon : null,
    ...(asString(raw.website) ? { website: asString(raw.website) } : {}),
    ...(asString(raw.phone) ? { phone: asString(raw.phone) } : {}),
    basins,
    openingHours,
    scheduleSource: parseScheduleSource(raw.scheduleSource),
    ...(Array.isArray(raw.sources) ? { sources: raw.sources.filter((s): s is string => typeof s === 'string') } : {}),
    ...(asString(raw.confidence) ? { confidence: raw.confidence as Pool['confidence'] } : {}),
  };
}

// ---------------------------------------------------------------------------
// Sávfoglalások
// ---------------------------------------------------------------------------

function parseBlock(raw: unknown, index: number, problems: Problems): LaneBlock | null {
  if (!isRecord(raw)) return warn(problems, `#${index}. foglalás nem objektum.`);

  const poolId = asString(raw.poolId);
  const basinId = asString(raw.basinId);
  const start = asString(raw.start);
  const end = asString(raw.end);

  if (!poolId || !basinId) return warn(problems, `#${index}. foglalás: hiányzó poolId vagy basinId.`);
  if (!start || !TIME_RE.test(start) || !end || !TIME_RE.test(end)) {
    return warn(problems, `${poolId}/${basinId}: érvénytelen időpont (ÓÓ:PP kell).`);
  }
  if (start >= end) {
    // "HH:MM" karakterláncok lexikografikus rendezése megegyezik az időrendivel.
    return warn(problems, `${poolId}/${basinId}: a foglalás vége nem későbbi a kezdeténél (${start}–${end}).`);
  }

  const weekday = asWeekday(raw.weekday);
  const date = asString(raw.date);
  if (date !== undefined && !DATE_RE.test(date)) {
    return warn(problems, `${poolId}/${basinId}: érvénytelen dátum (ÉÉÉÉ-HH-NN kell).`);
  }
  // Pontosan az egyik kell: vagy heti ismétlődő, vagy egyszeri.
  if ((weekday === undefined) === (date === undefined)) {
    return warn(problems, `${poolId}/${basinId}: pontosan egy kell a weekday és a date közül.`);
  }

  const lanesOccupied = asNumberOrNull(raw.lanesOccupied);
  if (lanesOccupied === null || !Number.isInteger(lanesOccupied) || lanesOccupied < 0) {
    return warn(problems, `${poolId}/${basinId}: a foglalt sávszám nemnegatív egész legyen.`);
  }

  const kind = BLOCK_KINDS.includes(raw.kind as BlockKind) ? (raw.kind as BlockKind) : 'club';

  return {
    poolId,
    basinId,
    ...(weekday !== undefined ? { weekday } : {}),
    ...(date !== undefined ? { date } : {}),
    start,
    end,
    lanesOccupied,
    kind,
    reason: asString(raw.reason) ?? 'Foglalt',
  };
}

// ---------------------------------------------------------------------------
// Nyilvános API
// ---------------------------------------------------------------------------

function report(scope: string, problems: Problems): void {
  if (problems.length === 0) return;
  console.warn(`[data] ${scope}: ${problems.length} hibás rekord kihagyva:\n  - ${problems.join('\n  - ')}`);
}

function readArray(file: unknown, key: string): unknown[] {
  if (Array.isArray(file)) return file;
  if (isRecord(file) && Array.isArray(file[key])) return file[key] as unknown[];
  return [];
}

let poolsCache: Pool[] | null = null;
let blocksCache: LaneBlock[] | null = null;

/** Az összes uszoda. A hibás rekordokat kihagyja, nem dob hibát. */
export function loadPools(): Pool[] {
  if (poolsCache) return poolsCache;

  const problems: Problems = [];
  const pools = readArray(poolsFile, 'pools')
    .map((raw) => parsePool(raw, problems))
    .filter((p): p is Pool => p !== null);

  // Ismétlődő azonosító csendben felülírná a másikat a keresésben — inkább szóljunk.
  const seen = new Set<string>();
  const unique = pools.filter((pool) => {
    if (seen.has(pool.id)) {
      problems.push(`${pool.id}: ismétlődő uszoda-azonosító, a másodikat kihagytuk.`);
      return false;
    }
    seen.add(pool.id);
    return true;
  });

  report('uszodák', problems);
  poolsCache = unique;
  return unique;
}

/** Az összes sávfoglalás. A hibás rekordokat kihagyja, nem dob hibát. */
export function loadBlocks(): LaneBlock[] {
  if (blocksCache) return blocksCache;

  const problems: Problems = [];
  const blocks = readArray(blocksFile, 'blocks')
    .map((raw, index) => parseBlock(raw, index, problems))
    .filter((b): b is LaneBlock => b !== null);

  report('sávfoglalások', problems);
  blocksCache = blocks;
  return blocks;
}

/** Csak tesztekhez: a memóriában tartott adat eldobása. */
export function resetDataCache(): void {
  poolsCache = null;
  blocksCache = null;
}
