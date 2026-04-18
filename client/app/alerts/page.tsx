'use client';

import { useState, useCallback } from 'react';
import Link from 'next/link';
import { api, type AlertFilters } from '@/lib/api';
import { formatRelativeTime } from '@/lib/utils';
import type { AlertRow, EventType, ThreatLevel } from '@wildlife-sentinel/shared/types';

const EVENT_TYPES: EventType[] = [
  'wildfire',
  'tropical_storm',
  'flood',
  'drought',
  'coral_bleaching',
  'earthquake',
  'volcanic_eruption',
  'deforestation',
  'sea_ice_loss',
  'climate_anomaly',
  'illegal_fishing',
];

const EVENT_LABELS: Record<EventType, string> = {
  wildfire: 'Wildfire',
  tropical_storm: 'Tropical Storm',
  flood: 'Flood',
  drought: 'Drought',
  coral_bleaching: 'Coral Bleaching',
  earthquake: 'Earthquake',
  volcanic_eruption: 'Volcanic Eruption',
  deforestation: 'Deforestation',
  sea_ice_loss: 'Sea Ice Loss',
  climate_anomaly: 'Climate Anomaly',
  illegal_fishing: 'Illegal Fishing',
};

const THREAT_LEVELS: ThreatLevel[] = ['critical', 'high', 'medium', 'low'];

const THREAT_BADGE: Record<ThreatLevel, string> = {
  critical: 'bg-red-600 text-white',
  high: 'bg-orange-600 text-white',
  medium: 'bg-amber-500 text-zinc-900',
  low: 'bg-zinc-600 text-zinc-200',
};

const PAGE_SIZE = 50;

export default function AlertsArchive() {
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [eventType, setEventType] = useState<EventType | ''>('');
  const [threatLevel, setThreatLevel] = useState<ThreatLevel | ''>('');
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [initialLoaded, setInitialLoaded] = useState(false);

  const load = useCallback(
    async (filters: AlertFilters, append: boolean) => {
      setLoading(true);
      try {
        const rows = await api.getAlerts(filters);
        setAlerts((prev) => (append ? [...prev, ...rows] : rows));
        setHasMore(rows.length === PAGE_SIZE);
        setInitialLoaded(true);
      } catch {
        // keep whatever is already showing
      } finally {
        setLoading(false);
      }
    },
    []
  );

  // Trigger initial load on first render
  const [didInit, setDidInit] = useState(false);
  if (!didInit) {
    setDidInit(true);
    void load({ limit: PAGE_SIZE, offset: 0 }, false);
  }

  function applyFilters() {
    const filters: AlertFilters = {
      limit: PAGE_SIZE,
      offset: 0,
      ...(eventType ? { event_type: eventType } : {}),
      ...(threatLevel ? { threat_level: threatLevel } : {}),
    };
    setOffset(0);
    void load(filters, false);
  }

  function clearFilters() {
    setEventType('');
    setThreatLevel('');
    setOffset(0);
    void load({ limit: PAGE_SIZE, offset: 0 }, false);
  }

  function loadMore() {
    const nextOffset = offset + PAGE_SIZE;
    setOffset(nextOffset);
    const filters: AlertFilters = {
      limit: PAGE_SIZE,
      offset: nextOffset,
      ...(eventType ? { event_type: eventType } : {}),
      ...(threatLevel ? { threat_level: threatLevel } : {}),
    };
    void load(filters, true);
  }

  const selectClass =
    'rounded border px-2 py-1.5 text-xs bg-white dark:bg-zinc-800 border-zinc-300 dark:border-zinc-700 text-zinc-800 dark:text-zinc-200 focus:outline-none focus:ring-1 focus:ring-blue-500';

  return (
    <div className="min-h-screen bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100">
      {/* Header */}
      <header className="border-b border-zinc-200 dark:border-zinc-800 px-4 py-3 flex items-center gap-3">
        <Link
          href="/"
          className="text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors"
        >
          ← Dashboard
        </Link>
        <span className="text-zinc-300 dark:text-zinc-700">|</span>
        <h1 className="text-sm font-semibold">Alert Archive</h1>
      </header>

      <div className="max-w-3xl mx-auto px-4 py-6">
        {/* Filter bar */}
        <div className="flex flex-wrap gap-2 mb-6 items-end">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] text-zinc-500 uppercase tracking-wide">Event type</label>
            <select
              value={eventType}
              onChange={(e) => setEventType(e.target.value as EventType | '')}
              className={selectClass}
            >
              <option value="">All types</option>
              {EVENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {EVENT_LABELS[t]}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[10px] text-zinc-500 uppercase tracking-wide">Threat level</label>
            <select
              value={threatLevel}
              onChange={(e) => setThreatLevel(e.target.value as ThreatLevel | '')}
              className={selectClass}
            >
              <option value="">All levels</option>
              {THREAT_LEVELS.map((l) => (
                <option key={l} value={l}>
                  {l.toUpperCase()}
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={applyFilters}
            disabled={loading}
            className="px-3 py-1.5 rounded text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50 transition-colors"
          >
            Apply
          </button>

          {(eventType || threatLevel) && (
            <button
              onClick={clearFilters}
              disabled={loading}
              className="px-3 py-1.5 rounded text-xs font-medium bg-zinc-200 hover:bg-zinc-300 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 disabled:opacity-50 transition-colors"
            >
              Clear
            </button>
          )}
        </div>

        {/* Results */}
        {!initialLoaded && loading ? (
          // Initial skeleton
          <div className="space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className="h-12 rounded animate-pulse bg-zinc-100 dark:bg-zinc-800"
              />
            ))}
          </div>
        ) : alerts.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-sm text-zinc-500">No alerts match these filters.</p>
            {(eventType || threatLevel) && (
              <button
                onClick={clearFilters}
                className="mt-3 text-xs text-blue-500 hover:text-blue-400 transition-colors"
              >
                Clear filters
              </button>
            )}
          </div>
        ) : (
          <>
            <ul className="space-y-2">
              {alerts.map((alert) => (
                <li key={alert.id}>
                  <Link
                    href={`/alerts/${alert.id}`}
                    className="flex items-center justify-between gap-3 rounded px-3 py-2.5 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-900 dark:hover:bg-zinc-800 transition-colors group"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-xs font-medium text-zinc-800 dark:text-zinc-200 truncate">
                        {alert.event_type.replace(/_/g, ' ')}
                      </span>
                      <span className="text-[10px] text-zinc-500 shrink-0">
                        {alert.source.replace(/_/g, ' ')}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {alert.threat_level && (
                        <span
                          className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${THREAT_BADGE[alert.threat_level]}`}
                        >
                          {alert.threat_level.toUpperCase()}
                        </span>
                      )}
                      <span className="text-[10px] text-zinc-500">
                        {formatRelativeTime(alert.created_at)}
                      </span>
                      <span className="text-[10px] text-zinc-400 dark:text-zinc-600 group-hover:text-blue-500 transition-colors">
                        →
                      </span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>

            {hasMore && (
              <div className="mt-6 text-center">
                <button
                  onClick={loadMore}
                  disabled={loading}
                  className="px-4 py-2 rounded text-xs font-medium bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 disabled:opacity-50 transition-colors"
                >
                  {loading ? 'Loading...' : 'Load more'}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
