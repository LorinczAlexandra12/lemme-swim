/**
 * Újhegyi Uszoda és Strandfürdő (Kőbánya) — „Aktuális pályabeosztás” PDF.
 *
 * EZ AZ EGYETLEN OLYAN BUDAPESTI FORRÁS, amelyet a kutatás során GÉPILEG
 * értelmezhetőnek találtunk: Excelből exportált, hétköznaponként egy oldalas
 * rács, amelynek VAN szövegrétege (órasávok és pályaszámok), a foglaltságot
 * pedig a cellák kitöltőszíne hordozza (borostyán = FOGLALT, zöld = SZABAD).
 *
 * A PDF fájlneve dátumbélyeges (`aktualis_palyabeosztas_ÉÉÉÉHHNN.pdf`), ezért
 * SOHA nem drótozzuk be: minden futáskor a létesítmény-oldalról olvassuk ki
 * a hivatkozást.
 *
 * Oszlopok: I.–VI. = a 25 m-es belső úszómedence hat sávja, utána két
 * „1/2 tanm.” oszlop = a tanmedence bal és jobb fele. A tanmedence felei NEM
 * úszósávok, ezért azokat szándékosan nem alakítjuk `LaneBlock`-ká.
 */

import type { LaneBlock, Weekday } from '../../types';
import { asText, fetchRaw } from '../http';
import { colorMatches, extractPages, rectAt, type PdfPage } from '../pdf';
import { registerAdapter, type Adapter, type ParseContext, type RawSource } from '../types';

const POOL_ID = 'ujhegyi-uszoda';
/** A 25 m-es belső úszómedence azonosítója a `data/pools.json`-ban. */
const BASIN_ID = 'belso-uszomedence';

const INDEX_URL = 'https://www.kobanyasport.hu/letesitmenyek.htm';

/** A jelmagyarázat két színe, a PDF nyers RGB-értékeivel. */
const COLOR_FREE: [number, number, number] = [0, 0.69, 0.314]; // SZABAD
const COLOR_BUSY: [number, number, number] = [1, 0.753, 0]; // FOGLALT

/** A hat sáv fejléce a rácsban. */
const LANE_HEADERS = ['I.', 'II.', 'III.', 'IV.', 'V.', 'VI.'];

const WEEKDAY_NAMES: Record<string, Weekday> = {
  hétfő: 1,
  kedd: 2,
  szerda: 3,
  csütörtök: 4,
  péntek: 5,
  szombat: 6,
  vasárnap: 7,
};

// ---------------------------------------------------------------------------
// Órasáv-feliratok
// ---------------------------------------------------------------------------

/**
 * A sorfeliratok tipográfiája következetlen: „6. - 7 .”, „7. - 830”,
 * „17. - 18.30”, „20. - 21.00”. Ezért csak a SZÁMJEGYEKRE támaszkodunk:
 * kettőnél több számjegy esetén az utolsó kettő a perc.
 */
function parseClock(part: string): string | null {
  const digits = part.replace(/\D/g, '');
  if (digits === '') return null;
  const hour = digits.length <= 2 ? Number(digits) : Number(digits.slice(0, -2));
  const minute = digits.length <= 2 ? 0 : Number(digits.slice(-2));
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null;
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) return null;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export function parseHourRange(label: string): { start: string; end: string } | null {
  const parts = label.split(/[–-]/);
  if (parts.length < 2) return null;
  const start = parseClock(parts[0]);
  const end = parseClock(parts.slice(1).join('-'));
  if (!start || !end || start >= end) return null;
  return { start, end };
}

// ---------------------------------------------------------------------------
// Egy oldal (= egy hétköznap) feldolgozása
// ---------------------------------------------------------------------------

interface RowOccupancy {
  start: string;
  end: string;
  occupied: number;
}

function readPage(page: PdfPage, weekday: Weekday, ctx: ParseContext): RowOccupancy[] {
  const dayLabel = `${weekday}. nap (PDF ${page.index + 1}. oldal)`;

  // A sáv-fejlécek x-koordinátája egyben a cellák mintavételi pontja is:
  // a fejlécszöveg a saját oszlopán belül van.
  const laneColumns = LANE_HEADERS.map((header) => {
    const item = page.texts.find((text) => text.text.trim() === header);
    return item ? { header, x: item.x + 2 } : null;
  });

  const missing = laneColumns.filter((column) => column === null).length;
  if (missing > 0) {
    throw new Error(
      `${dayLabel}: a hat sáv-fejlécből ${missing} nem található a PDF szövegrétegében — megváltozott a rács.`,
    );
  }
  const columns = laneColumns as { header: string; x: number }[];

  // Sorfeliratok: a rács bal szélén álló órasávok, fentről lefelé = időrendben.
  const headerY = page.texts.find((text) => text.text.trim() === 'I.')?.y ?? Infinity;

  // Egy felirat több szövegdarabból is állhat (a vasárnapi oldalon például a
  // „9.” és a „ - 10. ” külön elem) — az azonos alapvonalon állókat összefűzzük.
  const fragments = page.texts
    .filter((text) => text.x < 96 && text.y < headerY)
    .sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: { y: number; raw: string }[] = [];
  for (const fragment of fragments) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(last.y - fragment.y) <= 3) last.raw += fragment.text;
    else lines.push({ y: fragment.y, raw: fragment.text });
  }

  const rawRows = lines
    .filter((line) => /\d\s*\.?\s*[–-]/.test(line.raw))
    .map((line) => ({ y: line.y, range: parseHourRange(line.raw), raw: line.raw }))
    // A tördelt feliratok (pl. külön sorba csúszott „30”) ugyanahhoz a rácssorhoz
    // tartoznak — az első felirat nyer.
    .filter((row, index, all) => index === 0 || Math.abs(all[index - 1].y - row.y) > 8);

  // A rács sormagassága egyenletes, a FELIRATOK viszont hibásak is lehetnek
  // (a szombati oldalon például „17. - 18.30” áll a 17–18 órás sor mellett).
  // Ezért egy sor VÉGÉT a KÖVETKEZŐ sor kezdetéből vezetjük le, és csak az
  // utolsó sornál hisszük el a feliratban szereplő záró időpontot. Így elvileg
  // sem keletkezhet átfedő blokk, ami a motorban duplán vonná le a sávokat.
  const rowLabels = rawRows.map((row, index) => {
    const next = rawRows[index + 1];
    const start = row.range?.start ?? null;
    const printedEnd = row.range?.end ?? null;
    const end = next?.range?.start ?? printedEnd;
    if (start !== null && printedEnd !== null && end !== null && printedEnd !== end) {
      ctx.warn(
        `${dayLabel}: a(z) ${JSON.stringify(row.raw)} felirat ${printedEnd}-ra végződne, de a rács következő sora ${end}-kor kezdődik — a rácsot követjük.`,
      );
    }
    return { y: row.y, raw: row.raw, range: start !== null && end !== null && start < end ? { start, end } : null };
  });

  const rows: RowOccupancy[] = [];
  for (const row of rowLabels) {
    if (!row.range) {
      ctx.warn(`${dayLabel}: értelmezhetetlen órasáv-felirat: ${JSON.stringify(row.raw)}`);
      continue;
    }

    // A felirat alapvonala a cella alján van; 5 ponttal feljebb biztosan a cellában vagyunk.
    const sampleY = row.y + 5;
    let occupied = 0;
    for (const column of columns) {
      const cell = rectAt(page.rects, column.x, sampleY);
      if (cell && colorMatches(cell.color, COLOR_BUSY)) {
        occupied += 1;
      } else if (cell && colorMatches(cell.color, COLOR_FREE)) {
        // szabad — nincs teendő
      } else {
        // ÓVATOSSÁGBÓL foglaltnak vesszük: soha nem ígérünk olyan sávot,
        // amelyről nem tudjuk biztosan, hogy szabad. A figyelmeztetés viszont
        // kötelező, mert ez a formátumváltozás első jele.
        occupied += 1;
        ctx.warn(
          `${dayLabel} ${row.range.start}–${row.range.end} ${column.header}: ismeretlen cellaszín (${
            cell ? cell.color.map((c) => c.toFixed(2)).join(',') : 'nincs kitöltés'
          }), óvatosságból foglaltnak vettük.`,
        );
      }
    }
    rows.push({ start: row.range.start, end: row.range.end, occupied });
  }

  if (rows.length === 0) {
    throw new Error(`${dayLabel}: egyetlen órasáv-feliratot sem találtunk.`);
  }
  return rows;
}

/** Az egymást követő, azonos foglaltságú sorok összevonása egyetlen blokká. */
function mergeRows(rows: RowOccupancy[]): RowOccupancy[] {
  const merged: RowOccupancy[] = [];
  for (const row of rows) {
    const previous = merged[merged.length - 1];
    if (previous && previous.end === row.start && previous.occupied === row.occupied) {
      previous.end = row.end;
    } else {
      merged.push({ ...row });
    }
  }
  return merged;
}

/** A PDF első oldalán szereplő, olvasható hétköznapnév — ellenőrzéshez. */
function readableWeekday(page: PdfPage): Weekday | null {
  for (const text of page.texts) {
    const name = text.text.trim().toLowerCase();
    if (name in WEEKDAY_NAMES) return WEEKDAY_NAMES[name];
  }
  return null;
}

// ---------------------------------------------------------------------------
// Az adapter
// ---------------------------------------------------------------------------

export function parseUjhegyiPdf(raw: RawSource, ctx: ParseContext): LaneBlock[] {
  const pages = extractPages(raw.body);
  if (pages.length !== 7) {
    throw new Error(`A pályabeosztás PDF-nek 7 oldalasnak kell lennie (naponta egy), de ${pages.length} oldala van.`);
  }

  ctx.warn(
    'A két „1/2 tanm.” oszlop a tanmedence két fele, nem úszósáv — ezeket szándékosan nem rögzítjük sávfoglalásként.',
  );

  const blocks: LaneBlock[] = [];
  pages.forEach((page, index) => {
    // Az oldalsorrend a hétköznap: a /Kids tömb hétfőtől vasárnapig halad.
    const weekday = (index + 1) as Weekday;
    const printed = readableWeekday(page);
    if (printed !== null && printed !== weekday) {
      ctx.warn(
        `A PDF ${index + 1}. oldalán „${Object.keys(WEEKDAY_NAMES)[printed - 1]}” szerepel, de az oldalsorrend szerint a ${weekday}. nap lenne.`,
      );
    }

    for (const row of mergeRows(readPage(page, weekday, ctx))) {
      if (row.occupied === 0) continue;
      blocks.push({
        poolId: POOL_ID,
        basinId: BASIN_ID,
        weekday,
        start: row.start,
        end: row.end,
        lanesOccupied: row.occupied,
        kind: 'club',
        // A PDF nem nevezi meg, ki foglalja a sávot — ezt nem találjuk ki.
        reason: 'Foglalt sáv a kőbányai pályabeosztás szerint',
      });
    }
  });

  return blocks;
}

export const ujhegyiPalyabeosztasAdapter: Adapter = {
  id: 'ujhegyi-palyabeosztas-pdf',
  poolId: POOL_ID,
  sourceUrl: INDEX_URL,
  description:
    'Az Újhegyi Uszoda heti pályabeosztása a kobanyasport.hu létesítmény-oldaláról linkelt, dátumbélyeges PDF-ből.',

  async fetch(): Promise<RawSource> {
    const index = await fetchRaw(INDEX_URL);
    const html = asText(index, 'latin1');
    const link = /href\s*=\s*["']([^"']*palyabeosztas[^"']*\.pdf)["']/i.exec(html);
    if (!link) {
      throw new Error(
        `A létesítmény-oldalon (${INDEX_URL}) nincs „pályabeosztás” PDF-hivatkozás — vagy elköltözött, vagy levették.`,
      );
    }
    const pdfUrl = new URL(link[1], index.url).toString();
    const pdf = await fetchRaw(pdfUrl);
    if (!pdf.body.subarray(0, 5).toString('latin1').startsWith('%PDF')) {
      throw new Error(`A letöltött fájl nem PDF: ${pdfUrl}`);
    }
    return pdf;
  },

  parse: parseUjhegyiPdf,
};

registerAdapter(ujhegyiPalyabeosztasAdapter);
