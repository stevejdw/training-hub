'use client';

import { useEffect, useRef, type ReactNode } from 'react';

/** Native <dialog> modal, following the pattern already proven in
 *  EnlargeableChart: showModal() gives focus trapping, Escape-to-close and
 *  top-layer stacking for free.
 *
 *  Replaces five hand-rolled `fixed inset-0` modals that trapped no focus,
 *  ignored Escape, and disagreed with each other about backdrop clicks. */
export type ModalSize = 'sm' | 'md' | 'lg';

const SIZES: Record<ModalSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-3xl',
};

export default function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  size = 'md',
  dismissOnBackdrop = true,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: ModalSize;
  dismissOnBackdrop?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dlg = ref.current;
    if (!dlg) return;
    if (open && !dlg.open) dlg.showModal();
    else if (!open && dlg.open) dlg.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={onClose}
      /* The dialog element itself fills the viewport so the ::backdrop and the
         click-outside target line up; the panel is centred inside it. */
      onClick={e => {
        if (!dismissOnBackdrop) return;
        if (e.target === ref.current) onClose();
      }}
      className="m-0 p-0 max-w-none max-h-none w-screen h-screen bg-transparent backdrop:bg-black/70 overflow-hidden"
    >
      {open && (
        <div className="flex h-full w-full items-center justify-center p-4">
          <div
            className={`w-full ${SIZES[size]} max-h-full flex flex-col bg-surface border border-line rounded-2xl shadow-2xl overflow-hidden`}
          >
            {(title || subtitle) && (
              <div className="flex items-start justify-between gap-3 px-5 pt-4 pb-3 border-b border-line flex-shrink-0">
                <div className="min-w-0">
                  {title && <h2 className="text-sm font-semibold text-ink truncate">{title}</h2>}
                  {subtitle && <p className="text-mini text-ink-4 mt-0.5">{subtitle}</p>}
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close"
                  className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg text-ink-3 hover:text-ink hover:bg-raised transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            )}
            <div className="flex-1 min-h-0 overflow-y-auto scroll-touch px-5 py-4">{children}</div>
            {footer && (
              <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-line flex-shrink-0">
                {footer}
              </div>
            )}
          </div>
        </div>
      )}
    </dialog>
  );
}
