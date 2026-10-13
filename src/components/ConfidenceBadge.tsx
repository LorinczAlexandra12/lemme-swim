import type { Confidence, IsoDate } from '@/lib/types';
import { CONFIDENCE_TONE } from '@/lib/ui/labels';
import { formatHuDateShort } from '@/lib/ui/format';

interface ConfidenceBadgeProps {
  confidence: Confidence;
  /** Csak `verified` esetén jelenik meg a dátum. */
  lastVerified?: IsoDate;
}

const TONE_CLASS: Record<Confidence, string> = {
  live: 'bg-live-bg text-live',
  verified: 'bg-quiet-bg text-quiet',
  stale: 'bg-amber-bg text-amber ring-1 ring-inset ring-amber-line',
  unknown: 'bg-quiet-bg text-quiet',
};

/**
 * Az adat frissességét mindig kimondjuk. Ez nem dísz: a felhasználó
 * ez alapján dönti el, elhiszi-e a sávszámot.
 */
export function ConfidenceBadge({ confidence, lastVerified }: ConfidenceBadgeProps) {
  const tone = CONFIDENCE_TONE[confidence];
  const text =
    confidence === 'verified' && lastVerified
      ? `${tone.label} · ${formatHuDateShort(lastVerified)}`
      : tone.label;

  return (
    <span
      title={tone.help}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${TONE_CLASS[confidence]}`}
    >
      {confidence === 'live' && (
        <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
      )}
      {confidence === 'stale' && (
        <svg
          aria-hidden="true"
          viewBox="0 0 16 16"
          className="h-3.5 w-3.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
        >
          <circle cx="8" cy="8" r="6.2" />
          <path d="M8 4.6v3.6l2.2 1.4" strokeLinecap="round" />
        </svg>
      )}
      {text}
      <span className="sr-only-text">. {tone.help}</span>
    </span>
  );
}
