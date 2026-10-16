import type { IsoDate, PoolAvailability, Weekday } from '@/lib/types';
import { BasinCard } from './BasinCard';
import { formatDistance, weekdayOf } from '@/lib/ui/format';

interface PoolCardProps {
  result: PoolAvailability;
  /** A keresett nap — ebből választjuk ki a nyitvatartási sort. */
  date: IsoDate;
  /** Az első néhány kártya sávjai animálva telnek be. */
  animate?: boolean;
}

export function PoolCard({ result, date, animate }: PoolCardProps) {
  const { pool, distanceKm, basins, totalFreeLanes } = result;
  const weekday = weekdayOf(date) as Weekday;
  const dayHours = pool.openingHours.filter((h) => h.weekday === weekday);
  // Csak akkor „zárva", ha van rá nyitvatartási adatunk. Hiányzó nyitvatartás
  // nem bizonyíték a zárva tartásra — lásd `openingHoursKnown`.
  const allClosed =
    basins.length > 0 && basins.every((b) => b.openingHoursKnown && !b.openThroughout);

  return (
    <li className="overflow-hidden rounded-sm border border-line bg-surface transition-colors hover:border-line-strong">
      <header className="flex items-start justify-between gap-4 px-4 pt-4 sm:px-5 sm:pt-5">
        <div className="min-w-0">
          <h3 className="text-lg font-semibold leading-tight text-ink">
            {pool.name}
          </h3>
          <p className="mt-1 text-sm leading-snug text-ink-2">
            {pool.district && <span className="font-medium">{pool.district} kerület, </span>}
            {pool.address}
          </p>
        </div>
        <p className="max-w-[38%] shrink-0 text-right">
          <span className="block font-mono text-base font-bold text-pool tnum">
            {formatDistance(distanceKm)}
          </span>
          {totalFreeLanes !== null && !allClosed && (
            <span className="mt-0.5 block text-xs font-medium text-ink-3 tnum">
              összesen {totalFreeLanes} szabad sáv
            </span>
          )}
        </p>
      </header>

      <ul className="mt-4 space-y-4 px-4 pb-4 sm:px-5 sm:pb-5">
        {basins.length === 0 ? (
          <li className="rounded-lg bg-surface-2 px-3 py-2.5 text-sm text-ink-2 ring-1 ring-inset ring-line">
            Erről az uszodáról nincs medenceadatunk.
          </li>
        ) : (
          basins.map((b) => (
            <BasinCard
              key={b.basin.id}
              availability={b}
              dayHours={dayHours}
              sourceUrl={pool.scheduleSource.url}
              lastVerified={pool.scheduleSource.lastVerified}
              animate={animate}
            />
          ))
        )}
      </ul>

      {(pool.website || pool.phone) && (
        <footer className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-line bg-surface-2 px-4 py-2.5 text-xs sm:px-5">
          {pool.website && (
            <a
              href={pool.website}
              target="_blank"
              rel="noreferrer noopener"
              className="font-semibold text-pool underline decoration-pool/35 underline-offset-2 hover:decoration-pool"
            >
              Az uszoda honlapja
            </a>
          )}
          {pool.phone && (
            <a
              href={`tel:${pool.phone.replace(/\s/g, '')}`}
              className="font-semibold text-pool underline decoration-pool/35 underline-offset-2 hover:decoration-pool tnum"
            >
              {pool.phone}
            </a>
          )}
        </footer>
      )}
    </li>
  );
}
