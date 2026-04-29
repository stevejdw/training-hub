import type { ReactNode } from 'react';

/** Consistent page header used at the top of every top-level screen.
 *  Renders an icon (orange) + title and a subtle bottom border. Sized so it
 *  looks the same on mobile and desktop. */
export default function PageHeader({
  icon,
  title,
  right,
}: {
  icon: ReactNode;
  title: string;
  /** Optional right-side actions (links/buttons). */
  right?: ReactNode;
}) {
  return (
    <div className="flex-shrink-0 flex items-center gap-2.5 px-4 md:px-8 py-3 md:py-4 border-b border-gray-800 bg-gray-950">
      <span className="text-orange-400 [&_svg]:w-6 [&_svg]:h-6 md:[&_svg]:w-7 md:[&_svg]:h-7 flex-shrink-0">
        {icon}
      </span>
      <h1 className="text-lg md:text-xl font-bold text-white tracking-tight flex-1 truncate">
        {title}
      </h1>
      {right}
    </div>
  );
}
