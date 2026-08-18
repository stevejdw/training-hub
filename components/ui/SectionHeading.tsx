/** The uppercase label heading. Previously four competing size/weight/colour
 *  combinations for the same visual role. */
export default function SectionHeading({
  title,
  subtitle,
  className = '',
}: {
  title: string;
  subtitle?: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <h2 className="text-xs font-semibold text-ink-3 uppercase tracking-wider">{title}</h2>
      {subtitle && <p className="text-mini text-ink-4 mt-0.5">{subtitle}</p>}
    </div>
  );
}
