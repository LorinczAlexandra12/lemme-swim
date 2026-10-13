import { describe, expect, it } from 'vitest';
import { formatDistanceHu, haversineKm } from '../geo';

// Valódi budapesti referenciapontok.
const KOMJADI = { lat: 47.5194, lon: 19.0389 }; // Császár-Komjádi uszoda
const GELLERT = { lat: 47.4831, lon: 19.052 }; // Gellért fürdő
const HAJOS_ALFRED = { lat: 47.5266, lon: 19.0476 }; // Margitszigeti Hajós Alfréd

describe('haversineKm', () => {
  it('egy fok szélességkülönbség kb. 111,2 km', () => {
    const km = haversineKm({ lat: 47, lon: 19 }, { lat: 48, lon: 19 });
    expect(km).toBeCloseTo(111.19, 1);
  });

  it('ismert budapesti párra helyes távolságot ad', () => {
    // Komjádi (II. ker.) és a Gellért fürdő (XI. ker.) légvonalban ~4,1 km.
    const km = haversineKm(KOMJADI, GELLERT);
    expect(km).toBeGreaterThan(4.0);
    expect(km).toBeLessThan(4.3);
  });

  it('közeli budapesti párra kevesebb mint egy kilométert ad', () => {
    // Komjádi és a Hajós Alfréd uszoda gyakorlatilag szomszédok.
    const km = haversineKm(KOMJADI, HAJOS_ALFRED);
    expect(km).toBeGreaterThan(0.5);
    expect(km).toBeLessThan(1.2);
  });

  it('szimmetrikus', () => {
    expect(haversineKm(KOMJADI, GELLERT)).toBeCloseTo(haversineKm(GELLERT, KOMJADI), 10);
  });

  it('azonos pontra nulla', () => {
    expect(haversineKm(KOMJADI, { ...KOMJADI })).toBeCloseTo(0, 9);
  });

  it('érvénytelen koordinátára NaN', () => {
    expect(haversineKm({ lat: Number.NaN, lon: 19 }, GELLERT)).toBeNaN();
    expect(
      haversineKm(KOMJADI, { lat: 47, lon: Number.POSITIVE_INFINITY }),
    ).toBeNaN();
  });
});

describe('formatDistanceHu', () => {
  it('egy kilométer alatt méterben, tízesre kerekítve', () => {
    expect(formatDistanceHu(0.65)).toBe('650 m');
    expect(formatDistanceHu(0.6543)).toBe('650 m');
    expect(formatDistanceHu(0.123)).toBe('120 m');
    expect(formatDistanceHu(0.126)).toBe('130 m');
    expect(formatDistanceHu(0)).toBe('0 m');
  });

  it('egy kilométer fölött tizedesvesszővel, egy tizedesjeggyel', () => {
    expect(formatDistanceHu(2.3)).toBe('2,3 km');
    expect(formatDistanceHu(2.34)).toBe('2,3 km');
    expect(formatDistanceHu(2.35)).toBe('2,4 km');
    expect(formatDistanceHu(1)).toBe('1,0 km');
    expect(formatDistanceHu(12.05)).toBe('12,1 km');
  });

  it('sosem használ tizedespontot', () => {
    expect(formatDistanceHu(4.155)).not.toContain('.');
  });

  it('a 999,7 m-t nem "1000 m"-ként, hanem "1,0 km"-ként írja ki', () => {
    expect(formatDistanceHu(0.9997)).toBe('1,0 km');
  });

  it('érvénytelen bemenetre magyar szöveget ad', () => {
    expect(formatDistanceHu(Number.NaN)).toBe('ismeretlen távolság');
  });
});
