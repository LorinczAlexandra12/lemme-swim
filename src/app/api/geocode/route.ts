import { NextResponse } from 'next/server';
import { toHits } from '@/lib/geocode';
import type { GeocodeHit } from '@/lib/ui/geocode';

/**
 * Címkereső — a Nominatim (OpenStreetMap) proxyja.
 *
 * Szerveroldalon hívjuk, nem a böngészőből: így tudunk azonosító
 * `User-Agent`-et küldeni (a Nominatim használati feltétele), gyorsítótárazni,
 * és betartani a „legfeljebb másodpercenként egy kérés" korlátot. A válaszból
 * csak azt adjuk tovább, amire a kereső szüksége van.
 */

export const dynamic = 'force-dynamic';

/** Budapest befoglaló téglalapja: bal, fent, jobb, lent (lon/lat). */
const BUDAPEST_VIEWBOX = '18.86,47.65,19.36,47.33';

// Csak ASCII: a HTTP fejlécek Latin-1 bájtok, az ékezetes betűk elszállnak.
const USER_AGENT = 'UszodaTracker/0.1 (Budapest swimming pool finder)';

const MIN_QUERY_LENGTH = 3;
const UPSTREAM_MIN_INTERVAL_MS = 1100;
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX_ENTRIES = 200;

const cache = new Map<string, { at: number; hits: GeocodeHit[] }>();

/**
 * A Nominatim használati feltétele legfeljebb másodpercenként egy kérés, ezért
 * a kimenő hívásokat egy ígéretlánccal sorba állítjuk.
 *
 * A `task` megmondja, hívta-e ténylegesen a Nominatimot. Ez fontos: gépelés
 * közben a böngésző sorra lemondja a túlhaladott kéréseket, és ha azok is
 * kivárnák a másodperces szünetet, a sor percekre feltorlódna — a felhasználó
 * már rég nem gépel, de a javaslatok csak csorognának be. Aki nem hívott
 * kifelé, az nem is tartja fel a sort.
 */
let upstreamQueue: Promise<unknown> = Promise.resolve();

interface Upstream<T> {
  value: T;
  calledUpstream: boolean;
}

function queueUpstream<T>(task: () => Promise<Upstream<T>>): Promise<T> {
  const run = upstreamQueue.then(task, task);
  upstreamQueue = run.then(
    (result) => (result.calledUpstream ? sleep(UPSTREAM_MIN_INTERVAL_MS) : undefined),
    () => sleep(UPSTREAM_MIN_INTERVAL_MS),
  );
  return run.then((result) => result.value);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readCache(key: string): GeocodeHit[] | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.hits;
}

function writeCache(key: string, hits: GeocodeHit[]) {
  if (cache.size >= CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { at: Date.now(), hits });
}

export async function GET(request: Request) {
  const query = (new URL(request.url).searchParams.get('q') ?? '').trim();

  if (query.length < MIN_QUERY_LENGTH) {
    return NextResponse.json([], { headers: { 'Cache-Control': 'no-store' } });
  }

  const key = query.toLocaleLowerCase('hu-HU');
  const cached = readCache(key);
  if (cached) {
    return NextResponse.json(cached, { headers: { 'Cache-Control': 'no-store' } });
  }

  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('addressdetails', '1');
  url.searchParams.set('limit', '6');
  url.searchParams.set('countrycodes', 'hu');
  url.searchParams.set('accept-language', 'hu');
  url.searchParams.set('viewbox', BUDAPEST_VIEWBOX);
  // Budapestre szorítjuk: az uszodák mind itt vannak, a környékbeli
  // találatok csak zavarnák a listát.
  url.searchParams.set('bounded', '1');

  try {
    const hits = await queueUpstream<GeocodeHit[]>(async () => {
      // Hátha a sorban állás alatt egy másik kérés már lekérte ugyanezt.
      const fresh = readCache(key);
      if (fresh) return { value: fresh, calledUpstream: false };

      // A böngésző közben továbbgépelt és lemondta ezt a kérést — a választ
      // már senki sem várja, úgyhogy ne terheljük vele a Nominatimot.
      if (request.signal.aborted) return { value: [], calledUpstream: false };

      const response = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) throw new Error(`Nominatim ${response.status}`);

      const parsed = toHits(await response.json());

      writeCache(key, parsed);
      return { value: parsed, calledUpstream: true };
    });

    return NextResponse.json(hits, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[api/geocode] a címkeresés meghiúsult', error);
    return NextResponse.json(
      { error: 'A címkereső most nem elérhető. Válassz kerületet, vagy próbáld újra.' },
      { status: 503 },
    );
  }
}
