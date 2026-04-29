import type { Charity } from '@wildlife-sentinel/shared/types';

interface CharityCardProps {
  charity: Charity;
  compact?: boolean;
}

export default function CharityCard({ charity, compact = false }: CharityCardProps) {
  const stars = charity.charity_navigator_rating;

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <a
          href={charity.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm font-semibold text-white hover:text-green-400 transition-colors"
        >
          {charity.name}
        </a>
        {stars !== null && (
          <span className="text-[10px] text-yellow-400 shrink-0" title={`${stars}/4 Charity Navigator`}>
            {'★'.repeat(stars)}{'☆'.repeat(4 - stars)}
          </span>
        )}
      </div>

      {!compact && (
        <p className="text-[11px] text-zinc-400 leading-relaxed">{charity.description}</p>
      )}

      {charity.focus_regions.length > 0 && !compact && (
        <p className="text-[10px] text-zinc-600">{charity.focus_regions.join(' · ')}</p>
      )}

      <a
        href={charity.donation_url}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-auto inline-block text-center text-xs font-semibold
          bg-green-700 hover:bg-green-600 text-white rounded px-3 py-1.5
          transition-colors"
      >
        Donate Now →
      </a>
    </div>
  );
}
