/**
 * BVSC-Zugló, Laky Károly Sportuszoda — heti sávnaptár.
 *
 * EZ AZ EGYETLEN OLYAN FORRÁS A PROJEKTBEN, AMI VALÓDI, SZERVEROLDALON
 * LEGENERÁLT HTML-TÁBLÁZATBAN közli a sávbeosztást. A klub weboldala
 * (bvsc.hu) maga semmit nem publikál — a házirend szerint „a medencék
 * beosztásáról a vendégek az előcsarnokban elhelyezett monitorokról
 * tájékozódhatnak" —, viszont a beléptető/foglalási rendszer (FacilityPilot)
 * beágyazható naptárnézete nyilvánosan elérhető, és JS nélkül, kész HTML-ként
 * adja vissza a hetet.
 *
 * A NAPTÁR SZERKEZETE (letesitmeny.bvsc.hu/naptar/beagyazas/…):
 *   <div class="schedule-title">Beosztás: 2026.09.21.–2026.09.27. · Új 50 méteres mednece · 50.0 m</div>
 *   <table class="calendar">
 *     <thead>
 *       <tr><th class="time-head" rowspan="2">Idősáv</th>
 *           <th class="day-head" colspan="8">Hétfő<br><small>09.21.</small></th> … ×7</tr>
 *       <tr><th class="lane-head" title="1-es sáv">1</th> … ×56</tr>
 *     </thead>
 *     <tbody>
 *       <tr><th class="time-cell">06:00–07:00</th><td class="slot">…</td> ×56</tr> … ×16
 *     </tbody>
 *   </table>
 *
 * Egy foglalás a KEZDŐ cellájában ül, abszolút pozicionált dobozként:
 *   <div class="booking" style="…;width:calc(800% + 7px - 4px);…" title="edzés úszás · 06:00–09:00">
 * A `title` és a belső `<span>` is tartalmazza a pontos időtartamot, ezért a
 * CSS-es magasságszámítást (`--slot-height` szorzók) NEM kell visszafejtenünk;
 * elég a feliratot olvasni. A SÁVOK SZÁMÁT viszont csak a `width` százalék
 * adja meg: 100% = 1 sáv, 800% = 8 sáv.
 *
 * FIGYELEM — `public-booking`: a zöld, „Közönség számára fenntartva" dobozok
 * NEM foglalások a mi szempontunkból, hanem éppen ellenkezőleg: az a sáv akkor
 * elérhető a közönség számára. Ezeket SZÁNDÉKOSAN kihagyjuk.
 *
 * KORLÁT: a naptár négy medencét ismer (Új/Régi 25 m, Új/Régi 50 m), a
 * `data/pools.json` viszont jelenleg csak egy „50m-versenymedence" medencét
 * tart nyilván ennél az uszodánál. Ezért csak az `objektum=2` („Új 50 méteres
 * medence") nézetet kérjük le, és azt feleltetjük meg a versenymedencének.
 */

import * as cheerio from 'cheerio';
import type { LaneBlock, BlockKind, Weekday } from '../../types';
import { asText, fetchRaw } from '../http';
import { registerAdapter, type Adapter, type ParseContext, type RawSource } from '../types';

const POOL_ID = 'bvsc-laky-karoly-sportuszoda';
const BASIN_ID = '50m-versenymedence';

/**
 * A beágyazott naptár állandó URL-je. Az útvonal végén lévő hosszú token a
 * beágyazás azonosítója (nem titok, nem is bejelentkezéshez kötött) — a
 * bvsc.hu nyilvános oldaláról származik.
 *
 * Paraméterek: `nezet=week` heti nézet, `objektum=2` az Új 50 m-es medence,
 * `felosztas=hosszanti` a hosszanti sávok (a `kereszt` a vízilabdakapuk
 * irányában osztja fel a medencét — azt nem modellezzük).
 */
const EMBED_URL =
  'https://letesitmeny.bvsc.hu/naptar/beagyazas/1/gLvN8QUGY0KL143SXiqxkNCFpJTGxrlHtRpvnqlhansUnfec' +
  '?nezet=week&objektum=2&felosztas=hosszanti';

/** A naptár napfejléceinek sorrendje; ebből vezetjük le a hét napját. */
const WEEKDAY_NAMES = ['hétfő', 'kedd', 'szerda', 'csütörtök', 'péntek', 'szombat', 'vasárnap'];

/**
 * A foglalás megnevezéséből a szerződés szerinti `kind`.
 * Ismeretlen felirat esetén `club` — a naptárban kizárólag egyesületi
 * használat szerepel, és a „valamilyen foglalás" konzervatívabb, mint a semmi.
 */
function classify(label: string): BlockKind {
  const text = label.toLowerCase();
  if (text.includes('mérkőzés') || text.includes('verseny') || text.includes('bajnokság')) return 'event';
  if (text.includes('oktatás') || text.includes('tanfolyam') || text.includes('úszásoktat')) return 'course';
  if (text.includes('iskola') || text.includes('diák')) return 'school';
  if (text.includes('karbantart') || text.includes('technikai')) return 'maintenance';
  if (text.includes('zárva')) return 'closed';
  return 'club';
}

/** „06:00–09:00" → `{ start, end }`. Bármilyen kötőjel/gondolatjel elválaszthatja. */
export function parseTimeRange(text: string): { start: string; end: string } | null {
  const match = text.match(/(\d{1,2}):(\d{2})\s*[–—-]\s*(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const start = `${match[1].padStart(2, '0')}:${match[2]}`;
  const end = `${match[3].padStart(2, '0')}:${match[4]}`;
  if (start >= end) return null;
  return { start, end };
}

/**
 * A kártya címéből („Beosztás: 2026.09.21.–2026.09.27. · …") kiolvassuk a hét
 * kezdő évét és hónapját. A napfejlécek ugyanis csak „09.21." alakúak, év
 * nélkül — év-, illetve évfordulós heteknél ebből kell visszaszámolni.
 */
export function parseWeekRange(title: string): { start: Date; end: Date } | null {
  const match = title.match(/(\d{4})\.(\d{2})\.(\d{2})\.?\s*[–—-]\s*(?:(\d{4})\.)?(\d{2})\.(\d{2})/);
  if (!match) return null;
  const startYear = Number(match[1]);
  const start = new Date(Date.UTC(startYear, Number(match[2]) - 1, Number(match[3])));
  const endYear = match[4] ? Number(match[4]) : Number(match[5]) < Number(match[2]) ? startYear + 1 : startYear;
  const end = new Date(Date.UTC(endYear, Number(match[5]) - 1, Number(match[6])));
  return { start, end };
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** A `width:calc(800% + 7px - 4px)` stílusból a lefoglalt sávok száma. */
function parseLaneSpan(style: string): number | null {
  const match = style.match(/width\s*:\s*calc\(\s*([\d.]+)%/);
  if (!match) return null;
  const lanes = Number(match[1]) / 100;
  if (!Number.isFinite(lanes) || lanes <= 0) return null;
  return Math.round(lanes);
}

/**
 * A naptár HTML feldolgozása. Dobhat: a hívó `runAdapter` ezt hibás
 * eredménnyé alakítja, így soha nem keletkezik néma, üres siker.
 */
export function parseBvscCalendar(raw: RawSource, ctx: ParseContext): LaneBlock[] {
  const $ = cheerio.load(asText(raw));

  const table = $('table.calendar').first();
  if (table.length === 0) {
    throw new Error('Nincs `table.calendar` a válaszban — a FacilityPilot naptár szerkezete megváltozott.');
  }

  const cardTitle = $('.schedule-title').first().text().trim();
  const week = parseWeekRange(cardTitle);
  if (!week) {
    throw new Error(`A hét dátumtartománya nem olvasható ki a kártyacímből: ${JSON.stringify(cardTitle)}`);
  }

  // --- Napok ---------------------------------------------------------------

  const dayHeads = table.find('thead th.day-head');
  if (dayHeads.length !== 7) {
    throw new Error(`7 napfejlécet vártunk, de ${dayHeads.length} van — más nézet jött vissza (nem heti?).`);
  }

  const days: { date: string; weekday: Weekday; name: string }[] = [];
  dayHeads.each((index, element) => {
    const name = $(element).clone().children().remove().end().text().trim().toLowerCase();
    const expected = WEEKDAY_NAMES[index];
    if (name !== '' && name !== expected) {
      ctx.warn(`A ${index + 1}. napfejléc ${JSON.stringify(name)}, de ${expected} lenne — a hét eltolódhatott.`);
    }
    const date = new Date(week.start.getTime() + index * 86_400_000);
    days.push({ date: isoDate(date), weekday: (index + 1) as Weekday, name: expected });
  });

  if (isoDate(new Date(week.start.getTime() + 6 * 86_400_000)) !== isoDate(week.end)) {
    ctx.warn(`A kártyacím szerinti hét nem hét napos: ${cardTitle}`);
  }

  // --- Sávok naponta -------------------------------------------------------

  const laneHeads = table.find('thead th.lane-head').length;
  if (laneHeads === 0 || laneHeads % 7 !== 0) {
    throw new Error(`Értelmezhetetlen sávfejléc-szám: ${laneHeads} (hét nappal nem osztható).`);
  }
  const lanesPerDay = laneHeads / 7;

  // --- Foglalások ----------------------------------------------------------

  const blocks: LaneBlock[] = [];
  let publicSlots = 0;

  table.find('tbody tr').each((_, row) => {
    $(row)
      .find('td.slot')
      .each((cellIndex, cell) => {
        const dayIndex = Math.floor(cellIndex / lanesPerDay);
        const day = days[dayIndex];
        if (!day) return;

        $(cell)
          .find('div.booking')
          .each((__, booking) => {
            const node = $(booking);

            // A közönség számára fenntartott sáv NEM foglalás: az a szabad víz.
            if ((node.attr('class') ?? '').includes('public-booking')) {
              publicSlots += 1;
              return;
            }

            const title = (node.attr('title') ?? '').trim();
            const spanText = node.find('span').first().text().trim();
            const range = parseTimeRange(spanText) ?? parseTimeRange(title);
            if (!range) {
              ctx.warn(`${day.name}: nem olvasható időtartam a foglaláson: ${JSON.stringify(title || spanText)}`);
              return;
            }

            const style = node.attr('style') ?? '';
            const lanes = parseLaneSpan(style);
            if (lanes === null) {
              ctx.warn(`${day.name} ${range.start}: nem olvasható a sávszám a stílusból: ${JSON.stringify(style)}`);
              return;
            }
            if (lanes > lanesPerDay) {
              ctx.warn(`${day.name} ${range.start}: ${lanes} sáv a naptárban, de a nézet csak ${lanesPerDay} sávot mutat.`);
            }

            // A felirat „megnevezés · időtartam" alakú; az időtartamot levágjuk.
            const label = (title.split('·')[0] ?? '').trim() || 'Foglalt';

            blocks.push({
              poolId: POOL_ID,
              basinId: BASIN_ID,
              date: day.date,
              start: range.start,
              end: range.end,
              lanesOccupied: Math.min(lanes, lanesPerDay),
              kind: classify(label),
              reason: `${label} (BVSC sávnaptár)`,
            });
          });
      });
  });

  if (publicSlots > 0) {
    ctx.warn(`${publicSlots} „közönség számára fenntartva" doboz kihagyva — azok szabad sávot jelentenek, nem foglalást.`);
  }

  // --- Átfedés-ellenőrzés --------------------------------------------------
  //
  // Az elérhetőség-motor az átfedő blokkokat ÖSSZEADJA, ezért egy dupla
  // bejegyzés csendben elvenne sávokat. Nem javítjuk automatikusan, mert az
  // átfedés valós is lehet (két egyesület két külön sávcsoporton) — de ha a
  // sávok összege meghaladja a medence sávszámát, az biztosan hiba.
  for (const day of days) {
    const sameDay = blocks.filter((block) => block.date === day.date);
    for (let i = 0; i < sameDay.length; i += 1) {
      for (let j = i + 1; j < sameDay.length; j += 1) {
        const a = sameDay[i];
        const b = sameDay[j];
        if (a.start < b.end && b.start < a.end && a.lanesOccupied + b.lanesOccupied > lanesPerDay) {
          ctx.warn(
            `${day.date}: átfedő foglalások (${a.start}–${a.end} ${a.lanesOccupied} sáv, ` +
              `${b.start}–${b.end} ${b.lanesOccupied} sáv) együtt több sávot foglalnának, mint ${lanesPerDay}.`,
          );
        }
      }
    }
  }

  return blocks;
}

export const bvscFacilityPilotAdapter: Adapter = {
  id: 'bvsc-facilitypilot',
  poolId: POOL_ID,
  sourceUrl: EMBED_URL,
  description:
    'BVSC-Zugló beágyazott FacilityPilot sávnaptára (HTML-táblázat, Új 50 m-es medence, hosszanti sávok).',

  async fetch(): Promise<RawSource> {
    // A naptár mindig az AKTUÁLIS hetet adja vissza, ha a `datum` a mai nap.
    const today = new Date().toISOString().slice(0, 10);
    const source = await fetchRaw(`${EMBED_URL}&datum=${today}`);
    const text = asText(source);
    if (!text.includes('table class="calendar"') && !text.includes("table class='calendar'")) {
      throw new Error('A letöltött oldal nem tartalmaz naptártáblázatot (bejelentkeztető vagy hibaoldal jöhetett).');
    }
    return source;
  },

  parse(raw, ctx) {
    return parseBvscCalendar(raw, ctx);
  },
};

registerAdapter(bvscFacilityPilotAdapter);
