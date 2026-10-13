import { NextResponse } from 'next/server';
import { loadBlocks, loadPools } from '@/lib/data';
import { searchPools } from '@/lib/search';
import type { PoolAvailability, SearchQuery } from '@/lib/types';

export const dynamic = 'force-dynamic';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

type Validated = { ok: true; query: SearchQuery } | { ok: false; error: string };

function toNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function toBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  return undefined;
}

function minutes(time: string): number {
  const [h, m] = time.split(':');
  return Number(h) * 60 + Number(m);
}

/** A bemenet ellenőrzése. Minden hibaüzenet magyar, a felhasználónak szól. */
function validate(raw: Record<string, unknown>): Validated {
  const lat = toNumber(raw.lat);
  const lon = toNumber(raw.lon);

  if (lat === undefined || lon === undefined) {
    return { ok: false, error: 'Hiányzik a kiindulási pont (lat és lon).' };
  }
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return { ok: false, error: 'A megadott koordináta érvénytelen.' };
  }

  const date = typeof raw.date === 'string' ? raw.date : '';
  if (!DATE_RE.test(date) || Number.isNaN(new Date(`${date}T12:00:00`).getTime())) {
    return { ok: false, error: 'A dátum formátuma ÉÉÉÉ-HH-NN legyen, pl. 2026-09-24.' };
  }

  const start = typeof raw.start === 'string' ? raw.start : '';
  const end = typeof raw.end === 'string' ? raw.end : '';
  if (!TIME_RE.test(start) || !TIME_RE.test(end)) {
    return { ok: false, error: 'Az időpont formátuma ÓÓ:PP legyen, pl. 18:30.' };
  }
  if (minutes(end) <= minutes(start)) {
    return { ok: false, error: 'A befejezés legyen később, mint a kezdés.' };
  }

  const query: SearchQuery = { lat, lon, date, start, end };

  if (raw.maxDistanceKm !== undefined && raw.maxDistanceKm !== null) {
    const maxDistanceKm = toNumber(raw.maxDistanceKm);
    if (maxDistanceKm === undefined || maxDistanceKm <= 0) {
      return { ok: false, error: 'A maximális távolság pozitív szám legyen, km-ben.' };
    }
    query.maxDistanceKm = maxDistanceKm;
  }

  if (raw.minFreeLanes !== undefined && raw.minFreeLanes !== null) {
    const minFreeLanes = toNumber(raw.minFreeLanes);
    if (minFreeLanes === undefined || !Number.isInteger(minFreeLanes) || minFreeLanes < 0) {
      return { ok: false, error: 'A minimális szabad sávok száma nemnegatív egész szám legyen.' };
    }
    query.minFreeLanes = minFreeLanes;
  }

  if (raw.indoorOnly !== undefined && raw.indoorOnly !== null) {
    const indoorOnly = toBoolean(raw.indoorOnly);
    if (indoorOnly === undefined) {
      return { ok: false, error: 'A „csak fedett medence” szűrő értéke true vagy false lehet.' };
    }
    query.indoorOnly = indoorOnly;
  }

  return { ok: true, query };
}

async function respond(raw: Record<string, unknown>) {
  const validated = validate(raw);
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }

  try {
    const [pools, blocks] = await Promise.all([loadPools(), loadBlocks()]);
    const results: PoolAvailability[] = await searchPools(pools, blocks, validated.query);
    return NextResponse.json(results, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    console.error('[api/search] a keresés meghiúsult', error);
    return NextResponse.json(
      { error: 'Az uszodaadatokat most nem sikerült betölteni. Próbáld újra kicsit később.' },
      { status: 503 },
    );
  }
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'A kérés törzse nem érvényes JSON.' },
      { status: 400 },
    );
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return NextResponse.json(
      { error: 'A kérés törzse egy JSON objektum legyen.' },
      { status: 400 },
    );
  }
  return respond(body as Record<string, unknown>);
}

/** Kényelmi belépési pont: ugyanaz a lekérdezés query paraméterekkel. */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const raw: Record<string, unknown> = {};
  for (const key of ['lat', 'lon', 'date', 'start', 'end', 'maxDistanceKm', 'minFreeLanes', 'indoorOnly']) {
    const value = params.get(key);
    if (value !== null) raw[key] = value;
  }
  return respond(raw);
}
