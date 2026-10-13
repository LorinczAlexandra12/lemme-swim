/**
 * A fejléc alját lezáró vízvonal. Az oldal egyetlen díszítő motívuma —
 * egyszer szerepel, sehol máshol.
 */
export function Waterline({ className = '' }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={`block h-4 w-full text-bg ${className}`}
      viewBox="0 0 120 16"
      preserveAspectRatio="none"
      fill="currentColor"
    >
      <path d="M0 8c10 0 10-5 20-5s10 5 20 5 10-5 20-5 10 5 20 5 10-5 20-5 10 5 20 5v11H0V8Z" />
    </svg>
  );
}
