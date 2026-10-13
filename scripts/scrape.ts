#!/usr/bin/env tsx
/**
 * `npm run scrape` — a bejegyzett scraper-adapterek futtatása és az eredmény
 * beolvasztása a `data/blocks.json` fájlba.
 *
 * Két fájlt ír:
 *  - `data/blocks.json`           — maguk a sávfoglalások;
 *  - `data/schedule-sources.json` — MELYIK uszodánál HONNAN és MIKORRÓL van
 *    adatunk. Enélkül a felület a legfrissebb blokkokat is „Nincs sávadat"-ként
 *    rejtené el, mert a `pools.json` alapértelmezése `{"type":"none"}`.
 *
 * ÖSSZEOLVASZTÁSI SZABÁLY (ez a script legfontosabb része):
 *  - egy SIKERES adapter eredménye LECSERÉLI az adott uszoda összes korábbi
 *    blokkját — így a lekerült edzések nem ragadnak bent örökre;
 *  - a HIBÁRA futott adapter NEM nyúl semmihez: a régi adat bent marad, és a
 *    hibát hangosan kiírjuk. Jobb egy tegnapi beosztás, mint egy üres nap;
 *  - a `curatedPools` listán szereplő uszodák KÉZI adatát semmi nem írhatja
 *    felül. Ez a védőháló azokra az uszodákra, ahol a beosztás csak képen vagy
 *    PDF-en jelenik meg, és emberi szem olvasta ki.
 *
 * Kapcsolók:
 *   --only=<adapter-id>[,<adapter-id>]   csak ezek fussanak
 *   --dry-run                            ne írjon fájlt, csak mutassa az eredményt
 *   --no-cache                           hagyja figyelmen kívül a data/.cache-t
 */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { LaneBlock, Pool, ScheduleSource, ScrapeResult } from '../src/lib/types';

const ROOT = process.cwd();
const BLOCKS_PATH = path.join(ROOT, 'data', 'blocks.json');
const POOLS_PATH = path.join(ROOT, 'data', 'pools.json');
const SOURCES_PATH = path.join(ROOT, 'data', 'schedule-sources.json');

/**
 * A `data/blocks.json` alakja. A `blocks` kulcsot olvassa a `src/lib/data.ts`;
 * a többi mező csak a karbantartóknak és ennek a scriptnek szól, a betöltő
 * figyelmen kívül hagyja őket.
 */
interface BlocksFile {
  note?: string;
  curatedPools?: string[];
  blocks: LaneBlock[];
}

/**
 * A `data/schedule-sources.json` alakja. Ez a fájl mondja meg a felületnek,
 * HONNAN és MIKORRÓL van sávadatunk egy uszodához; a `build-dataset.ts` ezt
 * olvassa rá a `pools.json` alapértelmezett `{"type":"none"}` forrására.
 *
 * A fájlt TÖBBEN írjuk: a kézi (`curated`) bejegyzéseket ember viszi bele, a
 * `scraper` bejegyzéseket ez a script. Ezért mindig OLVASS–MÓDOSÍTS–ÍRJ
 * módon nyúlunk hozzá, és csak azokat a kulcsokat írjuk át, amelyekhez épp
 * sikeres lekérésünk van.
 */
interface ScheduleSourcesFile {
  [extra: string]: unknown;
  sources?: Record<string, ScheduleSource>;
}

interface Args {
  only: string[];
  dryRun: boolean;
}

function parseArgs(argv: string[]): Args {
  const only: string[] = [];
  let dryRun = false;
  for (const arg of argv) {
    if (arg === '--dry-run') dryRun = true;
    else if (arg === '--no-cache') process.env.USZODA_SCRAPE_NO_CACHE = '1';
    else if (arg.startsWith('--only=')) only.push(...arg.slice('--only='.length).split(',').filter(Boolean));
  }
  return { only, dryRun };
}

async function readBlocksFile(): Promise<BlocksFile> {
  try {
    const parsed = JSON.parse(await readFile(BLOCKS_PATH, 'utf8')) as BlocksFile;
    return { ...parsed, blocks: Array.isArray(parsed.blocks) ? parsed.blocks : [] };
  } catch {
    return { blocks: [] };
  }
}

async function readPools(): Promise<Pool[]> {
  try {
    const parsed = JSON.parse(await readFile(POOLS_PATH, 'utf8')) as { pools?: Pool[] } | Pool[];
    return Array.isArray(parsed) ? parsed : (parsed.pools ?? []);
  } catch {
    return [];
  }
}

async function readSourcesFile(): Promise<ScheduleSourcesFile> {
  try {
    const parsed = JSON.parse(await readFile(SOURCES_PATH, 'utf8')) as ScheduleSourcesFile;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    // Ha a fájl még nincs meg, üresből indulunk — a `_comment`-et nem gyártjuk le.
    return {};
  }
}

/**
 * A sikeres adapterek eredetének átvezetése a `data/schedule-sources.json`-ba.
 *
 * SZÁNDÉKOSAN csak a SIKERES adapterek kapnak friss `lastScrapedAt`-et: a
 * hibára futott adapter bejegyzése érintetlen marad, így a régi időbélyeg
 * szépen „öregszik” a felületen (Régi adat), ahelyett hogy frissnek hazudnánk.
 *
 * A kézzel gondozott (`curated`) bejegyzéseket meg sem érintjük, ahogy a
 * blokkjaikat sem.
 */
function mergeScheduleSources(
  file: ScheduleSourcesFile,
  succeeded: ScrapeResult[],
  adapterUrl: (adapterId: string) => string | undefined,
  curated: Set<string>,
  scrapedAt: string,
): { file: ScheduleSourcesFile; written: string[] } {
  const sources: Record<string, ScheduleSource> = { ...(file.sources ?? {}) };
  const written: string[] = [];

  for (const result of succeeded) {
    if (curated.has(result.poolId)) continue;
    const existing = sources[result.poolId];
    if (existing?.type === 'curated') continue;
    sources[result.poolId] = {
      // A kézzel hozzáírt mezőket (pl. `format`, `note`) megtartjuk.
      ...existing,
      type: 'scraper',
      adapter: result.adapter,
      url: adapterUrl(result.adapter) ?? existing?.url,
      lastScrapedAt: scrapedAt,
    };
    written.push(result.poolId);
  }

  return { file: { ...file, sources }, written: written.sort() };
}

/** Stabil sorrend, hogy a fájl diffje olvasható maradjon. */
function sortBlocks(blocks: LaneBlock[]): LaneBlock[] {
  return [...blocks].sort(
    (a, b) =>
      a.poolId.localeCompare(b.poolId) ||
      a.basinId.localeCompare(b.basinId) ||
      (a.weekday ?? 0) - (b.weekday ?? 0) ||
      (a.date ?? '').localeCompare(b.date ?? '') ||
      a.start.localeCompare(b.start),
  );
}

/**
 * Azok a blokkok, amelyeknek már nincs medencéje a `data/pools.json`-ban.
 *
 * Ezek a UI-ban sosem jelennének meg, viszont a fájlban maradva azt a hamis
 * látszatot keltenék, hogy van róluk adatunk. Üres uszodalistára szándékosan
 * semmit nem ad vissza: egy elrontott vagy félig megírt `pools.json` nem
 * törölheti le az összes összegyűjtött sávadatot.
 */
function orphanBlocks(blocks: LaneBlock[], pools: Pool[]): LaneBlock[] {
  if (pools.length === 0) return [];
  const known = new Set(
    pools.flatMap((pool) => pool.basins.map((basin) => `${pool.id}/${basin.id}`)),
  );
  return blocks.filter((block) => !known.has(`${block.poolId}/${block.basinId}`));
}

/**
 * A blokkok ellenőrzése a valódi uszoda-adatok ellen. Nem dob: a talált
 * gondokat visszaadja, hogy a felhasználó lássa, mi nem fog megjelenni a UI-ban.
 */
function validateAgainstPools(blocks: LaneBlock[], pools: Pool[]): string[] {
  const problems: string[] = [];
  for (const block of blocks) {
    const pool = pools.find((candidate) => candidate.id === block.poolId);
    if (!pool) {
      problems.push(`${block.poolId}: nincs ilyen uszoda a data/pools.json-ban.`);
      continue;
    }
    const basin = pool.basins.find((candidate) => candidate.id === block.basinId);
    if (!basin) {
      problems.push(`${block.poolId}/${block.basinId}: nincs ilyen medence az uszodában.`);
      continue;
    }
    if (basin.lanes !== null && block.lanesOccupied > basin.lanes) {
      problems.push(
        `${block.poolId}/${block.basinId} ${block.start}–${block.end}: ${block.lanesOccupied} foglalt sáv, de a medencének csak ${basin.lanes} van.`,
      );
    }
  }
  return [...new Set(problems)];
}

function describeResult(result: ScrapeResult): string {
  const status = result.ok ? '✔ SIKER' : '✘ HIBA ';
  const detail = result.ok ? `${result.blocks.length} sávfoglalás` : result.error;
  return `  ${status}  ${result.adapter} (${result.poolId})\n          ${detail}`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  // Az import mellékhatása a bejegyzés, ezért a kapcsolók feldolgozása után jön.
  const { getAdapter, listAdapters, runAdapters } = await import('../src/lib/scrapers/index');

  const adapters = listAdapters();
  console.log('Uszoda Tracker — sávbeosztás-scraper\n');
  console.log(`Bejegyzett adapterek: ${adapters.length}`);
  if (adapters.length === 0) {
    console.log(
      '  (Egy sincs. Ez nem hiba: a legtöbb budapesti uszoda egyszerűen nem publikál\n' +
        '   gépi olvasású sávbeosztást — a részleteket lásd a data/README.md fájlban.)',
    );
  }
  for (const adapter of adapters) console.log(`  • ${adapter.id} → ${adapter.poolId}\n    ${adapter.description}`);
  console.log('');

  const results = await runAdapters({
    only: args.only,
    onProgress: (adapter) => console.log(`Lekérés: ${adapter.id} …`),
  });

  console.log('\nEredmények:');
  if (results.length === 0) console.log('  (nem futott egyetlen adapter sem)');
  for (const result of results) console.log(describeResult(result));

  const warnings = results.flatMap((result) => (result.warnings ?? []).map((w) => `${result.adapter}: ${w}`));
  if (warnings.length > 0) {
    console.log(`\nFigyelmeztetések (${warnings.length}):`);
    for (const warning of warnings) console.log(`  ! ${warning}`);
  }

  // --- Összeolvasztás -------------------------------------------------------

  const file = await readBlocksFile();
  const curated = new Set(file.curatedPools ?? []);
  const succeeded = results.filter((result) => result.ok);

  const replaced: string[] = [];
  const skipped: string[] = [];
  let blocks = file.blocks;

  for (const result of succeeded) {
    if (curated.has(result.poolId)) {
      skipped.push(result.poolId);
      continue;
    }
    blocks = blocks.filter((block) => block.poolId !== result.poolId);
    blocks = blocks.concat(result.blocks);
    replaced.push(result.poolId);
  }

  const pools = await readPools();

  // A `data/pools.json`-ban nem létező medencék blokkjait KITÖRÖLJÜK, nem csak
  // jelezzük. Máskülönben örökre itt ragadnának: a kézzel rögzített uszodák
  // (`curatedPools`) blokkjait a fenti csere szándékosan nem érinti, így egy
  // kiszűrt medence (pl. tanmedence) sávjai akkor is a fájlban maradnának, ha a
  // medence már régen kikerült az adathalmazból.
  const dropped = orphanBlocks(blocks, pools);
  if (dropped.length > 0) {
    blocks = blocks.filter((block) => !dropped.includes(block));
    const byBasin = [...new Set(dropped.map((b) => `${b.poolId}/${b.basinId}`))];
    console.log(`\nTörölt blokkok — ${dropped.length} db olyan medencéhez, ami már nincs az adathalmazban:`);
    for (const key of byBasin) console.log(`  - ${key}`);
  }

  const problems = validateAgainstPools(blocks, pools);
  if (problems.length > 0) {
    console.log(`\nAdatellenőrzés — ${problems.length} gond (ezek a blokkok nem fognak megjelenni):`);
    for (const problem of problems) console.log(`  ! ${problem}`);
  }

  const output: BlocksFile = { ...file, blocks: sortBlocks(blocks) };

  console.log('\nÖsszegzés:');
  console.log(`  Sikeres adapter:      ${succeeded.length} / ${results.length}`);
  console.log(`  Frissített uszoda:    ${replaced.length > 0 ? replaced.join(', ') : '—'}`);
  if (skipped.length > 0) {
    console.log(`  Kézi adat megtartva:  ${skipped.join(', ')} (a curatedPools listán szerepel)`);
  }
  console.log(`  Összes sávfoglalás:   ${output.blocks.length}`);
  console.log(`  Ebből kézzel rögzített uszodákhoz: ${output.blocks.filter((b) => curated.has(b.poolId)).length}`);

  // --- Eredet átvezetése ----------------------------------------------------

  const sourcesFile = await readSourcesFile();
  const merged = mergeScheduleSources(
    sourcesFile,
    succeeded,
    (adapterId) => getAdapter(adapterId)?.sourceUrl,
    curated,
    new Date().toISOString(),
  );
  console.log(`  Eredet frissítve:     ${merged.written.length > 0 ? merged.written.join(', ') : '—'}`);

  if (args.dryRun) {
    console.log('\n--dry-run: a data/blocks.json és a data/schedule-sources.json NEM módosult.');
  } else {
    await writeFile(BLOCKS_PATH, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
    console.log(`\nMentve: ${path.relative(ROOT, BLOCKS_PATH)}`);
    if (merged.written.length > 0) {
      await writeFile(SOURCES_PATH, `${JSON.stringify(merged.file, null, 2)}\n`, 'utf8');
      console.log(`Mentve: ${path.relative(ROOT, SOURCES_PATH)}`);
    }
  }

  const failed = results.filter((result) => !result.ok);
  if (failed.length > 0) {
    console.log(
      `\n${failed.length} adapter hibára futott. Ez SZÁNDÉKOSAN nem nulla kilépési kód:\n` +
        'egy néma, üres eredményt adó scraper rosszabb, mint egy hangosan hibázó.',
    );
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error('Végzetes hiba a scraper futtatása közben:', error);
  process.exitCode = 1;
});
