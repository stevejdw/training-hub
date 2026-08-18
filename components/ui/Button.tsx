'use client';

import type { ButtonHTMLAttributes, ReactNode } from 'react';

/** The primary button was spelled eight different ways across the app,
 *  including three orderings of the same class list. This is the one. */
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';

const VARIANTS: Record<ButtonVariant, string> = {
  primary:   'bg-accent hover:bg-accent-hi text-accent-fg',
  secondary: 'bg-raised hover:bg-line-strong text-ink-2 border border-line-strong',
  ghost:     'text-ink-3 hover:text-ink hover:bg-raised',
  danger:    'bg-raised hover:bg-red-500/15 text-red-400 border border-line-strong hover:border-red-500/50',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'px-3 py-1.5 text-xs',
  md: 'px-4 py-2 text-sm',
};

export default function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  children,
  ...rest
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children: ReactNode;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      className={`rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed
        focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent
        ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
    >
      {children}
    </button>
  );
}
