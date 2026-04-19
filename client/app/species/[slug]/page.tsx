'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { formatRelativeTime } from '@/lib/utils';
import SpeciesRangeMap from '@/components/SpeciesRangeMap';
import Copyright from '@/components/Copyright';
import type { SpeciesDetail, ThreatLevel, IUCNStatus } from '@wildlife-sentinel/shared/types';

const IUCN_BADGE: Record<IUCNStatus, string> = {
  EX: 'bg-zinc-800 text-zinc-300 border border-zinc-600',
  EW: 'bg-zinc-800 text-zinc-300 border border-zinc-600',
  CR: 'bg-red-900/60 text-red-300 border border-red-700',
  EN: 'bg-orange-900/60 text-orange-300 border border-orange-700',
  VU: 'bg-amber-900/60 text-amber-300 border border-amber-700',
  NT: 'bg-yellow-900/40 text-yellow-400 border border-yellow-700',
  LC: 'bg-green-900/40 text-green-400 border border-green-700',
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

const THREAT_BADGE: Record<ThreatLevel, string> = {
  critical: 'bg-red-600 text-white',
  high: 'bg-orange-600 text-white',
  medium: 'bg-amber-500 text-zinc-900',
  low: 'bg-zinc-600 text-zinc-200',
};

const EVENT_LABELS: Record<string, string> = {
  wildfire: 'Wildfire',
  tropical_storm: 'Tropical Storm',
  flood: 'Flood',
  drought: 'Drought',
  coral_bleaching: 'Coral Bleaching',
};

function SkeletonBlock({ h = 'h-4' }: { h?: string }) {
  return <div className={`${h} bg-zinc-800 rounded animate-pulse`} />;
}

export default function SpeciesDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const [species, setSpecies] = useState<SpeciesDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) return;
    api.getSpecies(slug)
      .then(setSpecies)
      .catch(() => setError('Species not found or unavailable.'))
      .finally(() => setLoading(false));
  }, [slug]);

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-200 p-4 md:p-8 max-w-4xl mx-auto space-y-4">
        <div className="w-24 animate-pulse"><SkeletonBlock h="h-3" /></div>
        <div className="w-1/2 animate-pulse"><SkeletonBlock h="h-6" /></div>
        <div className="w-1/4 animate-pulse"><SkeletonBlock h="h-3" /></div>
        <div className="h-64 bg-zinc-900 rounded-lg animate-pulse mt-4" />
        <div className="space-y-2 mt-4">
          {Array.from({ length: 4 }).map((_, i) => <SkeletonBlock key={i} />)}
        </div>
      </div>
    );
  }

  if (error || !species) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-200 flex flex-col items-center justify-center gap-4">
        <p className="text-zinc-400 text-sm">{error ?? 'Species not found.'}</p>
        <Link href="/species" className="text-xs text-blue-400 hover:text-blue-300">← Species list</Link>
      </div>
    );
  }

  const iucnBadge = IUCN_BADGE[species.iucn_status] ?? 'bg-zinc-800 text-zinc-300';
  const iucnLabel = IUCN_LABEL[species.iucn_status] ?? species.iucn_status;

  return (
    <div className="min-h-screen bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-200">
      <div className="max-w-4xl mx-auto p-4 md:p-8">

        {/* Breadcrumb */}
        <div className="flex items-center gap-2 mb-6 flex-wrap">
          <Link href="/" className="text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors">
            ← Dashboard
          </Link>
          <span className="text-zinc-300 dark:text-zinc-700">·</span>
          <Link href="/species" className="text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors">
            Species
          </Link>
          <span className="text-zinc-300 dark:text-zinc-700">·</span>
          <span className="text-xs text-zinc-500 truncate max-w-50">
            {species.common_name ?? species.species_name}
          </span>
        </div>

        {/* Title */}
        <div className="mb-4">
          <h1 className="text-lg font-bold text-zinc-900 dark:text-zinc-100 leading-tight">
            {species.common_name ?? species.species_name}
          </h1>
          {species.common_name && (
            <p className="text-sm text-zinc-500 italic mt-0.5">{species.species_name}</p>
          )}
        </div>

        {/* IUCN status badge */}
        <div className="flex items-center gap-3 mb-6 flex-wrap">
          <span className={`text-xs font-semibold px-2 py-0.5 rounded border ${iucnBadge}`}>
            {species.iucn_status} · {iucnLabel}
          </span>
          {species.iucn_species_id && (
            <span className="text-[10px] text-zinc-500 font-mono">
              IUCN #{species.iucn_species_id}
            </span>
          )}
        </div>

        {/* Range Map */}
        <div className="mb-6">
          <h2 className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide mb-2">
            Habitat Range
          </h2>
          <div className="h-64 md:h-80 rounded-lg overflow-hidden border border-zinc-200 dark:border-zinc-800">
            {species.range_geojson ? (
              <SpeciesRangeMap rangeGeojson={species.range_geojson} centroid={species.centroid} />
            ) : (
              <div className="flex h-full items-center justify-center bg-zinc-100 dark:bg-zinc-900 text-zinc-500 text-sm">
                Range data unavailable
              </div>
            )}
          </div>
          <p className="text-[10px] text-zinc-500 mt-1">
            Green polygon shows documented IUCN habitat range. Centroid:{' '}
            {species.centroid.lat.toFixed(2)}°, {species.centroid.lng.toFixed(2)}°
          </p>
        </div>

        {/* Recent Alerts */}
        <div>
          <h2 className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide mb-3">
            Recent Alerts Involving This Species
          </h2>

          {species.recent_alerts.length === 0 ? (
            <div className="bg-zinc-50 dark:bg-zinc-900 rounded-lg p-6 text-center">
              <p className="text-sm text-zinc-500">No alerts recorded for this species yet.</p>
              <p className="text-xs text-zinc-600 mt-1">
                Alerts appear here when a disaster event threatens this species&apos; habitat range.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {species.recent_alerts.map((alert) => {
                const badge = alert.threat_level ? THREAT_BADGE[alert.threat_level as ThreatLevel] : 'bg-zinc-700 text-zinc-300';
                return (
                  <Link
                    key={alert.id}
                    href={`/alerts/${alert.id}`}
                    className="flex items-center justify-between gap-3 bg-zinc-50 dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg px-4 py-3 transition-colors group"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      {alert.threat_level && (
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 ${badge}`}>
                          {alert.threat_level.toUpperCase()}
                        </span>
                      )}
                      <span className="text-xs text-zinc-700 dark:text-zinc-300 truncate">
                        {EVENT_LABELS[alert.event_type as string] ?? alert.event_type}
                      </span>
                      {alert.coordinates && (
                        <span className="text-[10px] text-zinc-500 font-mono hidden sm:inline">
                          {(alert.coordinates as { lat: number; lng: number }).lat.toFixed(2)}°,{' '}
                          {(alert.coordinates as { lat: number; lng: number }).lng.toFixed(2)}°
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[10px] text-zinc-500">{formatRelativeTime(alert.created_at as string)}</span>
                      <span className="text-[10px] text-zinc-600 group-hover:text-zinc-400 transition-colors">→</span>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="mt-8 pt-4 border-t border-zinc-200 dark:border-zinc-800 space-y-1">
          <span className="text-[10px] text-zinc-400 dark:text-zinc-700">
            Wildlife Sentinel · Data: IUCN Red List / GBIF / NASA FIRMS / NOAA
          </span>
          <div className="flex items-center justify-between">
            <Copyright />
            <Link href="/species" className="text-[10px] text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-400 transition-colors">
              ← All species
            </Link>
          </div>
        </div>

      </div>
    </div>
  );
}
