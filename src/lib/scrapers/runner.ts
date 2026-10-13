/**
 * Adapter-futtató.
 *
 * Feladata mindössze három dolog, de azokat szigorúan:
 *  1. MINDEN adapter lefusson — egy hibás forrásoldal nem rúghatja szét a futást.
 *  2. Minden eredmény kapjon `scrapedAt` időbélyeget és összegyűjtött `warnings`-t.
 *  3. Az ÜRES EREDMÉNY HIBA. Ha egy adapter nulla sávfoglalást ad vissza, azt
 *     `ok: false`-ként jelentjük: sokkal jobb tudni, hogy elromlott, mint azt
 *     hinni, hogy az uszoda minden sávja szabad.
 */

import type { LaneBlock, ScrapeResult } from '../types';
import type { Adapter, ParseContext } from './types';
import { listAdapters } from './types';

export interface RunOptions {
  /** Csak ezek az adapter-azonosítók fussanak. Üres/hiányzó esetén mind. */
  only?: string[];
  /** Haladásjelző — a CLI köti be, a tesztek nem. */
  onProgress?: (adapter: Adapter) => void;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/** Egyetlen adapter végigfuttatása. Sosem dob: a hibát eredménybe csomagolja. */
export async function runAdapter(adapter: Adapter): Promise<ScrapeResult> {
  const warnings: string[] = [];
  const context: ParseContext = { warn: (message) => warnings.push(message) };
  const base = { poolId: adapter.poolId, adapter: adapter.id, scrapedAt: new Date().toISOString() };

  let blocks: LaneBlock[];
  try {
    const raw = await adapter.fetch();
    blocks = adapter.parse(raw, context);
  } catch (error) {
    return {
      ...base,
      ok: false,
      blocks: [],
      error: errorMessage(error),
      ...(warnings.length > 0 ? { warnings } : {}),
    };
  }

  if (blocks.length === 0) {
    // Nem „minden szabad”, hanem „nem értettük meg a forrást”.
    return {
      ...base,
      ok: false,
      blocks: [],
      error:
        'Az adapter egyetlen sávfoglalást sem tudott kiolvasni — valószínűleg megváltozott a forrás formátuma.',
      ...(warnings.length > 0 ? { warnings } : {}),
    };
  }

  return { ...base, ok: true, blocks, ...(warnings.length > 0 ? { warnings } : {}) };
}

/** A nyilvántartott adapterek futtatása, egymás után (hogy udvariasak maradjunk). */
export async function runAdapters(options: RunOptions = {}): Promise<ScrapeResult[]> {
  const selected = listAdapters().filter(
    (adapter) => !options.only || options.only.length === 0 || options.only.includes(adapter.id),
  );

  const results: ScrapeResult[] = [];
  for (const adapter of selected) {
    options.onProgress?.(adapter);
    results.push(await runAdapter(adapter));
  }
  return results;
}
