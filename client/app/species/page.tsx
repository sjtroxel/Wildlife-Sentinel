'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import type { SpeciesListItem, IUCNStatus } from '@wildlife-sentinel/shared/types';

const IUCN_BADGE: Record<IUCNStatus, string> = {
  EX: 'bg-zinc-900 text-zinc-400 border border-zinc-700',
  EW: 'bg-zinc-800 text-zinc-400 border border-zinc-600',
  CR: 'bg-red-900/60 text-red-300 border border-red-800',
  EN: 'bg-orange-900/60 text-orange-300 border border-orange-800',
  VU: 'bg-amber-900/60 text-amber-300 border border-amber-800',
  NT: 'bg-yellow-900/40 text-yellow-400 border border-yellow-800',
  LC: 'bg-green-900/40 text-green-400 border border-green-800',
};

const IUCN_LABEL: Record<IUCNStatus, string> = {
  EX: 'Extinct',
  EW: 'Extinct in Wild',
  CR: 'Critically Endangered',
  EN: 'Endangered',
  VU: 'Vulnerable',
  NT: 'Near Threatened',
  LC: 'Least Concern',
};

const PAGE_SIZE = 50;

function SkeletonCard() {
  return (
    <div className="bg-zinc-900 dark:bg-zinc-900 rounded-lg p-4 space-y-2 animate-pulse">
      <div className="h-3 bg-zinc-800 rounded w-3/4" />
      <div className="h-2.5 bg-zinc-800 rounded w-1/2" />
      <div className="h-5 bg-zinc-800 rounded w-1/4 mt-1" />
    </div>
  );
}

export default function SpeciesIndex() {
  const [species, setSpecies] = useState<SpeciesListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);

  const load = useCallback(async (nextOffset: number, replace: boolean) => {
    if (nextOffset === 0) setLoading(true); else setLoadingMore(true);
    try {
      const rows = await api.getSpeciesList(PAGE_SIZE, nextOffset);
      setSpecies((prev) => replace ? rows : [...prev, ...rows]);
      setOffset(nextOffset + rows.length);
      setHasMore(rows.length === PAGE_SIZE);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => { void load(0, true); }, [load]);

  return (
    <div className="min-h-screen bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-200">
      <div className="max-w-6xl mx-auto p-4 md:p-8">

        {/* Header */}
        <div className="flex items-center gap-3 mb-6 flex-wrap">
          <Link href="/" className="text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors">
            ← Dashboard
          </Link>
          <span className="text-zinc-300 dark:text-zinc-700">·</span>
          <h1 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Species Database</h1>
          {!loading && (
            <span className="text-xs text-zinc-500">
              {offset} loaded
            </span>
          )}
        </div>

        <p className="text-xs text-zinc-500 dark:text-zinc-500 mb-6">
          All species in Wildlife Sentinel's monitoring range, ordered by IUCN threat status.
          Click any species to see its habitat range and recent alerts.
        </p>

        {/* Grid */}
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {Array.from({ length: 12 }).map((_, i) => <SkeletonCard key={i} />)}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {species.map((s) => (
                <Link
                  key={s.slug}
                  href={`/species/${s.slug}`}
                  className="bg-zinc-50 dark:bg-zinc-900 rounded-lg p-4 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors group"
                >
                  <p className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 leading-snug group-hover:text-green-700 dark:group-hover:text-green-400 transition-colors">
                    {s.common_name ?? s.species_name}
                  </p>
                  {s.common_name && (
                    <p className="text-[10px] text-zinc-500 italic mt-0.5">{s.species_name}</p>
                  )}
                  <span className={`inline-block mt-2 text-[10px] font-semibold px-1.5 py-0.5 rounded ${IUCN_BADGE[s.iucn_status] ?? 'bg-zinc-800 text-zinc-400'}`}>
                    {s.iucn_status} · {IUCN_LABEL[s.iucn_status] ?? s.iucn_status}
                  </span>
                </Link>
              ))}
            </div>

            {hasMore && (
              <div className="mt-6 flex justify-center">
                <button
                  onClick={() => void load(offset, false)}
                  disabled={loadingMore}
                  className="text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 border border-zinc-300 dark:border-zinc-700 rounded-md px-4 py-2 transition-colors disabled:opacity-50"
                >
                  {loadingMore ? 'Loading...' : 'Load more'}
                </button>
              </div>
            )}

            {species.length === 0 && (
              <p className="text-sm text-zinc-500 text-center py-12">No species found.</p>
            )}
          </>
        )}

        {/* Footer */}
        <div className="mt-8 pt-4 border-t border-zinc-200 dark:border-zinc-800">
          <span className="text-[10px] text-zinc-400 dark:text-zinc-700">
            Wildlife Sentinel · Species data: IUCN Red List / GBIF
          </span>
        </div>
      </div>
    </div>
  );
}
