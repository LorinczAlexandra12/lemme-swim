/**
 * Scraper-keretrendszer — közös típusok és adapter-nyilvántartás.
 *
 * Egy ADAPTER egyetlen uszoda egyetlen publikált forrását ismeri. Két lépésre
 * bomlik, hogy a hálózat és az értelmezés külön tesztelhető legyen:
 *
 *   fetch()  — letölti a nyers bájtokat (HTML, PDF, XLSX, kép…)
 *   parse()  — a nyers bájtokból `LaneBlock` rekordokat állít elő
 *
 * ALAPSZABÁLY: ha egy adapter nem tudja értelmezni a forrását, DOBJON HIBÁT.
 * Az üres, de „sikeres” eredmény tilos — az azt hazudná a felhasználónak, hogy
 * a medence teljesen szabad. A futtató (`runner.ts`) a dobott hibát
 * `ok: false` + magyar `error` szöveggé alakítja.
 */

import type { LaneBlock } from '../types';

/** Egy letöltött forrás nyers alakja. */
export interface RawSource {
  /** A ténylegesen letöltött URL (átirányítás vagy felderített link után). */
  url: string;
  /** A szerver által jelzett tartalomtípus, kisbetűsítve. */
  contentType: string;
  /** A nyers válasz. Szöveges forrásnál is bájtban tartjuk, a PDF/XLSX miatt. */
  body: Buffer;
  /** Mikor került le a hálózatról (ISO 8601). Gyorsítótárból is az eredeti idő. */
  fetchedAt: string;
  /** Igaz, ha a `data/.cache` könyvtárból jött, és nem a hálózatról. */
  fromCache: boolean;
}

/**
 * Az értelmezés közben keletkező, de nem végzetes észrevételek gyűjtője.
 * Ide kerül minden, amit az adapter LÁTOTT, de nem tudott értelmezni — ez a
 * leggyorsabb jelzés arról, hogy a forrásoldal formátuma megváltozott.
 */
export interface ParseContext {
  warn(message: string): void;
}

export interface Adapter {
  /** Egyedi, stabil azonosító, pl. "ujhegyi-palyabeosztas-pdf". */
  id: string;
  /** Melyik uszoda rekordjához tartozik (`data/pools.json` `id` mezője). */
  poolId: string;
  /** A belépési pont URL-je — a UI ezt tudja a felhasználónak megmutatni. */
  sourceUrl: string;
  /** Egymondatos magyar leírás arról, mit és honnan olvas az adapter. */
  description: string;
  /** Letölti a nyers forrást. Hálózati hiba esetén dobjon. */
  fetch(): Promise<RawSource>;
  /** Nyers forrás → sávfoglalások. Értelmezhetetlen forrásnál dobjon hibát. */
  parse(raw: RawSource, ctx: ParseContext): LaneBlock[];
}

// ---------------------------------------------------------------------------
// Nyilvántartás
// ---------------------------------------------------------------------------

const registry = new Map<string, Adapter>();

/** Adapter bejegyzése. Ismétlődő azonosító programozói hiba, ezért dobunk. */
export function registerAdapter(adapter: Adapter): void {
  if (registry.has(adapter.id)) {
    throw new Error(`Duplikált adapter-azonosító: ${adapter.id}`);
  }
  registry.set(adapter.id, adapter);
}

/** Az összes bejegyzett adapter, bejegyzési sorrendben. */
export function listAdapters(): Adapter[] {
  return [...registry.values()];
}

export function getAdapter(id: string): Adapter | undefined {
  return registry.get(id);
}

/** Csak tesztekhez: a nyilvántartás ürítése. */
export function clearAdapters(): void {
  registry.clear();
}
