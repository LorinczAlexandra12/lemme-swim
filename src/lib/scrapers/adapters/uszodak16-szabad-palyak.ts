/**
 * XVI. kerületi uszodák (uszodak16.hu) — „Szabad pályák a közönség részére".
 *
 * Két uszoda, EGY értelmező: az Erzsébetligeti Rátonyi Gábor Uszoda és a
 * Szentmihályi Konrád Ferenc Uszoda ugyanazon a CMS-en, azonos sémával
 * publikál. Ez a projekt legjobb minőségű forrása: teljes heti rács,
 * félórás felbontással, 06:00-tól 21:30-ig.
 *
 * FONTOS SZEMANTIKAI KÜLÖNBSÉG: ez a forrás a SZABAD sávokat közli, nem a
 * foglaltakat — mi viszont `lanesOccupied`-et tárolunk. Ezért itt megfordítjuk:
 *
 *     lanesOccupied = összes sáv − a cellában álló szabad sávszám
 *
 * A cellaértékek:
 *   szám  → ennyi sáv áll a közönség rendelkezésére,
 *   „X"   → a medence ekkor nem áll a közönség rendelkezésére.
 *
 * A `did` paramétert SOSEM drótozzuk be: az új beosztás feltöltésekor változik.
 * A beosztás oldalát mindig a bal oldali menü „Szabad pályák a közönségnek"
 * hivatkozásából oldjuk fel.
 *
 * A rácsot az azonosítja, hogy a fejlécsora pontosan
 * `['', 'H', 'K', 'Sz', 'Cs', 'P', 'Szo', 'V']`. Ez szándékosan szigorú: az
 * oldalon van egy MÁSIK táblázat is (az eseménynaptár), amelynek szintén
 * hétköznap-fejléce van — de az szombatot `Sz`-szel rövidíti, nem `Szo`-val,
 * és hét cellából áll, nem nyolcból.
 *
 * A tanmedence táblázatát (`i` = igen) szándékosan NEM dolgozzuk fel: egyik
 * uszoda tanmedencéjének sem ismerjük a sávszámát, így `lanesOccupied`-et sem
 * tudnánk belőle számolni. Kitalálni nem találunk ki sávszámot.
 */

import * as cheerio from 'cheerio';
import type { LaneBlock, Weekday } from '../../types';
import { asText, fetchRaw } from '../http';
import { registerAdapter, type Adapter, type ParseContext, type RawSource } from '../types';

/** A rács fejléce — az oszlopok sorrendje adja a hétköznapot (1 = hétfő). */
const HEADER = ['', 'H', 'K', 'Sz', 'Cs', 'P', 'Szo', 'V'];

/** A beosztásoldalra mutató menüpont szövege. */
const SCHEDULE_LINK_RE = /szabad\s+pály/i;

export interface Uszodak16Config {
  /** Az adapter azonosítója, pl. "uszodak16-erzsebetligeti". */
  id: string;
  /** A `data/pools.json`-beli uszoda-azonosító. */
  poolId: string;
  /** Melyik medencére vonatkozik a rács. */
  basinId: string;
  /** A medence összes sávja — ehhez képest számoljuk a foglaltságot. */
  totalLanes: number;
  /** Az uszoda nyitóoldala; innen keressük ki a beosztás linkjét. */
  landingUrl: string;
  /** Magyar megnevezés a naplóban és a hibaüzenetekben. */
  label: string;
}

/** „6:00 - 6:30" → `{ start: '06:00', end: '06:30' }`. */
export function parseUszodak16TimeRange(
  label: string,
): { start: string; end: string } | null {
  const match = label
    .replace(/\s+/g, ' ')
    .trim()
    .match(/^(\d{1,2})[.:](\d{2})\s*[-–—]\s*(\d{1,2})[.:](\d{2})$/);
  if (!match) return null;

  const start = `${match[1].padStart(2, '0')}:${match[2]}`;
  const end = `${match[3].padStart(2, '0')}:${match[4]}`;
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(start) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(end)) {
    return null;
  }
  return start < end ? { start, end } : null;
}

/** Egy cella jelentése: hány sáv szabad, vagy zárva, vagy értelmezhetetlen. */
type Cell = { kind: 'free'; freeLanes: number } | { kind: 'closed' } | { kind: 'unknown' };

export function parseUszodak16Cell(text: string): Cell {
  const value = text.replace(/\s+/g, '').toLowerCase();
  if (value === '') return { kind: 'unknown' };
  // „X" (bármilyen kis/nagybetűvel) a zárva jelölése.
  if (value === 'x') return { kind: 'closed' };
  if (/^\d{1,2}$/.test(value)) return { kind: 'free', freeLanes: Number(value) };
  return { kind: 'unknown' };
}

/** Egy félórás rácssor: időhatár + a hét nap cellái. */
interface GridRow {
  start: string;
  end: string;
  cells: Cell[];
}

function cellText($: cheerio.CheerioAPI, el: never): string {
  return $(el).text().replace(/ /g, ' ').trim();
}

/**
 * Megkeresi a szabad sávokat tartalmazó rácsot, és sorokká alakítja.
 * Ha nincs ilyen táblázat, DOB — az üres siker azt hazudná, hogy minden szabad.
 */
function extractGrid($: cheerio.CheerioAPI, ctx: ParseContext, label: string): GridRow[] {
  let grid: GridRow[] | null = null;

  $('table').each((_, table) => {
    if (grid) return;

    const rows = $(table).find('tr').toArray();
    const headerIndex = rows.findIndex((row) => {
      const cells = $(row)
        .find('td, th')
        .toArray()
        .map((c) => cellText($, c as never));
      return (
        cells.length === HEADER.length &&
        cells.every((cell, i) => cell.toLowerCase() === HEADER[i].toLowerCase())
      );
    });
    if (headerIndex === -1) return;

    const parsed: GridRow[] = [];
    for (const row of rows.slice(headerIndex + 1)) {
      const cells = $(row)
        .find('td, th')
        .toArray()
        .map((c) => cellText($, c as never));
      if (cells.length !== HEADER.length) continue;

      const range = parseUszodak16TimeRange(cells[0]);
      if (!range) {
        // A rács alatt állhat lábjegyzet vagy magyarázó sor — az nem hiba.
        if (cells[0] !== '') {
          ctx.warn(`${label}: értelmezhetetlen idősáv a rácsban („${cells[0]}") — kihagyva.`);
        }
        continue;
      }

      parsed.push({
        start: range.start,
        end: range.end,
        cells: cells.slice(1).map(parseUszodak16Cell),
      });
    }

    if (parsed.length > 0) grid = parsed;
  });

  if (!grid) {
    throw new Error(
      `${label}: nem találtam a „szabad sávok" rácsot (fejléc: ${HEADER.join(' ')}). ` +
        'Valószínűleg megváltozott az oldal szerkezete.',
    );
  }
  return grid;
}

/**
 * A rács egy napjának oszlopából összevont sávfoglalásokat készít.
 *
 * Az egymás utáni, AZONOS értékű félórás sorokat egyetlen blokkba vonjuk
 * össze: enélkül uszodánként kétszáz fölötti, félórás szeletekből álló
 * blokklistánk lenne, ami a felületen olvashatatlan.
 */
function blocksForDay(
  grid: GridRow[],
  dayIndex: number,
  config: Uszodak16Config,
  ctx: ParseContext,
): LaneBlock[] {
  const blocks: LaneBlock[] = [];

  let runStart: string | null = null;
  let runEnd = '';
  let runCell: Cell | null = null;

  const flush = () => {
    if (runStart === null || runCell === null) return;
    const cell = runCell;
    const start = runStart;
    const end = runEnd;
    runStart = null;
    runCell = null;

    if (cell.kind === 'unknown') return;

    const weekday = (dayIndex + 1) as Weekday;

    if (cell.kind === 'closed') {
      blocks.push({
        poolId: config.poolId,
        basinId: config.basinId,
        weekday,
        start,
        end,
        lanesOccupied: config.totalLanes,
        kind: 'closed',
        reason: 'Az uszoda közlése szerint ekkor a medence nem áll a közönség rendelkezésére',
      });
      return;
    }

    let free = cell.freeLanes;
    if (free > config.totalLanes) {
      ctx.warn(
        `${config.label}: a rács ${free} szabad sávot ír, de a medencének csak ` +
          `${config.totalLanes} sávja van (${start}–${end}) — ${config.totalLanes}-ra vágva.`,
      );
      free = config.totalLanes;
    }

    const occupied = config.totalLanes - free;
    // Ha minden sáv szabad, nincs mit rögzíteni: a blokk hiánya a „szabad".
    if (occupied <= 0) return;

    blocks.push({
      poolId: config.poolId,
      basinId: config.basinId,
      weekday,
      start,
      end,
      lanesOccupied: occupied,
      // A forrás NEM mondja meg, ki foglalja a sávokat, csak azt, hány marad a
      // közönségnek. A semleges `club` alapértelmezést használjuk, az igazságot
      // pedig a `reason` hordozza — klubnevet nem találunk ki.
      kind: 'club',
      reason: `Az uszoda közlése szerint ekkor ${free} sáv áll a közönség rendelkezésére`,
    });
  };

  for (const row of grid) {
    const cell = row.cells[dayIndex] ?? { kind: 'unknown' as const };
    const sameAsRun =
      runCell !== null &&
      runCell.kind === cell.kind &&
      (runCell.kind !== 'free' || cell.kind !== 'free' || runCell.freeLanes === cell.freeLanes);

    // Az összevonás csak folytonos időszakon belül érvényes: ha a rácsban lyuk
    // van (pl. 14:00 után 15:00 jön), új blokkot kezdünk.
    if (sameAsRun && runEnd === row.start) {
      runEnd = row.end;
      continue;
    }

    flush();
    runStart = row.start;
    runEnd = row.end;
    runCell = cell;
  }
  flush();

  return blocks;
}

/** A letöltött beosztásoldal → heti ismétlődő sávfoglalások. */
export function parseUszodak16Grid(
  raw: RawSource,
  ctx: ParseContext,
  config: Uszodak16Config,
): LaneBlock[] {
  const $ = cheerio.load(asText(raw));
  const grid = extractGrid($, ctx, config.label);

  const blocks: LaneBlock[] = [];
  for (let day = 0; day < 7; day += 1) {
    blocks.push(...blocksForDay(grid, day, config, ctx));
  }

  if (blocks.length === 0) {
    throw new Error(
      `${config.label}: a rácsot elolvastam, de egyetlen foglalást sem adott. ` +
        'Ez gyanús — a beosztás sosem teljesen üres.',
    );
  }

  return blocks;
}

/**
 * A beosztásoldal URL-jének feloldása a nyitóoldal menüjéből.
 * Azért nem drótozzuk be a `did`-et, mert új beosztás feltöltésekor változik.
 */
export async function resolveScheduleUrl(config: Uszodak16Config): Promise<string> {
  const landing = await fetchRaw(config.landingUrl);
  const $ = cheerio.load(asText(landing));

  let href: string | null = null;
  $('a').each((_, el) => {
    if (href) return;
    const text = $(el).text().replace(/\s+/g, ' ').trim();
    const candidate = $(el).attr('href');
    if (candidate && SCHEDULE_LINK_RE.test(text)) href = candidate;
  });

  if (!href) {
    throw new Error(
      `${config.label}: a nyitóoldalon nem találtam „Szabad pályák…" hivatkozást ` +
        `(${config.landingUrl}). Valószínűleg átalakult a menü.`,
    );
  }

  return new URL(href, config.landingUrl).toString();
}

function createAdapter(config: Uszodak16Config): Adapter {
  return {
    id: config.id,
    poolId: config.poolId,
    sourceUrl: config.landingUrl,
    description: `${config.label} — „Szabad pályák a közönség részére" heti rács (HTML-táblázat).`,
    async fetch(): Promise<RawSource> {
      return fetchRaw(await resolveScheduleUrl(config));
    },
    parse(raw: RawSource, ctx: ParseContext): LaneBlock[] {
      return parseUszodak16Grid(raw, ctx, config);
    },
  };
}

export const ERZSEBETLIGETI: Uszodak16Config = {
  id: 'uszodak16-erzsebetligeti',
  poolId: 'erzsebetligeti-ratonyi-gabor-uszoda',
  basinId: '25m-uszomedence',
  totalLanes: 6,
  landingUrl: 'https://www.uszodak16.hu/erzsebetligeti-uszoda/',
  label: 'Erzsébetligeti Rátonyi Gábor Uszoda',
};

export const SZENTMIHALYI: Uszodak16Config = {
  id: 'uszodak16-szentmihalyi',
  poolId: 'szentmihalyi-konrad-ferenc-uszoda',
  basinId: '25m-uszomedence',
  totalLanes: 6,
  landingUrl: 'https://www.uszodak16.hu/szentmihalyi-uszoda/',
  label: 'Szentmihályi Konrád Ferenc Uszoda',
};

export const erzsebetligetiAdapter = createAdapter(ERZSEBETLIGETI);
export const szentmihalyiAdapter = createAdapter(SZENTMIHALYI);

registerAdapter(erzsebetligetiAdapter);
registerAdapter(szentmihalyiAdapter);
