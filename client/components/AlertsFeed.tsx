'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { formatRelativeTime } from '@/lib/utils';
import type { AlertRow, ThreatLevel } from '@wildlife-sentinel/shared/types';

const THREAT_BADGE: Record<ThreatLevel, string> = {
  critical: 'bg-red-600 text-white',
  high: 'bg-orange-600 text-white',
  medium: 'bg-amber-500 text-zinc-900',
  low: 'bg-zinc-600 text-zinc-200',
};

export default function AlertsFeed() {
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    function load() {
      api.getRecentAlerts(20).then(setAlerts).catch(() => {});
    }
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="p-3">
      <h2 className="text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-2">
        Recent Alerts
      </h2>
      {alerts.length === 0 ? (
        <p className="text-xs text-zinc-600 py-4 text-center">No alerts yet</p>
      ) : (
        <ul className="space-y-2">
          {alerts.map((alert) => (
            <li key={alert.id}>
              <button
                className="w-full text-left rounded bg-zinc-900 hover:bg-zinc-800 transition-colors px-3 py-2"
                onClick={() => setExpandedId(expandedId === alert.id ? null : alert.id)}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-zinc-200 truncate">
                    {alert.event_type.replace(/_/g, ' ')}
                  </span>
                  <div className="flex items-center gap-2 shrink-0">
                    {alert.threat_level && (
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${THREAT_BADGE[alert.threat_level]}`}>
                        {alert.threat_level.toUpperCase()}
                      </span>
                    )}
                    <span className="text-[10px] text-zinc-500">
                      {formatRelativeTime(alert.created_at)}
                    </span>
                  </div>
                </div>
                {expandedId === alert.id && (
                  <div className="mt-2 text-xs text-zinc-400 space-y-1">
                    <p>Source: {alert.source.replace(/_/g, ' ')}</p>
                    {alert.confidence_score !== null && (
                      <p>Confidence: {(alert.confidence_score * 100).toFixed(0)}%</p>
                    )}
                    {alert.severity !== null && (
                      <p>Severity: {(alert.severity * 100).toFixed(0)}%</p>
                    )}
                    {alert.coordinates && (
                      <p>
                        Coordinates: {alert.coordinates.lat.toFixed(3)},{' '}
                        {alert.coordinates.lng.toFixed(3)}
                      </p>
                    )}
                  </div>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
