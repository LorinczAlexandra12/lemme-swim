import { formatLaneCount } from '@/lib/ui/format';

interface LaneMeterProps {
  totalLanes: number | null;
  freeLanes: number | null;
  /** A találat megérkezésekor egyszer betelnek a sávok. */
  animate?: boolean;
}

/**
 * A medence felülnézeti rajza: minden sor egy felfestett úszósáv.
 * A szabad sávok világítanak, a foglaltak belesüllyednek a vízbe.
 *
 * A grafika a képernyőolvasók elől rejtve van; helyette a szülő elem
 * ad szöveges megfelelőt, illetve az alatta lévő "4 / 8 sáv szabad" felirat.
 */
export function LaneMeter({ totalLanes, freeLanes, animate = false }: LaneMeterProps) {
  if (totalLanes === null || totalLanes <= 0 || freeLanes === null) return null;

  const free = Math.max(0, Math.min(totalLanes, freeLanes));
  const lanes = Array.from({ length: totalLanes }, (_, i) => i < free);

  return (
    <div
      role="img"
      aria-label={formatLaneCount(free, totalLanes)}
      className="flex flex-col gap-[3px] rounded-sm bg-water-well p-[5px] ring-1 ring-inset ring-line"
    >
      {lanes.map((isFree, i) => (
        <span
          key={i}
          className={[
            'block h-2.5 rounded-[2px]',
            isFree ? 'bg-lane-free' : 'bg-lane-occupied',
            animate ? 'lane-anim' : '',
          ].join(' ')}
          style={animate ? { animationDelay: `${Math.min(i, 9) * 35}ms` } : undefined}
        />
      ))}
    </div>
  );
}
