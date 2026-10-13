/**
 * TVE 1887 Sportuszoda — heti program (PDF).
 *
 * A `https://tve1887.hu/uszoda/` oldal minden héten új PDF-et linkel
 * `USZODA_HETI-PROGRAM-ÉÉÉÉ_HH_NN[_mod].pdf` néven, ezért a linket az oldalról
 * szedjük ki, és a LEGFRISSEBB dátumút választjuk (a régi, 2024-es fájl is
 * ott maradt az oldalon).
 *
 * A PDF egy oldal, egymás alatt hét napblokkal. Minden napblokk:
 *   – fejléc: fél órás idősávok 6:00-tól 22:30-ig (csak az első napnál van
 *     minden fél óra külön kiírva, a többinél csak az egész órák — a rács
 *     x-elrendezése viszont mind a hét napnál azonos, ezért az első nap
 *     fejlécét használjuk mestersablonként);
 *   – nyolc sor, bal szélen az „1."…„8." sávszámmal.
 *
 * A FOGLALTSÁG A CELLA KITÖLTŐSZÍNÉBEN VAN. A jelmagyarázat viszont KIOLVASHATÓ
 * a PDF-ből (a lap alján), csak részfonttal (subset font) szedték, ezért a
 * nyers szövegréteg `#002F0024…` alakú glifaazonosítókat ad. Az ASCII
 * tartományban a glifaazonosító + 29 adja a karakterkódot, így a jelmagyarázat
 * dekódolható:
 *
 *   piros        → ZÁRVA
 *   kék          → TVE EDZÉS
 *   sárga        → MÉRKŐZÉS
 *   borostyán    → BÉRLŐK
 *   világosszürke→ TÁMOGATÓK
 *   zöld         → LAKOSSÁG   ← EZ AZ EGYETLEN SZABAD KATEGÓRIA
 *
 * Ezért a szabály: minden nem zöld cella foglalt sávot jelent. Az ékezetes
 * betűk glifakiosztása fontonként eltér, ezért ha egy felirat nem olvasható ki
 * maradéktalanul, a jelmagyarázat kategóriáját írjuk a `reason`-be —
 * KLUBNEVET NEM TALÁLUNK KI.
 *
 * A PDF egy konkrét hétre szól (a napok dátumozva vannak), ezért DÁTUMOZOTT
 * blokkokat adunk vissza.
 */

import type { LaneBlock } from '../../types';
import { asText, fetchRaw } from '../http';
import { extractPages, rectAt, type PdfFilledRect } from '../pdf';
import { registerAdapter, type Adapter, type ParseContext, type RawSource } from '../types';

const POOL_ID = 'tve-sportuszoda';
const BASIN_ID = '21x285-medence';
const INDEX_URL = 'https://tve1887.hu/uszoda/';

const LANE_COUNT = 8;
const LANE_LABEL_X = 78;
/** A fejlécsor sötétkék háttere — ez nem beosztáscella. */
const HEADER_COLOR = '0.27,0.33,0.42';
/** LAKOSSÁG: az egyetlen szín, ami SZABAD sávot jelent. */
const PUBLIC_COLOR = '0.66,0.82,0.56';

const LEGEND: Record<string, { kind: LaneBlock['kind']; label: string }> = {
  '1.00,0.00,0.00': { kind: 'closed', label: 'zárva' },
  '0.36,0.61,0.83': { kind: 'club', label: 'TVE edzés' },
  '1.00,1.00,0.00': { kind: 'event', label: 'mérkőzés' },
  '1.00,0.75,0.00': { kind: 'club', label: 'bérlő' },
  '0.85,0.85,0.85': { kind: 'club', label: 'támogatók' },
};

function colorKey(color: readonly number[]): string {
  return color.map((channel) => channel.toFixed(2)).join(',');
}

/**
 * Részfontos szöveg visszafejtése: az ASCII tartományban a glifaazonosító + 29
 * adja a karakterkódot. Az ezen kívül eső (ékezetes) glifákat `?`-lel jelöljük,
 * mert a kiosztásuk fontonként más — ezeket NEM tippeljük meg.
 */
export function decodeSubsetText(text: string): string {
  return text.replace(/#(?:[0-9A-Fa-f]{4})+/g, (match) => {
    const ids = match.slice(1).match(/.{4}/g) ?? [];
    return ids
      .map((hex) => {
        const code = parseInt(hex, 16) + 29;
        return code >= 32 && code < 127 ? String.fromCharCode(code) : '?';
      })
      .join('');
  });
}

/** A heti program PDF-jeinek dátuma a fájlnévben: `…-2026_09_23[_mod].pdf`. */
export function findLatestProgramUrl(html: string, baseUrl: string): string | null {
  const pattern = /https?:\/\/[^"'\s]*USZODA_HETI-PROGRAM-(\d{4})_(\d{2})_(\d{2})[^"'\s]*\.pdf/gi;
  let best: { url: string; date: string } | null = null;
  for (const match of html.matchAll(pattern)) {
    const date = `${match[1]}-${match[2]}-${match[3]}`;
    if (!best || date > best.date) best = { url: match[0], date };
  }
  return best ? new URL(best.url, baseUrl).toString() : null;
}

function minutesToTime(minutes: number): string {
  const hour = Math.floor(minutes / 60);
  return `${String(hour).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

export function parseTvePdf(raw: RawSource, ctx: ParseContext): LaneBlock[] {
  const pages = extractPages(raw.body);
  if (pages.length > 1) {
    ctx.warn(`${pages.length} oldalas heti program jött, csak az elsőt dolgozzuk fel.`);
  }
  const page = pages[0];
  if (!page) throw new Error('A heti program PDF-jéből egyetlen oldalt sem sikerült kiolvasni.');

  const cells: PdfFilledRect[] = page.rects.filter(
    (rect) => rect.width > 5 && rect.height > 10 && colorKey(rect.color) !== HEADER_COLOR,
  );

  const laneLabels = page.texts
    .filter((text) => Math.abs(text.x - LANE_LABEL_X) < 4 && /^[1-8]\.$/.test(text.text.trim()))
    .sort((a, b) => b.y - a.y);
  if (laneLabels.length !== LANE_COUNT * 7) {
    throw new Error(
      `${laneLabels.length} sávfeliratot találtunk, de ${LANE_COUNT * 7}-et vártunk (7 nap × ${LANE_COUNT} sáv).`,
    );
  }

  const dayDates = page.texts
    .filter((text) => /^\d{4}\.\d{2}\.\d{2}$/.test(text.text.trim()))
    .sort((a, b) => b.y - a.y);
  if (dayDates.length !== 7) {
    throw new Error(`${dayDates.length} napdátumot találtunk a heti programban, de hetet vártunk.`);
  }

  // Mestersablon: az első nap fejléce, ahol minden fél óra külön cellában van.
  const firstHeaderY = Math.max(...page.texts.filter((text) => /^\d{1,2}:(00|30)$/.test(text.text.trim())).map((t) => t.y));
  const columns = page.texts
    .filter((text) => /^\d{1,2}:(00|30)$/.test(text.text.trim()) && text.y > firstHeaderY - 6)
    .map((text) => {
      const [hour, minute] = text.text.trim().split(':');
      return { x: text.x, minutes: Number(hour) * 60 + Number(minute) };
    })
    .sort((a, b) => a.x - b.x);
  if (columns.length < 20) {
    throw new Error(`${columns.length} idősáv-oszlopot találtunk a fejlécben — megváltozott a heti program formátuma.`);
  }

  const blocks: LaneBlock[] = [];

  for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
    const lanes = laneLabels.slice(dayIndex * LANE_COUNT, dayIndex * LANE_COUNT + LANE_COUNT);
    if (lanes.some((lane, index) => lane.text.trim() !== `${index + 1}.`)) {
      throw new Error(`A(z) ${dayIndex + 1}. napblokk sávfeliratai nem 1–8 sorrendben állnak.`);
    }
    const date = dayDates[dayIndex].text.trim().replace(/\./g, '-');

    type Slot = { minutes: number; occupied: number; names: string[]; kinds: LaneBlock['kind'][] };
    const slots: Slot[] = columns.map((column) => {
      const names: string[] = [];
      const kinds: LaneBlock['kind'][] = [];
      let occupied = 0;
      for (const lane of lanes) {
        // A felirat a cella bal szélén kezdődik, ezért kissé beljebb mintázunk.
        const hit = rectAt(cells, column.x + 5, lane.y + 4);
        if (!hit) {
          ctx.warn(`${date} ${minutesToTime(column.minutes)}, ${lane.text.trim()} sáv: nincs cella a rácsban.`);
          continue;
        }
        const key = colorKey(hit.color);
        if (key === PUBLIC_COLOR) continue;
        occupied += 1;
        const meaning = LEGEND[key];
        if (!meaning) {
          // Ismeretlen szín: foglaltnak vesszük (óvatosabb, mint szabadnak),
          // de jelezzük, mert a jelmagyarázat bővülhetett.
          ctx.warn(`${date} ${minutesToTime(column.minutes)}: ismeretlen cellaszín (${key}), foglaltnak vettük.`);
          continue;
        }
        kinds.push(meaning.kind);
        const label = page.texts
          .filter(
            (text) =>
              text.x >= hit.x - 3 &&
              text.x <= hit.x + hit.width &&
              text.y >= hit.y - 3 &&
              text.y <= hit.y + hit.height,
          )
          .sort((a, b) => b.y - a.y || a.x - b.x)
          .map((text) => decodeSubsetText(text.text).replace(/\s+/g, ' ').trim())
          .filter(Boolean)
          .join(' ');
        names.push(label === '' || label.includes('?') ? meaning.label : label);
      }
      return { minutes: column.minutes, occupied, names, kinds };
    });

    // Az azonos foglaltságú és azonos feliratú, egymást követő fél órák
    // összevonása — így nem lesz átfedő blokk, és olvasható marad a lista.
    const signature = (slot: Slot): string => `${slot.occupied}|${[...new Set(slot.names)].sort().join(',')}`;
    let index = 0;
    while (index < slots.length) {
      const current = slots[index];
      if (current.occupied === 0) {
        index += 1;
        continue;
      }
      let last = index;
      while (
        last + 1 < slots.length &&
        slots[last + 1].minutes === slots[last].minutes + 30 &&
        signature(slots[last + 1]) === signature(current)
      ) {
        last += 1;
      }

      const names = [...new Set(current.names)];
      const kind: LaneBlock['kind'] = current.kinds.every((item) => item === 'closed')
        ? 'closed'
        : current.kinds.includes('event')
          ? 'event'
          : 'club';
      blocks.push({
        poolId: POOL_ID,
        basinId: BASIN_ID,
        date,
        start: minutesToTime(current.minutes),
        end: minutesToTime(slots[last].minutes + 30),
        lanesOccupied: current.occupied,
        kind,
        reason:
          kind === 'closed'
            ? 'Zárva a TVE heti programja szerint'
            : `Foglalt sáv a TVE heti programja szerint (${names.join(', ')})`,
      });
      index = last + 1;
    }
  }

  if (blocks.length === 0) {
    throw new Error('A heti programból egyetlen foglalás sem jött ki — valószínűleg megváltozott a rács.');
  }

  return blocks;
}

export const tveHetiProgramAdapter: Adapter = {
  id: 'tve-heti-program',
  poolId: POOL_ID,
  sourceUrl: INDEX_URL,
  description: 'TVE 1887 Sportuszoda heti programja (PDF, a cellák kitöltőszíne kódolja a foglaltságot).',

  async fetch(): Promise<RawSource> {
    const index = await fetchRaw(INDEX_URL);
    const pdfUrl = findLatestProgramUrl(asText(index), index.url);
    if (!pdfUrl) {
      throw new Error(`Nincs USZODA_HETI-PROGRAM PDF link a(z) ${INDEX_URL} oldalon — átalakult az oldal.`);
    }
    const pdf = await fetchRaw(pdfUrl);
    if (pdf.body.subarray(0, 4).toString('latin1') !== '%PDF') {
      throw new Error(`A(z) ${pdfUrl} címen nem PDF érkezett.`);
    }
    return pdf;
  },

  parse(raw, ctx) {
    return parseTvePdf(raw, ctx);
  },
};

registerAdapter(tveHetiProgramAdapter);
