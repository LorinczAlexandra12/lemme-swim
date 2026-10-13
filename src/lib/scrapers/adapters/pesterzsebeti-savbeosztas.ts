/**
 * Pesterzsébeti Uszoda — sávbeosztás (HTML-táblázat).
 *
 * A `/savbeosztas/` oldal csak egy választó; a tényleges beosztás medencénkénti
 * ALOLDALAKON van. Ezek közül CSAK a `/melyvizes-medence/`-t dolgozzuk fel
 * (10 pálya, „0.pálya" … „9.pálya"). A `/tanmedence/` oldalát szándékosan nem
 * töltjük le: a tanmedence sehol nem szerepel az adathalmazban (lásd a
 * `scripts/build-dataset.ts` szűrőjét), így a blokkjainak sem lenne hová
 * kerülniük — felesleges kérés lenne az uszoda kiszolgálója felé.
 *
 * Az oldalon NAPONKÉNT egy táblázat áll, hétfőtől szombatig (hat darab),
 * a táblázat előtti címsor adja a napot. VASÁRNAPRA NINCS TÁBLÁZAT — ilyenkor
 * szándékosan nem keletkezik blokk: az adat hiánya nem jelent foglaltságot.
 *
 * A rács sorai óránként haladnak, az oszlopok a pályák. Egy cella:
 *   üres         → az a pálya abban az órában szabad,
 *   szöveges     → foglalt („iskola", „foglalt", „iskolai-óvodai oktatás"…).
 *
 * A LÉNYEGI CSAPDA A `colspan`: a több pályára szóló foglalás EGYETLEN cella
 * `colspan="3"`-mal. Ha a cellákat egyszerűen megszámolnánk, három lefoglalt
 * pályából egy lenne, és az uszoda sokkal szabadabbnak látszana a valóságnál.
 * Ezért minden sort pályánkénti résekre bontunk ki a `colspan` mentén, és
 * ellenőrizzük, hogy pontosan annyi rés jött ki, ahány pálya van.
 *
 * MIÉRT „BORÍTÉK" EGYETLEN OLDALHOZ IS: a `scripts/scrape.ts` uszodánként
 * cseréli le a blokkokat (`blocks.filter(b => b.poolId !== result.poolId)`), így
 * két külön adapter ugyanarra az uszodára kitörölné egymás eredményét. Ha
 * valaha újabb medence-aloldal kerül be, itt kell hozzáadni a `PAGES`-hez —
 * NEM új adapterként.
 */

import * as cheerio from 'cheerio';
import type { BlockKind, LaneBlock, Weekday } from '../../types';
import { asText, fetchRaw } from '../http';
import { registerAdapter, type Adapter, type ParseContext, type RawSource } from '../types';

const POOL_ID = 'pesterzsebeti-uszoda';

/** A táblázatok sorrendjét a címsorok adják; vasárnap szándékosan hiányzik. */
const WEEKDAY_NAMES: Record<string, Weekday> = {
  hétfő: 1,
  kedd: 2,
  szerda: 3,
  csütörtök: 4,
  péntek: 5,
  szombat: 6,
  vasárnap: 7,
};

const DAY_RE = /(hétfő|kedd|szerda|csütörtök|péntek|szombat|vasárnap)/gi;

interface BasinPage {
  basinId: string;
  /** Hány pálya van — ennyi résre kell kibomlania minden sornak. */
  lanes: number;
  url: string;
  label: string;
}

const PAGES: BasinPage[] = [
  {
    basinId: 'melyvizes-medence',
    lanes: 10,
    url: 'https://www.pesterzsebetiuszoda.hu/melyvizes-medence/',
    label: 'Mélyvizes medence',
  },
];

/** A `fetch()` által összeállított boríték: két aloldal egy rekordban. */
interface Envelope {
  pages: { basinId: string; url: string; html: string }[];
}

/** „6.00-7.00" / „8.15-9.15" → `{ start: '06:00', end: '07:00' }`. */
export function parsePesterzsebetTimeRange(
  label: string,
): { start: string; end: string } | null {
  const match = label
    .replace(/\s+/g, '')
    .match(/^(\d{1,2})[.:](\d{2})[-–—](\d{1,2})[.:](\d{2})$/);
  if (!match) return null;

  const start = `${match[1].padStart(2, '0')}:${match[2]}`;
  const end = `${match[3].padStart(2, '0')}:${match[4]}`;
  const valid = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (!valid.test(start) || !valid.test(end) || start >= end) return null;
  return { start, end };
}

/** A foglalás jellege a cella szövegéből. Amit nem ismerünk fel, az `club`. */
export function classifyPesterzsebetCell(text: string): BlockKind {
  const value = text.toLowerCase();
  if (/iskola|óvod|oktatás|tanfolyam/.test(value)) return 'school';
  if (/karbantart|takarít|technikai/.test(value)) return 'maintenance';
  return 'club';
}

/**
 * A táblázat előtti legközelebbi nap-címsor.
 *
 * Csak a KORÁBBI testvércsomópontokat járjuk be (és felfelé haladva azok
 * testvéreit), mert a szülő szövege magát a táblázatot is tartalmazná. A
 * szöveg UTOLSÓ nap-előfordulását vesszük: az oldal tetején van egy felsorolás
 * is az összes napról, de a táblázathoz a hozzá legközelebbi címsor tartozik.
 */
function dayBeforeTable($: cheerio.CheerioAPI, table: cheerio.Cheerio<never>): Weekday | null {
  let node: cheerio.Cheerio<never> = table;

  for (let depth = 0; depth < 12; depth += 1) {
    let prev = node.prev();
    while (prev.length > 0) {
      const matches = prev.text().match(DAY_RE);
      if (matches && matches.length > 0) {
        const last = matches[matches.length - 1].toLowerCase();
        return WEEKDAY_NAMES[last] ?? null;
      }
      prev = prev.prev();
    }
    const parent = node.parent();
    if (parent.length === 0 || parent.is('body') || parent.is('html')) break;
    node = parent as cheerio.Cheerio<never>;
  }

  return null;
}

/** Egy sor cellái pályánkénti résekre bontva, a `colspan` kibontásával. */
function expandRow($: cheerio.CheerioAPI, row: cheerio.Cheerio<never>): string[] {
  const slots: string[] = [];

  $(row)
    .find('td, th')
    .slice(1) // az első cella az idősáv felirata
    .each((_, cell) => {
      const text = $(cell).text().replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
      const span = Number($(cell).attr('colspan') ?? '1');
      const width = Number.isInteger(span) && span > 0 ? span : 1;
      for (let i = 0; i < width; i += 1) slots.push(text);
    });

  return slots;
}

interface RowOccupancy {
  start: string;
  end: string;
  occupied: number;
  reason: string;
  kind: BlockKind;
}

function readTable(
  $: cheerio.CheerioAPI,
  table: cheerio.Cheerio<never>,
  page: BasinPage,
  ctx: ParseContext,
): RowOccupancy[] {
  const rows = $(table).find('tr').toArray();
  const out: RowOccupancy[] = [];

  for (const row of rows) {
    const cells = $(row).find('td, th');
    if (cells.length === 0) continue;

    const label = cells.eq(0).text().replace(/ /g, ' ').trim();
    const range = parsePesterzsebetTimeRange(label);
    // A fejlécsor („", „0.pálya", …) és a lábjegyzetek itt esnek ki.
    if (!range) continue;

    const slots = expandRow($, $(row) as cheerio.Cheerio<never>);
    if (slots.length !== page.lanes) {
      ctx.warn(
        `${page.label}: a(z) ${label} sor ${slots.length} pályára bomlott ki, ` +
          `${page.lanes}-t vártunk — a sort kihagytuk, nehogy rossz sávszámot mutassunk.`,
      );
      continue;
    }

    const busy = slots.filter((slot) => slot !== '');
    if (busy.length === 0) continue;

    const labels = [...new Set(busy)];
    out.push({
      start: range.start,
      end: range.end,
      occupied: busy.length,
      reason: labels.join(', '),
      kind: classifyPesterzsebetCell(labels.join(' ')),
    });
  }

  return out;
}

/**
 * Sorokból blokkok: az egymást követő, azonos foglaltságú órákat összevonjuk.
 * Ha a forrás egymásba lógó idősávokat ad (a csütörtöki tanmedencében például
 * a „8.15-9.15" után „9.00-10.00" következik), az előző blokk végét levágjuk a
 * következő kezdetére — a rács sorrendjét tekintjük mérvadónak.
 */
function toBlocks(
  rows: RowOccupancy[],
  weekday: Weekday,
  page: BasinPage,
  ctx: ParseContext,
): LaneBlock[] {
  const blocks: LaneBlock[] = [];

  for (const row of rows) {
    const previous = blocks[blocks.length - 1];

    if (previous && previous.end > row.start) {
      ctx.warn(
        `${page.label}: átfedő idősávok (${previous.start}–${previous.end} és ` +
          `${row.start}–${row.end}) — az előzőt ${row.start}-ig vágtuk.`,
      );
      previous.end = row.start;
      if (previous.end <= previous.start) blocks.pop();
    }

    const last = blocks[blocks.length - 1];
    if (
      last &&
      last.end === row.start &&
      last.lanesOccupied === row.occupied &&
      last.reason === row.reason
    ) {
      last.end = row.end;
      continue;
    }

    blocks.push({
      poolId: POOL_ID,
      basinId: page.basinId,
      weekday,
      start: row.start,
      end: row.end,
      lanesOccupied: row.occupied,
      kind: row.kind,
      reason: row.reason,
    });
  }

  return blocks;
}

/** Egy medence aloldala → sávfoglalások. */
export function parsePesterzsebetPage(
  html: string,
  page: BasinPage,
  ctx: ParseContext,
): LaneBlock[] {
  const $ = cheerio.load(html);
  const blocks: LaneBlock[] = [];
  const seen = new Set<Weekday>();

  $('table').each((_, table) => {
    const node = $(table) as unknown as cheerio.Cheerio<never>;
    const rows = readTable($, node, page, ctx);
    if (rows.length === 0) return;

    const weekday = dayBeforeTable($, node);
    if (weekday === null) {
      ctx.warn(`${page.label}: találtam beosztás-táblázatot, de nem tudtam melyik naphoz tartozik — kihagytuk.`);
      return;
    }
    if (seen.has(weekday)) {
      ctx.warn(`${page.label}: ${weekday}. naphoz két táblázat is tartozik — a másodikat kihagytuk.`);
      return;
    }
    seen.add(weekday);

    blocks.push(...toBlocks(rows, weekday, page, ctx));
  });

  if (seen.size === 0) {
    throw new Error(
      `${page.label}: egyetlen napi beosztás-táblázatot sem sikerült elolvasni (${page.url}). ` +
        'Valószínűleg átalakult az oldal.',
    );
  }

  return blocks;
}

export function parsePesterzsebet(raw: RawSource, ctx: ParseContext): LaneBlock[] {
  let envelope: Envelope;
  try {
    envelope = JSON.parse(asText(raw)) as Envelope;
  } catch (error) {
    throw new Error(`Pesterzsébeti Uszoda: értelmezhetetlen boríték (${(error as Error).message}).`);
  }

  const blocks: LaneBlock[] = [];
  for (const entry of envelope.pages ?? []) {
    const page = PAGES.find((candidate) => candidate.basinId === entry.basinId);
    if (!page) {
      ctx.warn(`Ismeretlen medence a borítékban: ${entry.basinId} — kihagytuk.`);
      continue;
    }
    blocks.push(...parsePesterzsebetPage(entry.html, page, ctx));
  }

  if (blocks.length === 0) {
    throw new Error(
      'Pesterzsébeti Uszoda: a táblázatokat elolvastam, de egyetlen foglalást sem adtak. ' +
        'Ez gyanús — a beosztás sosem teljesen üres.',
    );
  }

  return blocks;
}

export const pesterzsebetiAdapter: Adapter = {
  id: 'pesterzsebeti-savbeosztas',
  poolId: POOL_ID,
  sourceUrl: 'https://www.pesterzsebetiuszoda.hu/savbeosztas/',
  description:
    'Pesterzsébeti Uszoda — a mélyvizes medence napi sávbeosztás-táblázatai (HTML).',
  async fetch(): Promise<RawSource> {
    const pages: Envelope['pages'] = [];
    for (const page of PAGES) {
      const source = await fetchRaw(page.url);
      pages.push({ basinId: page.basinId, url: source.url, html: asText(source) });
    }

    return {
      url: 'https://www.pesterzsebetiuszoda.hu/savbeosztas/',
      contentType: 'application/json',
      body: Buffer.from(JSON.stringify({ pages } satisfies Envelope), 'utf8'),
      fetchedAt: new Date().toISOString(),
      fromCache: false,
    };
  },
  parse: parsePesterzsebet,
};

registerAdapter(pesterzsebetiAdapter);
