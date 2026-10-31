import type { Link } from '../layout/links';

const LABEL = { parent: 'Szülő', partner: 'Pár', child: 'Gyermek' } as const;

/** Explains the colours of the selected person's connection lines (only the kinds present). */
export function LinkLegend({ links }: { links: Link[] }) {
  const kinds = (['parent', 'partner', 'child'] as const).filter((r) => links.some((l) => l.relation === r));
  if (!kinds.length) return null;
  return (
    <div className="link-legend">
      {kinds.map((r) => (
        <span key={r}>
          <i className={`swatch link-${r}`} />
          {LABEL[r]}
        </span>
      ))}
    </div>
  );
}
