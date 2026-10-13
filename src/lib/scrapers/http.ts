/**
 * Udvarias HTTP-réteg a scrapereknek.
 *
 * Amit betartunk, mert idegen, kis költségvetésű önkormányzati oldalakat kérünk le:
 *  - beszédes User-Agent, hogy az üzemeltető tudja, ki vagyunk és hol érhet el,
 *  - időkorlát, hogy egy elakadt kapcsolat ne fagyassza be a futást,
 *  - HOSZTONKÉNT legalább 1 másodperc várakozás két kérés között,
 *  - a robots.txt tiltásainak tiszteletben tartása,
 *  - a nyers válaszok gyorsítótárazása a `data/.cache` könyvtárba, hogy a
 *    fejlesztés és a hibakeresés ne terhelje újra meg újra a forrásoldalt.
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { RawSource } from './types';

/**
 * CSAK ASCII karakter kerülhet bele: a HTTP-fejlécek ByteString-ek, és egy
 * ékezetes betűtől a `fetch` már a kérés összeállításakor kivételt dob.
 */
export const USER_AGENT =
  'UszodaTracker/0.1 (Budapest swimming pool lane-schedule collector; non-commercial; contact: uszoda-tracker@example.com)';

/** Egyetlen kérés maximális ideje. */
export const REQUEST_TIMEOUT_MS = 20_000;

/** Kötelező minimális szünet két kérés között UGYANAHHOZ a hoszthoz. */
export const MIN_HOST_DELAY_MS = 1_000;

/** Ennél régebbi gyorsítótár-bejegyzést már nem használunk fel. */
export const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

/** A gyorsítótár helye a projekt gyökeréhez képest. */
export const CACHE_DIR = path.join(process.cwd(), 'data', '.cache');

/** `USZODA_SCRAPE_NO_CACHE=1` esetén mindig a hálózatról olvasunk. */
function cacheDisabled(): boolean {
  return process.env.USZODA_SCRAPE_NO_CACHE === '1';
}

// ---------------------------------------------------------------------------
// Proxy
// ---------------------------------------------------------------------------
//
// Miért kell ez külön: a `curl` magától figyelembe veszi a `http_proxy` /
// `https_proxy` környezeti változókat, a Node beépített `fetch`-e viszont NEM.
// Olyan környezetben (céges hálózat, WSL, CI), ahol csak proxyn át van kijárat,
// a scraper ettől `fetch failed … ENOTFOUND` hibát kap, és könnyű téves
// következtetésre jutni belőle: hogy az adott uszoda oldala halott vagy tilt
// minket, pedig csak a proxyt hagytuk ki. (Pontosan ez történt az Újhegyi
// adapter első futtatásakor.)
//
// Ezért ha van proxy a környezetben, az `undici` `ProxyAgent`-jén keresztül
// megyünk ki. Ha az `undici` nem elérhető, visszaesünk a beépített `fetch`-re —
// proxy nélküli gépen ez a kód teljesen hatástalan.

/** Egy hoszt kivétel-e a proxy alól a `no_proxy` szerint. */
export function bypassesProxy(host: string, noProxy: string | undefined): boolean {
  if (!noProxy) return false;
  const target = host.toLowerCase();

  return noProxy
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry !== '')
    .some((entry) => {
      if (entry === '*') return true;
      // `172.*` alakú minta.
      if (entry.endsWith('*')) return target.startsWith(entry.slice(0, -1));
      // `.example.com` és `example.com` egyaránt illeszkedjen az aldomainekre.
      const bare = entry.startsWith('.') ? entry.slice(1) : entry;
      return target === bare || target.endsWith(`.${bare}`);
    });
}

/** A kérésre érvényes proxy URL-je, vagy `null`, ha közvetlenül megyünk. */
export function proxyForUrl(url: string): string | null {
  const parsed = new URL(url);
  if (bypassesProxy(parsed.hostname, process.env.no_proxy ?? process.env.NO_PROXY)) {
    return null;
  }

  const candidate =
    parsed.protocol === 'https:'
      ? process.env.https_proxy ?? process.env.HTTPS_PROXY
      : process.env.http_proxy ?? process.env.HTTP_PROXY;

  const fallback = process.env.all_proxy ?? process.env.ALL_PROXY;
  const chosen = candidate ?? fallback;
  return chosen && chosen.trim() !== '' ? chosen.trim() : null;
}

/**
 * Proxy-ügynökök proxy-URL szerint gyorsítótárazva: egy `ProxyAgent` több
 * kérést is kiszolgál, és kapcsolatokat tart életben.
 */
const proxyAgents = new Map<string, unknown>();
let undiciModule: typeof import('undici') | null | undefined;

async function loadUndici(): Promise<typeof import('undici') | null> {
  if (undiciModule !== undefined) return undiciModule;
  try {
    undiciModule = await import('undici');
  } catch {
    undiciModule = null;
  }
  return undiciModule;
}

/**
 * A `fetch` egyetlen belépési pontja: proxyn át, ha a környezet azt kéri.
 * A visszaadott válasz a szabványos `Response` felületét nyújtja.
 */
async function httpFetch(url: string, init: RequestInit): Promise<Response> {
  const proxyUrl = proxyForUrl(url);
  if (!proxyUrl) return fetch(url, init);

  const undici = await loadUndici();
  if (!undici) return fetch(url, init);

  let agent = proxyAgents.get(proxyUrl);
  if (!agent) {
    agent = new undici.ProxyAgent(proxyUrl);
    proxyAgents.set(proxyUrl, agent);
  }

  // Az `undici` saját `fetch`-ét hívjuk, mert a beépített `fetch` a Node BELSŐ
  // undici-példányát használja, és nem fogadja el egy másik példány ügynökét.
  const response = await undici.fetch(url, {
    ...(init as Parameters<typeof undici.fetch>[1]),
    dispatcher: agent as Parameters<typeof undici.fetch>[1] extends { dispatcher?: infer D }
      ? D
      : never,
  });
  return response as unknown as Response;
}

// ---------------------------------------------------------------------------
// Hosztonkénti késleltetés
// ---------------------------------------------------------------------------

const lastRequestAt = new Map<string, number>();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Megvárja, amíg letelik a hoszthoz tartozó kötelező szünet. */
async function waitForHost(host: string): Promise<void> {
  const previous = lastRequestAt.get(host);
  if (previous !== undefined) {
    const elapsed = Date.now() - previous;
    if (elapsed < MIN_HOST_DELAY_MS) await sleep(MIN_HOST_DELAY_MS - elapsed);
  }
  lastRequestAt.set(host, Date.now());
}

// ---------------------------------------------------------------------------
// Gyorsítótár
// ---------------------------------------------------------------------------

interface CacheMeta {
  url: string;
  contentType: string;
  fetchedAt: string;
}

function cacheKey(url: string): string {
  return createHash('sha1').update(url).digest('hex').slice(0, 16);
}

async function readCache(url: string): Promise<RawSource | null> {
  if (cacheDisabled()) return null;
  const key = cacheKey(url);
  try {
    const meta = JSON.parse(
      await readFile(path.join(CACHE_DIR, `${key}.json`), 'utf8'),
    ) as CacheMeta;
    if (Date.now() - Date.parse(meta.fetchedAt) > CACHE_TTL_MS) return null;
    const body = await readFile(path.join(CACHE_DIR, `${key}.bin`));
    return { url: meta.url, contentType: meta.contentType, body, fetchedAt: meta.fetchedAt, fromCache: true };
  } catch {
    // Nincs találat vagy sérült bejegyzés — egyszerűen letöltjük újra.
    return null;
  }
}

async function writeCache(source: RawSource): Promise<void> {
  const key = cacheKey(source.url);
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    const meta: CacheMeta = {
      url: source.url,
      contentType: source.contentType,
      fetchedAt: source.fetchedAt,
    };
    await writeFile(path.join(CACHE_DIR, `${key}.json`), JSON.stringify(meta, null, 2), 'utf8');
    await writeFile(path.join(CACHE_DIR, `${key}.bin`), source.body);
  } catch {
    // A gyorsítótár csak kényelem: ha nem írható, a futás menjen tovább.
  }
}

// ---------------------------------------------------------------------------
// robots.txt
// ---------------------------------------------------------------------------

const robotsCache = new Map<string, string[]>();

/**
 * A ránk vonatkozó `Disallow` útvonalak kiolvasása.
 * Szándékosan egyszerű: a `User-agent: *` és a nevünkre szóló csoportot vesszük.
 * Ha a robots.txt nem érhető el, MEGENGEDŐEK vagyunk — ez a bevett gyakorlat.
 */
async function disallowedPaths(origin: string): Promise<string[]> {
  const cached = robotsCache.get(origin);
  if (cached) return cached;

  let rules: string[] = [];
  try {
    await waitForHost(new URL(origin).host);
    const response = await httpFetch(`${origin}/robots.txt`, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (response.ok) {
      const text = await response.text();
      let applies = false;
      for (const line of text.split(/\r?\n/)) {
        const clean = line.replace(/#.*$/, '').trim();
        if (clean === '') continue;
        const [rawKey, ...rest] = clean.split(':');
        const key = rawKey.trim().toLowerCase();
        const value = rest.join(':').trim();
        if (key === 'user-agent') {
          applies = value === '*' || USER_AGENT.toLowerCase().startsWith(value.toLowerCase());
        } else if (key === 'disallow' && applies && value !== '') {
          rules.push(value);
        }
      }
    }
  } catch {
    rules = [];
  }

  robotsCache.set(origin, rules);
  return rules;
}

/** Igaz, ha a robots.txt szerint lekérhetjük az URL-t. */
export async function robotsAllows(url: string): Promise<boolean> {
  const parsed = new URL(url);
  const rules = await disallowedPaths(parsed.origin);
  const pathname = parsed.pathname;
  return !rules.some((rule) => (rule === '/' ? true : pathname.startsWith(rule)));
}

// ---------------------------------------------------------------------------
// Letöltés
// ---------------------------------------------------------------------------

export interface FetchOptions {
  /** `true` esetén a robots.txt ellenőrzését kihagyjuk (pl. tesztekben). */
  skipRobots?: boolean;
  /** Extra HTTP fejlécek. */
  headers?: Record<string, string>;
}

/**
 * Egy URL udvarias letöltése, gyorsítótárral.
 * Hiba esetén DOB — a hívó adapter így nem tud véletlenül üres sikert jelenteni.
 */
export async function fetchRaw(url: string, options: FetchOptions = {}): Promise<RawSource> {
  const cached = await readCache(url);
  if (cached) return cached;

  if (!options.skipRobots && !(await robotsAllows(url))) {
    throw new Error(`A robots.txt tiltja a lekérést: ${url}`);
  }

  const host = new URL(url).host;
  await waitForHost(host);

  let response: Response;
  try {
    response = await httpFetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: '*/*', ...options.headers },
      redirect: 'follow',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Hálózati hiba (${url}): ${reason}`);
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText} — ${url}`);
  }

  const source: RawSource = {
    url: response.url || url,
    contentType: (response.headers.get('content-type') ?? '').toLowerCase(),
    body: Buffer.from(await response.arrayBuffer()),
    fetchedAt: new Date().toISOString(),
    fromCache: false,
  };

  await writeCache(source);
  return source;
}

/** A nyers törzs szövegként. Az `utf8` a magyar oldalakon a gyakorlati alapeset. */
export function asText(source: RawSource, encoding: BufferEncoding = 'utf8'): string {
  return source.body.toString(encoding);
}
