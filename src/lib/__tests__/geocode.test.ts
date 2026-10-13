import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { toHit, toHits } from '@/lib/geocode';

/** Valódi Nominatim válaszok, ahogy a `/api/geocode` megkapja őket. */
function fixture(name: string): unknown {
  return JSON.parse(
    readFileSync(path.join(__dirname, 'fixtures', `nominatim-${name}.json`), 'utf8'),
  );
}

describe('toHits — valódi budapesti válaszokon', () => {
  it('utcát és házszámot magyar sorrendben ad', () => {
    const [first] = toHits(fixture('vaci-utca-12'));
    expect(first.label).toBe('Váci utca 12.');
    expect(first.detail).toBe('V. kerület, Budapest');
  });

  it('a kerületet adja pontosításnak, nem a városrészt', () => {
    // A válaszban a `suburb` "Pest", a `borough` "V. kerület" — az utóbbi hasznos.
    for (const hit of toHits(fixture('vaci-utca-12'))) {
      expect(hit.detail).toBe('V. kerület, Budapest');
    }
  });

  it('az intézmény nevét a cím elé teszi', () => {
    const hits = toHits(fixture('nepfurdo-utca-36'));
    expect(hits[0].label).toBe('Duna Aréna, Népfürdő utca 36.');
    expect(hits[0].detail).toBe('XIII. kerület, Budapest');
  });

  it('használható koordinátát ad vissza Budapest területén', () => {
    for (const name of ['vaci-utca-12', 'hungaria-korut-31', 'szechenyi-furdo']) {
      for (const hit of toHits(fixture(name))) {
        expect(hit.lat).toBeGreaterThan(47.3);
        expect(hit.lat).toBeLessThan(47.7);
        expect(hit.lon).toBeGreaterThan(18.8);
        expect(hit.lon).toBeLessThan(19.4);
      }
    }
  });

  it('nem mutat két egyforma feliratú találatot', () => {
    // A "Hungária körút 31" négy utcaszakaszt hoz, mind azonos felirattal.
    const hits = toHits(fixture('hungaria-korut-31'));
    const labels = hits.map((h) => `${h.label}|${h.detail}`);
    expect(new Set(labels).size).toBe(labels.length);
    expect(hits.length).toBeLessThan(4);
  });

  it('minden találatnak van felirata és azonosítója', () => {
    for (const name of ['vaci-utca-12', 'hungaria-korut-31', 'szechenyi-furdo', 'nepfurdo-utca-36']) {
      const hits = toHits(fixture(name));
      expect(hits.length).toBeGreaterThan(0);
      for (const hit of hits) {
        expect(hit.label).not.toBe('');
        expect(hit.detail).not.toBe('');
        expect(hit.id).not.toBe('');
      }
    }
  });
});

describe('toHit — hiányos adatokon', () => {
  it('koordináta nélküli elemet kihagy', () => {
    expect(toHit({ display_name: 'Valahol' })).toBeNull();
    expect(toHit({ lat: 'nem-szam', lon: '19.0' })).toBeNull();
  });

  it('üres `name` mezőt nem ír a felirat elé', () => {
    const hit = toHit({
      lat: '47.5',
      lon: '19.0',
      name: '   ',
      address: { road: 'Fő utca', house_number: '3', borough: 'I. kerület', city: 'Budapest' },
    });
    expect(hit?.label).toBe('Fő utca 3.');
  });

  it('házszám nélkül csak az utcanevet adja', () => {
    const hit = toHit({
      lat: '47.5',
      lon: '19.0',
      address: { road: 'Hungária körút', borough: 'XIV. kerület', city: 'Budapest' },
    });
    expect(hit?.label).toBe('Hungária körút');
    expect(hit?.detail).toBe('XIV. kerület, Budapest');
  });

  it('cím nélkül a `display_name` első tagjára esik vissza', () => {
    const hit = toHit({ lat: '47.5', lon: '19.0', display_name: 'Margitsziget, Budapest' });
    expect(hit?.label).toBe('Margitsziget');
    expect(hit?.detail).toBe('Budapest');
  });

  it('nem tömb bemenetre üres listát ad', () => {
    expect(toHits(null)).toEqual([]);
    expect(toHits({ error: 'nope' })).toEqual([]);
  });
});
