import type { BasinAvailability, OpeningHours } from '@/lib/types';
import { LaneMeter } from './LaneMeter';
import { ConfidenceBadge } from './ConfidenceBadge';
import { BLOCK_KIND_LABEL } from '@/lib/ui/labels';
import { formatLaneCount, formatRange } from '@/lib/ui/format';

interface BasinCardProps {
  availability: BasinAvailability;
  /** A kért napra érvényes nyitvatartás — akkor kell, ha nincs sávadatunk. */
  dayHours: OpeningHours[];
  /** Az uszoda saját beosztásának URL-je, ha van. */
  sourceUrl?: string;
  lastVerified?: string;
  animate?: boolean;
}

function basinMeta(a: BasinAvailability): string {
  const parts: string[] = [`${a.basin.lengthM} m`];
  parts.push(a.basin.indoor ? 'fedett' : 'szabadtéri');
  if (typeof a.basin.waterTempC === 'number') {
    parts.push(`${String(a.basin.waterTempC).replace('.', ',')} °C`);
  }
  return parts.join(', ');
}

function openingText(dayHours: OpeningHours[]): string | null {
  if (dayHours.length === 0) return null;
  return dayHours.map((h) => formatRange(h.opens, h.closes)).join(' és ');
}

function SourceLink({ url }: { url?: string }) {
  if (!url) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer noopener"
      className="inline-flex items-center gap-1 font-semibold text-pool underline decoration-pool/35 underline-offset-2 hover:decoration-pool"
    >
      Forrás
      <svg aria-hidden="true" viewBox="0 0 16 16" className="h-3 w-3" fill="currentColor">
        <path d="M6 2h8v8h-2V5.4L6.7 10.7 5.3 9.3 10.6 4H6V2Z" />
        <path d="M2 4h3v2H4v6h6v-1h2v3H2V4Z" />
      </svg>
    </a>
  );
}

/**
 * Egy medence állapota a kért idősávban.
 *
 * Három, egymást kizáró állapot — soha nem mutatunk sávszámot olyankor,
 * amikor nem tudjuk hitelesen:
 *  1. zárva a kért időpontban,
 *  2. nincs sávbeosztásunk (`unknown`) — csak nyitvatartás és forráslink,
 *  3. van sávadatunk — sávmérő, pontos szám és frissességi címke.
 *
 * „Zárva" csak akkor jelenik meg, ha VAN nyitvatartási adatunk az adott napra,
 * és az nem fedi a kért idősávot. Ha az uszoda egyszerűen nem publikálta az
 * adott napot, azt külön sávban bevalljuk — a magabiztosan téves „Zárva"
 * elküldené a felhasználót egy nyitva lévő uszoda elől.
 */
export function BasinCard({
  availability,
  dayHours,
  sourceUrl,
  lastVerified,
  animate,
}: BasinCardProps) {
  const { basin, totalLanes, freeLanes, blocks, openThroughout, openingHoursKnown, confidence } =
    availability;
  const hours = openingText(dayHours);
  const closed = openingHoursKnown && !openThroughout;
  const noLaneData = confidence === 'unknown' || freeLanes === null || totalLanes === null;

  return (
    <li className="border-t border-line pt-4 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h4 className="text-[0.95rem] font-semibold leading-snug text-ink">{basin.name}</h4>
        <p className="text-xs text-ink-3 tnum">{basinMeta(availability)}</p>
      </div>

      {basin.seasonNote && (
        <p className="mt-1 text-xs text-ink-3">Szezon: {basin.seasonNote}</p>
      )}

      {!openingHoursKnown && (
        <p className="mt-2 rounded-lg bg-surface-2 px-3 py-2 text-xs text-ink-2 ring-1 ring-inset ring-line">
          Erre a napra nincs nyitvatartási adatunk, ezért azt sem tudjuk, hogy nyitva van-e.
          Indulás előtt ellenőrizd az uszodánál.
        </p>
      )}

      {closed ? (
        <div className="mt-3 rounded-lg bg-amber-bg px-3 py-2.5 ring-1 ring-inset ring-amber-line">
          <p className="text-sm font-semibold text-amber">Zárva a kért időpontban</p>
          <p className="mt-0.5 text-xs text-amber/85">
            {hours ? `Aznap ${hours} között tart nyitva.` : 'Erre a napra nincs nyitvatartásunk.'}
          </p>
          {sourceUrl && (
            <p className="mt-1.5 text-xs">
              <SourceLink url={sourceUrl} />
            </p>
          )}
        </div>
      ) : noLaneData ? (
        <div className="mt-3 rounded-lg bg-surface-2 px-3 py-2.5 ring-1 ring-inset ring-line">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold text-ink-2">Nincs sávadat</p>
            <ConfidenceBadge confidence="unknown" />
          </div>
          <p className="mt-1 text-xs text-ink-3">
            {hours
              ? `Erről a medencéről csak nyitvatartásunk van: ${hours}.`
              : 'Erről a medencéről nincs adatunk.'}{' '}
            Hány sáv szabad, azt itt nem tudjuk megmondani.
          </p>
          {sourceUrl && (
            <p className="mt-1.5 text-xs text-ink-3">
              Nézd meg az uszoda saját beosztását: <SourceLink url={sourceUrl} />
            </p>
          )}
        </div>
      ) : (
        <div className="mt-3 flex items-stretch gap-3.5">
          <div className="w-28 shrink-0 sm:w-36">
            <LaneMeter totalLanes={totalLanes} freeLanes={freeLanes} animate={animate} />
          </div>
          <div className="flex min-w-0 flex-1 flex-col justify-between gap-2">
            <p className="text-base font-semibold leading-tight text-ink tnum">
              <span className="text-2xl leading-none text-pool">{freeLanes}</span>
              <span className="text-ink-3"> / {totalLanes}</span>
              <span className="block text-xs font-medium text-ink-2">
                {freeLanes === 0
                  ? 'sáv szabad — a teljes idősáv foglalt'
                  : 'sáv szabad a teljes idősávban'}
              </span>
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <ConfidenceBadge confidence={confidence} lastVerified={lastVerified} />
              {sourceUrl && <SourceLink url={sourceUrl} />}
            </div>
          </div>
        </div>
      )}

      {!closed && !noLaneData && blocks.length > 0 && (
        <details className="group mt-2.5">
          <summary className="cursor-pointer list-none py-1 text-xs font-semibold text-ink-2 hover:text-pool">
            <span className="underline decoration-dotted underline-offset-2">
              Mi foglalja a sávokat? ({blocks.length})
            </span>
          </summary>
          <ul className="mt-1.5 space-y-1 text-xs text-ink-2">
            {blocks.map((b, i) => (
              <li key={`${b.basinId}-${b.start}-${i}`} className="flex gap-2">
                <span className="tnum shrink-0 tabular-nums text-ink-3">
                  {formatRange(b.start, b.end)}
                </span>
                <span className="min-w-0">
                  {b.reason || BLOCK_KIND_LABEL[b.kind]}
                  <span className="text-ink-3"> ({b.lanesOccupied} sáv)</span>
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}

      <p className="sr-only-text">
        {basin.name}:{' '}
        {closed
          ? 'zárva a kért időpontban'
          : !openingHoursKnown
            ? 'erre a napra nincs nyitvatartási adatunk'
            : formatLaneCount(freeLanes, totalLanes)}
        .
      </p>
    </li>
  );
}
