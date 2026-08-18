'use client';

/** Save feedback for the profile editor pages.
 *
 *  useProfileEdit() has always exposed `error`, but none of its consumers
 *  rendered it — a failed PUT left the button back at idle with no sign that
 *  nothing had been saved. This is the shared surface for that state. */
export default function SaveStatus({
  saving,
  saved,
  error,
  onRetry,
}: {
  saving?: boolean;
  saved?: boolean;
  error?: string | null;
  onRetry?: () => void;
}) {
  if (error) {
    return (
      <span className="inline-flex items-center gap-2 text-xs text-red-400">
        <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
        </svg>
        <span>Not saved</span>
        {onRetry && (
          <button
            onClick={onRetry}
            className="underline underline-offset-2 hover:text-red-300 transition-colors"
          >
            Retry
          </button>
        )}
      </span>
    );
  }
  if (saving) return <span className="text-xs text-gray-500">Saving…</span>;
  if (saved)  return <span className="text-xs text-green-400">Saved ✓</span>;
  return null;
}
