'use client';

/** Shown where a failed fetch previously rendered an empty grid or a page of
 *  em-dashes with no indication anything had gone wrong. */
export default function ErrorState({
  message = 'Could not load this data.',
  onRetry,
  className = '',
}: {
  message?: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div className={`flex flex-col items-center justify-center gap-2 py-8 text-center ${className}`}>
      <svg className="w-5 h-5 text-ink-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
      </svg>
      <p className="text-xs text-ink-3">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="text-xs text-accent hover:text-accent-hi underline underline-offset-2 transition-colors"
        >
          Try again
        </button>
      )}
    </div>
  );
}
