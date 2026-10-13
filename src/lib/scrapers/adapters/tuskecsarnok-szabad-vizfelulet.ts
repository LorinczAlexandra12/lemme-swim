/**
 * Tüskecsarnok Sportuszoda — „Lakossági szabad vízfelületek" heti blokk.
 *
 * A MÁSODIK (és utolsó) olyan forrás, ami HTML-ben, gépi olvasásra alkalmas
 * formában közli a sávhelyzetet. Nem `<table>`, hanem `<div>`/`<span>`
 * szövegsorok, de a mondatszerkezet hétről hétre azonos:
 *
 *   Lakossági szabad vízfelületek 2026.09.21-09.27. között:
 *   Hétfőtől Péntekig
 *   Tanmedence:
 *   – hétfő: 6:00-11:00 és 13:00-16:00 / 4 sáv (11:00-13:00 nincs szabad sáv)
 *   – kedd: 6:00-11:00 3 sáv és 14:00-16:00 / 4 sáv (11:00-14:00 nincs szabad sáv)
 *   …
 *   Szombaton és Vasárnap
 *   Tanmedence:
 *   – 6:00-17:30 / 4 sáv
 *
 * FONTOS MODELLEZÉSI DÖNTÉS. A forrás a SZABAD (lakossági) sávokat sorolja
 * fel, az adatmodellünk viszont a FOGLALT sávokat tárolja. Az átváltás:
 *
 *   foglalt = a medence összes sávja − a közölt szabad sávok száma
 *
 * Ezért CSAK azt írjuk ki blokként, amit a forrás KIMOND:
 *   a) ha egy sávablakban a szabad sávok száma kevesebb a medence összesénél
 *      (pl. tanmedence kedd 6:00–11:00: „3 sáv" a négyből) → 1 sáv foglalt;
 *   b) ha a forrás zárójelben kimondja, hogy „nincs szabad sáv" → minden sáv
 *      foglalt az adott időszakban.
 *
 * AMIT NEM TESZÜNK: nem következtetünk a fel nem sorolt időszakokra. A
 * versenymedencénél például a hétköznapi lista csak 8:00–14:00-ig tart, és az
 * oldal külön kiköti, hogy „az uszoda nyitvatartása kizárólag a 25 m-es
 * kismedencére vonatkozik", tehát a 6:00–8:00 és 14:00–16:00 közti
 * versenymedence-állapotról a forrás EGYSZERŰEN NEM NYILATKOZIK. Ilyenkor
 * figyelmeztetést adunk, de nem találunk ki foglalást.
 *
 * A blokkok DÁTUMOZOTTAK, nem heti ismétlődők: a forrás maga is konkrét hétre
 * érvényes („2026.09.21-09.27. között"), így a régi adat nem ragad bent.
 */

import * as cheerio from 'cheerio';
import type { LaneBlock } from '../../types';
import { asText, fetchRaw } from '../http';
import { registerAdapter, type Adapter, type ParseContext, type RawSource } from '../types';

const POOL_ID = 'tuskecsarnok-sportuszoda';
const SOURCE_URL = 'https://tuskecsarnok.hu/sportuszoda/';

/**
 * A medencék sávszáma a `data/pools.json` szerint. Azért kell konstansként,
 * mert a „foglalt = összes − szabad" átváltáshoz az összes sávszám kell, és
 * azt a forrásszöveg nem mondja ki (csak a szabadok számát).
 */
const BASINS: Record<string, { basinId: string; lanes: number }> = {
  tanmedence: { basinId: 'tanmedence', lanes: 4 },
  versenymedence: { basinId: 'versenymedence-50m', lanes: 10 },
};

const WEEKDAY_NAMES = ['hétfő', 'kedd', 'szerda', 'csütörtök', 'péntek', 'szombat', 'vasárnap'];

interface Window {
  start: string;
  end: string;
  freeLanes: number;
}

function pad(time: string): string {
  const [hour, minute] = time.split(':');
  return `${hour.padStart(2, '0')}:${minute}`;
}

/**
 * Egy sor szabad-sáv ablakainak kiolvasása.
 *
 * A sorban időtartamok és „N sáv" darabok váltakoznak, és a sávszám a MÖGÖTTE
 * álló időtartam(ok)ra vonatkozik visszafelé:
 *   „6:00-11:00 3 sáv és 14:00-16:00 / 4 sáv"  →  6–11: 3 sáv, 14–16: 4 sáv
 *   „6:00-11:00 és 13:00-16:00 / 4 sáv"        →  mindkettő 4 sáv
 */
export function parseFreeWindows(text: string): Window[] {
  const token = /(\d{1,2}:\d{2})\s*[-–—]\s*(\d{1,2}:\d{2})|(\d+)\s*sáv/g;
  const windows: Window[] = [];
  let pending: { start: string; end: string }[] = [];
  let lastCount: number | null = null;

  for (let match = token.exec(text); match !== null; match = token.exec(text)) {
    if (match[1] !== undefined) {
      pending.push({ start: pad(match[1]), end: pad(match[2]) });
    } else {
      const count = Number(match[3]);
      lastCount = count;
      for (const range of pending) windows.push({ ...range, freeLanes: count });
      pending = [];
    }
  }
  // A sávszám nélkül maradt ablakok a sorban utoljára látott értéket öröklik.
  if (pending.length > 0 && lastCount !== null) {
    for (const range of pending) windows.push({ ...range, freeLanes: lastCount });
  }

  return windows.filter((window) => window.start < window.end);
}

/** A zárójeles „(11:00-13:00 nincs szabad sáv)" kivételek. */
export function parseNoFreeWindows(text: string): { start: string; end: string }[] {
  const result: { start: string; end: string }[] = [];
  const parens = text.match(/\([^)]*\)/g) ?? [];
  for (const group of parens) {
    if (!/nincs\s+szabad/i.test(group)) continue;
    const ranges = group.matchAll(/(\d{1,2}:\d{2})\s*[-–—]\s*(\d{1,2}:\d{2})/g);
    for (const range of ranges) {
      const start = pad(range[1]);
      const end = pad(range[2]);
      if (start < end) result.push({ start, end });
    }
  }
  return result;
}

/** „2026.09.21-09.27. között" → a hét hétfői dátuma. */
export function parseWeekStart(text: string): Date | null {
  const match = text.match(/(\d{4})\.(\d{2})\.(\d{2})\s*[-–—]/);
  if (!match) return null;
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

/**
 * A HTML szöveggé lapítása. A tageket ELŐBB töröljük, és csak utána
 * normalizáljuk a szóközöket: a forrásban a számok közepén is van tag- és
 * sortöréshatár (pl. `8:<span …>00-14:00`), amit különben elrontanánk.
 */
function flatten(html: string): string[] {
  const $ = cheerio.load(html);
  $('script, style').remove();
  const text = $.root()
    .text()
    .replace(/ /g, ' ')
    .replace(/[ \t]*\n[ \t]*/g, '\n');
  return text
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line !== '');
}

export function parseTuskecsarnok(raw: RawSource, ctx: ParseContext): LaneBlock[] {
  const lines = flatten(asText(raw));

  const headingIndex = lines.findIndex((line) => /lakossági szabad vízfelület/i.test(line));
  if (headingIndex < 0) {
    throw new Error('Nincs „Lakossági szabad vízfelületek" szakasz az oldalon — megváltozott a tartalom.');
  }

  const weekStart = parseWeekStart(lines[headingIndex]);
  if (!weekStart) {
    throw new Error(`A hét dátumtartománya nem olvasható ki: ${JSON.stringify(lines[headingIndex])}`);
  }

  const dates = Array.from({ length: 7 }, (_, index) =>
    new Date(weekStart.getTime() + index * 86_400_000).toISOString().slice(0, 10),
  );

  const blocks: LaneBlock[] = [];
  let basin: { basinId: string; lanes: number } | null = null;
  let basinLabel = '';
  let weekendSection = false;
  let rowCount = 0;

  for (const line of lines.slice(headingIndex + 1, headingIndex + 40)) {
    if (/^hétfőtől\s+péntekig/i.test(line)) {
      weekendSection = false;
      continue;
    }
    if (/^szombaton\s+és\s+vasárnap/i.test(line)) {
      weekendSection = true;
      continue;
    }

    const basinMatch = line.match(/^(tanmedence|versenymedence)\s*:?\s*$/i);
    if (basinMatch) {
      basinLabel = basinMatch[1].toLowerCase();
      basin = BASINS[basinLabel];
      if (!basin) ctx.warn(`Ismeretlen medence a forrásban: ${JSON.stringify(line)}`);
      continue;
    }

    // Csak a listajelöléssel kezdődő sorok érdekelnek.
    if (!/^[–—-]\s/.test(line)) continue;
    if (!basin) {
      ctx.warn(`Medencefejléc nélküli felsorolássor, kihagyva: ${JSON.stringify(line)}`);
      continue;
    }

    // Melyik napokra vonatkozik?
    let weekdayIndexes: number[];
    const dayMatch = line.match(/^[–—-]\s*([a-záéíóöőúüű]+)\s*:/i);
    if (weekendSection) {
      weekdayIndexes = [5, 6];
    } else if (dayMatch && WEEKDAY_NAMES.includes(dayMatch[1].toLowerCase())) {
      weekdayIndexes = [WEEKDAY_NAMES.indexOf(dayMatch[1].toLowerCase())];
    } else {
      ctx.warn(`Nem azonosítható a nap ebben a sorban: ${JSON.stringify(line)}`);
      continue;
    }

    rowCount += 1;

    const mainPart = line.replace(/\([^)]*\)/g, ' ');
    const freeWindows = parseFreeWindows(mainPart);
    const closedWindows = parseNoFreeWindows(line);

    if (freeWindows.length === 0) {
      ctx.warn(`Nem olvasható szabad sávablak ebből a sorból: ${JSON.stringify(line)}`);
      continue;
    }

    for (const weekdayIndex of weekdayIndexes) {
      const date = dates[weekdayIndex];

      // a) részlegesen szabad ablakok → a hiányzó sávok foglaltak
      for (const window of freeWindows) {
        if (window.freeLanes > basin.lanes) {
          ctx.warn(
            `${WEEKDAY_NAMES[weekdayIndex]} ${basinLabel} ${window.start}: ${window.freeLanes} szabad sáv, ` +
              `de a medencének csak ${basin.lanes} van — ellenőrizd a pools.json sávszámát.`,
          );
          continue;
        }
        const occupied = basin.lanes - window.freeLanes;
        if (occupied <= 0) continue;
        blocks.push({
          poolId: POOL_ID,
          basinId: basin.basinId,
          date,
          start: window.start,
          end: window.end,
          lanesOccupied: occupied,
          kind: 'club',
          reason: `A Tüskecsarnok közlése szerint ebben az időszakban csak ${window.freeLanes} sáv lakossági`,
        });
      }

      // b) kimondott „nincs szabad sáv" időszakok → minden sáv foglalt
      for (const window of closedWindows) {
        blocks.push({
          poolId: POOL_ID,
          basinId: basin.basinId,
          date,
          start: window.start,
          end: window.end,
          lanesOccupied: basin.lanes,
          kind: 'club',
          reason: 'A Tüskecsarnok közlése szerint ebben az időszakban nincs szabad sáv',
        });
      }
    }
  }

  if (rowCount === 0) {
    throw new Error('A „Lakossági szabad vízfelületek" szakaszban egyetlen értelmezhető felsorolássor sincs.');
  }

  ctx.warn(
    'A forrás a SZABAD lakossági sávokat sorolja fel, a foglaltságot ebből számoltuk vissza. ' +
      'A fel nem sorolt időszakokról (pl. a versenymedence hétköznap 14:00 után) a forrás nem nyilatkozik, ' +
      'ezekre szándékosan nem keletkezik blokk.',
  );

  // Átfedés-ellenőrzés: a motor az azonos medencére eső átfedő blokkokat
  // ÖSSZEADJA, ezért a duplázás itt valódi hiba lenne.
  for (const [basinId, group] of Object.entries(
    blocks.reduce<Record<string, LaneBlock[]>>((acc, block) => {
      const key = `${block.basinId}|${block.date}`;
      (acc[key] ??= []).push(block);
      return acc;
    }, {}),
  )) {
    const sorted = [...group].sort((a, b) => a.start.localeCompare(b.start));
    for (let i = 1; i < sorted.length; i += 1) {
      if (sorted[i - 1].end > sorted[i].start) {
        ctx.warn(
          `${basinId}: átfedő blokkok (${sorted[i - 1].start}–${sorted[i - 1].end} és ` +
            `${sorted[i].start}–${sorted[i].end}) — a foglalt sávok duplán vonódnának le.`,
        );
      }
    }
  }

  return blocks;
}

export const tuskecsarnokAdapter: Adapter = {
  id: 'tuskecsarnok-szabad-vizfelulet',
  poolId: POOL_ID,
  sourceUrl: SOURCE_URL,
  description:
    'Tüskecsarnok „Lakossági szabad vízfelületek" heti szövegblokkja (HTML); a szabad sávokból visszaszámolt foglaltság.',

  async fetch(): Promise<RawSource> {
    return fetchRaw(SOURCE_URL);
  },

  parse(raw, ctx) {
    return parseTuskecsarnok(raw, ctx);
  },
};

registerAdapter(tuskecsarnokAdapter);
