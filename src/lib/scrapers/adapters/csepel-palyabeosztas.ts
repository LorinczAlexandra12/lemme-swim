/**
 * Csepeli Strandfürdő — szezonális pályabeosztás (PDF).
 *
 * A `https://www.csepelistrandfurdo.hu/palyabeosztas/` oldal egyetlen PDF-et
 * linkel, és a fájlnév a szezont hordozza
 * (`Palyabeosztas-2025-26-osz-tel-.pdf`), ezért a linket MINDIG az oldalról
 * szedjük ki, sosem drótozzuk be.
 *
 * A PDF EGY oldal, álló tájolás, egymás ALATT hét napblokkal (hétfő…vasárnap).
 * Minden napblokk:
 *   – fejlécsor: óránkénti idősávok „06.00-07.00" … „19.00-20.00" (PONT a
 *     kettőspont helyett!), a szöveg x-koordinátája adja az oszlopot;
 *   – hét sor, bal szélen az „1"…„7" sávszámmal (x ≈ 253).
 *
 * A FOGLALTSÁG ITT IS CSAK A CELLA KITÖLTŐSZÍNÉBEN VAN, a szövegrétegben nem.
 * Ezért a kitöltött téglalapokat szedjük ki, és minden (nap, óra, sáv) ponton
 * megnézzük, esik-e rá színes cella:
 *
 *   színes cella  → az a sáv FOGLALT (valamelyik egyesületé),
 *   üres (fehér)  → az a sáv a közönségé.
 *
 * Ez a szabály szándékosan nem függ attól, hogy melyik szín melyik egyesület:
 * a jelmagyarázat egy részét subset-fonttal szedték, így a klubnevek egy része
 * a szövegrétegből nem olvasható ki. Amit ki tudunk olvasni, azt a `reason`
 * mezőben megnevezzük, a többinél általános indoklást adunk — KITALÁLNI NEM
 * TALÁLUNK KI KLUBNEVET.
 *
 * A beosztás egész szezonra szól, ezért HETI ISMÉTLŐDŐ (`weekday`) blokkokat
 * adunk vissza, nem dátumozottakat.
 */

import type { LaneBlock, Weekday } from '../../types';
import { asText, fetchRaw } from '../http';
import { extractPages, rectAt, type PdfFilledRect } from '../pdf';
import { registerAdapter, type Adapter, type ParseContext, type RawSource } from '../types';

const POOL_ID = 'csepeli-strandfurdo';
const BASIN_ID = '50m-uszomedence';
const INDEX_URL = 'https://www.csepelistrandfurdo.hu/palyabeosztas/';

/** A sávszámok (1–7) bal oldali oszlopának x-koordinátája a PDF-ben. */
const LANE_LABEL_X = 253;
const LANE_COUNT = 7;

const WEEKDAY_NAMES = ['hétfő', 'kedd', 'szerda', 'csütörtök', 'péntek', 'szombat', 'vasárnap'];

/** „06.00-07.00" → `{ start: '06:00', end: '07:00' }`. */
export function parseCsepelHourRange(label: string): { start: string; end: string } | null {
  const match = label.match(/^(\d{1,2})[.:](\d{2})\s*[-–]\s*(\d{1,2})[.:](\d{2})$/);
  if (!match) return null;
  const start = `${match[1].padStart(2, '0')}:${match[2]}`;
  const end = `${match[3].padStart(2, '0')}:${match[4]}`;
  return start < end ? { start, end } : null;
}

function isBlack(color: readonly number[]): boolean {
  return color[0] === 0 && color[1] === 0 && color[2] === 0;
}

export function parseCsepelPdf(raw: RawSource, ctx: ParseContext): LaneBlock[] {
  const pages = extractPages(raw.body);
  if (pages.length !== 1) {
    ctx.warn(`${pages.length} oldalas PDF jött, egyet vártunk — csak az elsőt dolgozzuk fel.`);
  }
  const page = pages[0];
  if (!page) throw new Error('A letöltött PDF-ből egyetlen oldalt sem sikerült kiolvasni.');

  // --- Jelmagyarázat és rácscellák szétválasztása --------------------------
  //
  // A jelmagyarázat kilenc színmintája a lap tetején, egy sorban ül. A fekete
  // téglalapok a rácsvonalak (1 pont vastagok), azok sem cellák.
  const legendY = Math.max(...page.rects.filter((rect) => rect.height > 40).map((rect) => rect.y), -1);
  const cells: PdfFilledRect[] = page.rects.filter(
    (rect) => !isBlack(rect.color) && rect.width > 20 && rect.height > 10 && rect.y < legendY,
  );
  if (cells.length === 0) {
    throw new Error('Egyetlen színes cellát sem találtunk a PDF-ben — megváltozott a beosztás formátuma.');
  }

  const legendSwatches = page.rects.filter((rect) => rect.height > 40 && !isBlack(rect.color));
  const legend = new Map<string, string>();
  for (const swatch of legendSwatches) {
    const label = page.texts
      .filter((text) => text.x >= swatch.x && text.x <= swatch.x + swatch.width + 60 && text.y > swatch.y - 10)
      .sort((a, b) => a.x - b.x)[0];
    // A subset-fontos (`#00xx…`) és az egykarakteres helykitöltő feliratokat eldobjuk.
    const name = label?.text.replace(/\s+/g, ' ').trim() ?? '';
    if (name !== '' && !name.includes('#') && name.length > 2) {
      legend.set(colorKey(swatch.color), name);
    }
  }

  // --- Napblokkok ----------------------------------------------------------

  const laneLabels = page.texts
    .filter((text) => Math.abs(text.x - LANE_LABEL_X) < 6 && /^[1-9]$/.test(text.text.trim()))
    .sort((a, b) => b.y - a.y);

  if (laneLabels.length !== LANE_COUNT * 7) {
    throw new Error(
      `${laneLabels.length} sávfeliratot találtunk, de ${LANE_COUNT * 7}-et vártunk (7 nap × ${LANE_COUNT} sáv).`,
    );
  }

  const hourTexts = page.texts.filter((text) => parseCsepelHourRange(text.text.trim()) !== null);

  const blocks: LaneBlock[] = [];

  for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
    const lanes = laneLabels.slice(dayIndex * LANE_COUNT, dayIndex * LANE_COUNT + LANE_COUNT);
    const weekday = (dayIndex + 1) as Weekday;
    const dayName = WEEKDAY_NAMES[dayIndex];

    // A napblokk fejlécsora közvetlenül a legfelső sáv FÖLÖTT van.
    const headerY = Math.min(
      ...hourTexts.filter((text) => text.y > lanes[0].y).map((text) => text.y),
      Number.POSITIVE_INFINITY,
    );
    if (!Number.isFinite(headerY)) {
      ctx.warn(`${dayName}: nem találtuk meg az idősáv-fejlécet, a nap kimarad.`);
      continue;
    }

    const columns = hourTexts
      .filter((text) => Math.abs(text.y - headerY) < 4)
      .map((text) => ({ x: text.x, range: parseCsepelHourRange(text.text.trim())! }))
      .sort((a, b) => a.x - b.x);

    if (columns.length === 0) {
      ctx.warn(`${dayName}: üres fejlécsor, a nap kimarad.`);
      continue;
    }

    // A napnevet ellenőrizzük, ha olvasható (a PDF egy részét subset-fonttal szedték).
    const nameText = page.texts.find(
      (text) => text.x < LANE_LABEL_X - 20 && Math.abs(text.y - headerY) < 40 && !text.text.includes('#'),
    );
    if (nameText && nameText.text.trim().toLowerCase() !== dayName) {
      ctx.warn(`A(z) ${dayIndex + 1}. napblokk felirata ${JSON.stringify(nameText.text.trim())}, de ${dayName} lenne.`);
    }

    // --- Óránkénti foglaltság ---------------------------------------------

    const hourly = columns.map((column) => {
      const occupants: string[] = [];
      for (const lane of lanes) {
        const hit = rectAt(cells, column.x + 20, lane.y + 4);
        if (hit) occupants.push(legend.get(colorKey(hit.color)) ?? '');
      }
      return { range: column.range, occupied: occupants.length, names: occupants.filter((name) => name !== '') };
    });

    // --- Azonos foglaltságú, egymást követő órák összevonása ---------------

    let index = 0;
    while (index < hourly.length) {
      const current = hourly[index];
      if (current.occupied === 0) {
        index += 1;
        continue;
      }
      let last = index;
      while (
        last + 1 < hourly.length &&
        hourly[last + 1].occupied === current.occupied &&
        hourly[last + 1].range.start === hourly[last].range.end &&
        sameNames(hourly[last + 1].names, current.names)
      ) {
        last += 1;
      }

      // A jelmagyarázat egy részét subset-fonttal szedték, így nem minden
      // szín klubnevét tudjuk kiolvasni. Ha csak egy részüket ismerjük, azt
      // „köztük" szóval jelezzük — nem állítjuk, hogy övék az összes sáv.
      const names = [...new Set(current.names)];
      let reason = 'Foglalt sáv a csepeli pályabeosztás szerint';
      if (names.length > 0 && current.names.length === current.occupied && names.length === 1) {
        reason = `${names[0]} (csepeli pályabeosztás)`;
      } else if (names.length > 0) {
        reason = `Foglalt sávok a csepeli pályabeosztás szerint (köztük: ${names.join(', ')})`;
      }

      blocks.push({
        poolId: POOL_ID,
        basinId: BASIN_ID,
        weekday,
        start: current.range.start,
        end: hourly[last].range.end,
        lanesOccupied: current.occupied,
        kind: 'club',
        reason,
      });
      index = last + 1;
    }
  }

  if (blocks.length === 0) {
    throw new Error('A PDF-ből egyetlen foglalás sem jött ki — valószínűleg megváltozott a rács elrendezése.');
  }

  return blocks;
}

function colorKey(color: readonly number[]): string {
  return color.map((channel) => channel.toFixed(2)).join(',');
}

function sameNames(a: string[], b: string[]): boolean {
  const left = [...new Set(a)].sort().join('|');
  const right = [...new Set(b)].sort().join('|');
  return left === right;
}

export const csepelPalyabeosztasAdapter: Adapter = {
  id: 'csepel-palyabeosztas',
  poolId: POOL_ID,
  sourceUrl: INDEX_URL,
  description: 'Csepeli Strandfürdő szezonális pályabeosztása (PDF, a cellák kitöltőszíne kódolja a foglaltságot).',

  async fetch(): Promise<RawSource> {
    const index = await fetchRaw(INDEX_URL);
    const html = asText(index);
    const match = html.match(/href\s*=\s*["']([^"']*[Pp][aá]lyabeosztas[^"']*\.pdf)["']/);
    if (!match) {
      throw new Error(`Nincs pályabeosztás-PDF link a(z) ${INDEX_URL} oldalon — átalakult az oldal.`);
    }
    const pdfUrl = new URL(match[1], index.url).toString();
    const pdf = await fetchRaw(pdfUrl);
    if (pdf.body.subarray(0, 4).toString('latin1') !== '%PDF') {
      throw new Error(`A(z) ${pdfUrl} címen nem PDF érkezett.`);
    }
    return pdf;
  },

  parse(raw, ctx) {
    return parseCsepelPdf(raw, ctx);
  },
};

registerAdapter(csepelPalyabeosztasAdapter);
