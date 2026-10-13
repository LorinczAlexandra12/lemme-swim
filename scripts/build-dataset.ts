/**
 * A kutatási nyersanyag (`data/research/*.json`) összefésülése a futtatható
 * adatfájlba (`data/pools.json`).
 *
 * Miért külön lépés: a kutató-ügynökök szabad formájú JSON-t írnak, amiben
 * lehet hiányos vagy félreérthető mező. Ez a szkript normalizál és SZIGORÚAN
 * szűr — inkább kevesebb uszoda kerüljön be, mint rossz adat.
 *
 * Futtatás:  npx tsx scripts/build-dataset.ts
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Basin, OpeningHours, Pool } from '../src/lib/types';

const RESEARCH_DIR = join(process.cwd(), 'data', 'research');
const OUT_FILE = join(process.cwd(), 'data', 'pools.json');
/**
 * Kézi felülírások: melyik uszodánál van TÉNYLEGES sávbeosztásunk.
 *
 * A kutatás csak azt mondja meg, hol publikálják a beosztást — attól még
 * nincs adatunk. Ez a fájl mondja meg, mely uszodáknál van `data/blocks.json`-ban
 * valódi adat, és milyen friss. Enélkül minden uszoda `none` maradna, és a
 * felület „Nincs sávadat"-ot írna a betöltött foglalások ellenére is.
 */
const OVERRIDES_FILE = join(process.cwd(), 'data', 'schedule-sources.json');

/** Budapest durva befoglaló doboza — a kerületen kívüli koordináta gyanús. */
const BUDAPEST_BOUNDS = { minLat: 47.32, maxLat: 47.62, minLon: 18.9, maxLon: 19.36 };

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

interface Report {
  accepted: string[];
  rejected: string[];
  warnings: string[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * Sávszám normalizálása.
 *
 * A `0` itt NEM azt jelenti, hogy „nulla sáv szabad", hanem hogy a medencében
 * nincs sávfelfestés (pl. termálmedence, gyerekmedence, pezsgőfürdő). Ezeket
 * `null`-ra hozzuk, hogy a motor `unknown`-ként kezelje, és a felület ne
 * írjon ki félrevezető „0 / 0 sáv" feliratot.
 */
function normalizeLanes(v: unknown): number | null {
  const n = num(v);
  if (n === null || !Number.isInteger(n) || n <= 0) return null;
  return n;
}

/**
 * Medencék, amelyek a NEVÜKBEN tanmedencék, a valóságban viszont a létesítmény
 * közönségmedencéi — ezeket a tanmedence-szűrő ellenére megtartjuk.
 *
 * Csak névre szűrni azért kevés, mert a „tanmedence" szót több uszoda a
 * kismedencéjére használja akkor is, ha az teljes értékű, felfestett sávos
 * úszómedence. Minden itteni bejegyzéshez KELL bizonyíték a kutatási adatban
 * (`seasonNote`) vagy a forrásoldalon.
 */
const KEEP_DESPITE_NAME = new Set([
  // 25 m, 4 felfestett sáv, és a tuskecsarnok.hu szerint „az uszoda nyitvatartása
  // KIZÁRÓLAG a 25 m-es kismedencére vonatkozik" — azaz ez a közönségmedence.
  // Nélküle a Tüskecsarnok hat sávfoglalásából négy elveszne.
  'tuskecsarnok-sportuszoda/tanmedence',
]);

function normalizeBasin(raw: unknown, poolId: string, report: Report): Basin | null {
  if (!isRecord(raw)) return null;

  const id = str(raw.id);
  const name = str(raw.name);
  if (!id || !name) {
    report.warnings.push(`${poolId}: névtelen medence kihagyva.`);
    return null;
  }

  const lengthM = num(raw.lengthM);
  const lanes = normalizeLanes(raw.lanes);

  // A tanmedencét kihagyjuk, a sávszámtól függetlenül: sekély, rövid, és
  // gyakorlatilag végig oktatás foglalja — a "hol úszhatok most?" kérdésre adott
  // válaszban csak zaj lenne. Ez az EGYETLEN hely, ahol ki kell szűrni: innen már
  // sem az uszodalistába, sem a sávblokkok közé nem jut be (az árván maradt
  // blokkokat a `scripts/scrape.ts` takarítja ki).
  //
  // A szűrő a NEVET nézi, a név viszont néhol félrevezet: lásd `KEEP_DESPITE_NAME`.
  const looksTeaching =
    /tanmedence|oktat[óo]medence|tanuszoda/i.test(name) || /tanmedence/i.test(id);
  if (looksTeaching && !KEEP_DESPITE_NAME.has(`${poolId}/${id}`)) return null;

  // Sávfelfestés nélküli medence (termál, gyógy, gyermek, élmény) nem hosszúszásra
  // való: ezeket kihagyjuk, hogy ne hígítsák a találatot "Nincs sávadat" dobozokkal.
  // Itt CSAK akkor dobjuk el, ha a sávszám is ismeretlen: a felfestett sávú medence
  // a neve ellenére is lehet úszásra alkalmas.
  const looksNonSwim =
    /termál|gyógy|gyerek|gyermek|pezsg|ülő|merül|élmény|csúszda|jacuzzi|strandmedence|sekély/i.test(
      name,
    );
  if (lanes === null && looksNonSwim) return null;

  return {
    id,
    name,
    lengthM: lengthM ?? 0,
    lanes,
    indoor: raw.indoor === true,
    ...(str(raw.seasonNote) ? { seasonNote: str(raw.seasonNote) } : {}),
    ...(num(raw.waterTempC) !== null ? { waterTempC: num(raw.waterTempC) as number } : {}),
  };
}

function normalizeHours(raw: unknown, poolId: string, report: Report): OpeningHours | null {
  if (!isRecord(raw)) return null;
  const weekday = num(raw.weekday);
  const opens = str(raw.opens);
  const closes = str(raw.closes);

  if (weekday === null || !Number.isInteger(weekday) || weekday < 1 || weekday > 7) return null;
  if (!opens || !TIME_RE.test(opens) || !closes || !TIME_RE.test(closes)) {
    report.warnings.push(`${poolId}: hibás nyitvatartási időpont kihagyva (${opens}–${closes}).`);
    return null;
  }
  if (opens >= closes) {
    report.warnings.push(`${poolId}: a zárás nem későbbi a nyitásnál (${opens}–${closes}).`);
    return null;
  }

  return {
    weekday: weekday as OpeningHours['weekday'],
    opens,
    closes,
    ...(str(raw.seasonNote) ? { seasonNote: str(raw.seasonNote) } : {}),
  };
}

type SourceOverrides = Record<string, Partial<Pool['scheduleSource']>>;

function loadOverrides(report: Report): SourceOverrides {
  if (!existsSync(OVERRIDES_FILE)) return {};
  try {
    const parsed: unknown = JSON.parse(readFileSync(OVERRIDES_FILE, 'utf8'));
    if (!isRecord(parsed)) return {};
    const raw = isRecord(parsed.sources) ? parsed.sources : parsed;
    return raw as SourceOverrides;
  } catch (error) {
    report.warnings.push(`schedule-sources.json: érvénytelen JSON (${(error as Error).message}).`);
    return {};
  }
}

function normalizePool(raw: unknown, report: Report, overrides: SourceOverrides): Pool | null {
  if (!isRecord(raw)) return null;

  const id = str(raw.id);
  const name = str(raw.name);
  if (!id || !name) {
    report.rejected.push(`(névtelen): hiányzó id vagy név.`);
    return null;
  }

  // Koordináta: csak akkor fogadjuk el, ha van, érvényes, ÉS Budapesten van.
  // A kutatásból néha elgépelt vagy felcserélt lat/lon érkezik; az ilyet
  // inkább eldobjuk, mint hogy rossz helyre navigáljuk a felhasználót.
  let lat = num(raw.lat);
  let lon = num(raw.lon);
  if (lat !== null && lon !== null) {
    const inBox =
      lat >= BUDAPEST_BOUNDS.minLat &&
      lat <= BUDAPEST_BOUNDS.maxLat &&
      lon >= BUDAPEST_BOUNDS.minLon &&
      lon <= BUDAPEST_BOUNDS.maxLon;
    if (!inBox) {
      report.warnings.push(`${id}: a koordináta Budapesten kívülre esik (${lat}, ${lon}) — elhagyva.`);
      lat = null;
      lon = null;
    }
  } else {
    lat = null;
    lon = null;
  }

  const basins = Array.isArray(raw.basins)
    ? raw.basins.map((b) => normalizeBasin(b, id, report)).filter((b): b is Basin => b !== null)
    : [];

  if (basins.length === 0) {
    report.rejected.push(`${id}: nincs egyetlen úszásra alkalmas medencéje sem.`);
    return null;
  }

  const openingHours = Array.isArray(raw.openingHours)
    ? raw.openingHours
        .map((h) => normalizeHours(h, id, report))
        .filter((h): h is OpeningHours => h !== null)
    : [];

  // Nyitvatartás nélkül semmit nem tudunk válaszolni a „hol úszhatok 18:00-kor?"
  // kérdésre: sem azt, hogy nyitva van-e, sem azt, hogy hány sáv szabad. Az ilyen
  // uszoda csak zajt tenne a találati listába, ezért kihagyjuk. Tipikus eset a
  // tartósan bezárt fürdő (Gellért: felújítás miatt évekig zárva).
  if (openingHours.length === 0) {
    report.rejected.push(`${id}: nincs nyitvatartási adata — nem tudnánk róla semmi érdemit mondani.`);
    return null;
  }

  const rawSource = isRecord(raw.scheduleSource) ? raw.scheduleSource : {};
  const knownLanes = basins.some((b) => b.lanes !== null);

  // A kutatás nem ad sávfoglalásokat, csak azt mondja meg, hol publikálják őket.
  // Amíg nincs tényleges beosztásunk, a forrás `none`: a felület ilyenkor
  // „Nincs sávadat"-ot ír, és nem mutat kitalált szabad sávszámot.
  const scheduleSource: Pool['scheduleSource'] = {
    type: 'none',
    ...(str(rawSource.url) ? { url: str(rawSource.url) } : {}),
    ...(str(rawSource.format) ? { format: rawSource.format as Pool['scheduleSource']['format'] } : {}),
    ...(str(rawSource.note) ? { note: str(rawSource.note) } : {}),
    // A kézi felülírás az utolsó szó: csak itt válhat egy uszoda
    // `curated`/`scraper` forrásúvá, mert csak itt tudjuk, van-e valódi adatunk.
    ...(overrides[id] ?? {}),
  };

  if (!knownLanes) {
    report.warnings.push(`${id}: egyetlen medencéjének sávszámát sem sikerült igazolni.`);
  }

  report.accepted.push(id);

  return {
    id,
    name,
    ...(str(raw.shortName) ? { shortName: str(raw.shortName) } : {}),
    ...(str(raw.district) ? { district: str(raw.district) } : {}),
    address: str(raw.address) ?? '',
    lat,
    lon,
    ...(str(raw.website) ? { website: str(raw.website) } : {}),
    ...(str(raw.phone) ? { phone: str(raw.phone) } : {}),
    basins,
    openingHours,
    scheduleSource,
    ...(Array.isArray(raw.sources)
      ? { sources: raw.sources.filter((s: unknown): s is string => typeof s === 'string') }
      : {}),
    ...(str(raw.confidence) ? { confidence: raw.confidence as Pool['confidence'] } : {}),
  };
}

function main(): void {
  if (!existsSync(RESEARCH_DIR)) {
    console.error(`Nincs kutatási könyvtár: ${RESEARCH_DIR}`);
    process.exit(1);
  }

  const files = readdirSync(RESEARCH_DIR).filter((f) => f.endsWith('.json'));
  const report: Report = { accepted: [], rejected: [], warnings: [] };
  const overrides = loadOverrides(report);
  const byId = new Map<string, Pool>();

  for (const file of files) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(join(RESEARCH_DIR, file), 'utf8'));
    } catch (error) {
      report.rejected.push(`${file}: érvénytelen JSON (${(error as Error).message}).`);
      continue;
    }

    const pools = isRecord(parsed) && Array.isArray(parsed.pools) ? parsed.pools : [];
    for (const raw of pools) {
      const pool = normalizePool(raw, report, overrides);
      if (!pool) continue;
      if (byId.has(pool.id)) {
        report.warnings.push(`${pool.id}: két kutatási fájlban is szerepel, az elsőt tartottuk meg.`);
        continue;
      }
      byId.set(pool.id, pool);
    }
  }

  const pools = [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, 'hu'));
  writeFileSync(OUT_FILE, `${JSON.stringify({ pools }, null, 2)}\n`, 'utf8');

  const withCoords = pools.filter((p) => p.lat !== null).length;
  const withLanes = pools.filter((p) => p.basins.some((b) => b.lanes !== null)).length;

  console.log(`\nForrásfájlok: ${files.length}`);
  console.log(`Beolvasott uszodák: ${pools.length}`);
  console.log(`  ebből koordinátával:  ${withCoords}`);
  console.log(`  ebből ismert sávszámmal: ${withLanes}`);
  if (report.rejected.length) {
    console.log(`\nElutasítva (${report.rejected.length}):`);
    for (const line of report.rejected) console.log(`  - ${line}`);
  }
  if (report.warnings.length) {
    console.log(`\nFigyelmeztetések (${report.warnings.length}):`);
    for (const line of report.warnings) console.log(`  - ${line}`);
  }
  console.log(`\nKiírva: ${OUT_FILE}\n`);
}

main();
