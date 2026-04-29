'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import CharityCard from '@/components/CharityCard';
import Copyright from '@/components/Copyright';
import { api } from '@/lib/api';
import type { Charity } from '@wildlife-sentinel/shared/types';

export default function CharitiesPage() {
  const [charities, setCharities] = useState<Charity[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getAllCharities()
      .then(setCharities)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="min-h-screen bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100">
      <div className="max-w-5xl mx-auto p-4 md:p-8 space-y-6">

        {/* Breadcrumb */}
        <div className="flex items-center gap-2 flex-wrap">
          <Link href="/" className="text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors">
            ← Dashboard
          </Link>
          <span className="text-zinc-300 dark:text-zinc-700">·</span>
          <span className="text-xs text-zinc-500">Conservation Partners</span>
        </div>

        {/* Header */}
        <div>
          <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">Conservation Partners</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1 max-w-2xl">
            Vetted organizations working to protect endangered species and their habitats.
            When an alert fires, the most relevant charities for the threatened species are surfaced
            directly in the Discord embed and alert detail page.
          </p>
        </div>

        {/* Grid */}
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 9 }).map((_, i) => (
              <div key={i} className="bg-zinc-900 rounded-lg h-36 animate-pulse" />
            ))}
          </div>
        ) : charities.length === 0 ? (
          <div className="bg-zinc-50 dark:bg-zinc-900 rounded-lg p-8 text-center">
            <p className="text-sm text-zinc-500">No charities found.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {charities.map((c) => (
              <CharityCard key={c.id} charity={c} />
            ))}
          </div>
        )}

        {/* Disclaimer */}
        <p className="text-[10px] text-zinc-500 dark:text-zinc-600 text-center pt-2">
          Charity Navigator ratings shown where available (1–4 stars).
          Wildlife Sentinel is not affiliated with any listed organization and receives no
          compensation from donations made through these links.
        </p>

        {/* Footer */}
        <div className="pt-4 border-t border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
          <Copyright />
          <Link href="/" className="text-[10px] text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-400 transition-colors">
            ← Dashboard
          </Link>
        </div>

      </div>
    </div>
  );
}
