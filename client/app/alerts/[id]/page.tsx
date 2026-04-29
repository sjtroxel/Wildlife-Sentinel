'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { formatRelativeTime } from '@/lib/utils';
import CharityCard from '@/components/CharityCard';
import Copyright from '@/components/Copyright';
import type { AlertDetail, ThreatLevel, Charity } from '@wildlife-sentinel/shared/types';

const THREAT_COLORS: Record<ThreatLevel, string> = {
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

const SOURCE_LABELS: Record<string, string> = {
  nasa_firms: 'NASA FIRMS',
  noaa_nhc: 'NOAA NHC',
  gdacs: 'GDACS',
  gdacs_flood: 'GDACS (Flood)',
  gdacs_drought: 'GDACS (Drought)',
  usgs_nwis: 'USGS NWIS',
  drought_monitor: 'US Drought Monitor',
  coral_reef_watch: 'NOAA Coral Reef Watch',
};

function SkeletonCard({ rows = 3 }: { rows?: number }) {
  return (
    <div className="bg-zinc-900 rounded-lg p-4 space-y-3 animate-pulse">
      <div className="h-3 bg-zinc-800 rounded w-1/3" />
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-3 bg-zinc-800 rounded w-full" />
      ))}
    </div>
  );
}

function ScoreBar({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  const color = score >= 0.85 ? 'bg-green-500' : score >= 0.60 ? 'bg-amber-500' : 'bg-red-500';
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[10px] text-zinc-400 shrink-0 w-8 text-right">{pct}%</span>
    </div>
  );
}

export default function AlertDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [alert, setAlert] = useState<AlertDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [charities, setCharities] = useState<Charity[]>([]);

  useEffect(() => {
    if (!id) return;
    api.getAlert(id)
      .then(setAlert)
      .catch(() => setError('Alert not found or unavailable.'))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    if (!alert) return;
    const species = alert.enrichment_data?.species_at_risk ?? [];
    api.getCharitiesForAlert(species, alert.event_type, 3)
      .then(setCharities)
      .catch(() => setCharities([]));
  }, [alert]);

  function copyCoords() {
    if (!alert?.coordinates) return;
    void navigator.clipboard.writeText(`${alert.coordinates.lat.toFixed(4)}, ${alert.coordinates.lng.toFixed(4)}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-200 p-4 md:p-8 space-y-4 max-w-4xl mx-auto">
        <div className="h-4 bg-zinc-800 rounded w-24 animate-pulse mb-6" />
        <div className="h-6 bg-zinc-800 rounded w-1/2 animate-pulse mb-2" />
        <div className="grid md:grid-cols-2 gap-4 mt-4">
          <SkeletonCard rows={5} />
          <SkeletonCard rows={5} />
        </div>
        <SkeletonCard rows={3} />
      </div>
    );
  }

  if (error || !alert) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-200 flex flex-col items-center justify-center gap-4">
        <p className="text-zinc-400 text-sm">{error ?? 'Alert not found.'}</p>
        <Link href="/" className="text-xs text-blue-400 hover:text-blue-300">← Back to dashboard</Link>
      </div>
    );
  }

  const threatBadge = alert.threat_level ? THREAT_COLORS[alert.threat_level] : 'bg-zinc-700 text-zinc-300';
  const speciesAtRisk = alert.enrichment_data?.species_at_risk ?? [];
  const compoundingFactors = alert.prediction_data?.compounding_factors ?? [];

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-200">
      <div className="max-w-4xl mx-auto p-4 md:p-8">

        {/* Header */}
        <div className="flex items-center gap-3 mb-6 flex-wrap">
          <Link href="/" className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors">
            ← Dashboard
          </Link>
          <span className="text-zinc-700">·</span>
          <span className="text-xs text-zinc-500 font-mono">{alert.raw_event_id}</span>
        </div>

        {/* Title row */}
        <div className="flex items-start justify-between gap-3 mb-4 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-zinc-100">
              {EVENT_LABELS[alert.event_type] ?? alert.event_type}
            </span>
            {alert.threat_level && (
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${threatBadge}`}>
                {alert.threat_level.toUpperCase()}
              </span>
            )}
          </div>
          <span className="text-xs text-zinc-500">{formatRelativeTime(alert.created_at)}</span>
        </div>

        {/* Coordinates + copy */}
        {alert.coordinates && (
          <div className="flex items-center gap-2 mb-6">
            <span className="text-xs font-mono text-zinc-400">
              {alert.coordinates.lat.toFixed(4)}°, {alert.coordinates.lng.toFixed(4)}°
            </span>
            <button
              onClick={copyCoords}
              className="text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors"
              aria-label="Copy coordinates"
            >
              {copied ? 'copied ✓' : 'copy'}
            </button>
          </div>
        )}

        {/* Main two-column grid */}
        <div className="grid md:grid-cols-2 gap-4 mb-4">

          {/* Threat Assessment card */}
          <div className="bg-zinc-900 rounded-lg p-4 space-y-3">
            <h2 className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">
              Threat Assessment
            </h2>

            {alert.prediction_data?.predicted_impact ? (
              <div>
                <p className="text-[10px] text-zinc-500 uppercase tracking-wide mb-1">Predicted Impact</p>
                <p className="text-xs text-zinc-300 leading-relaxed">{alert.prediction_data.predicted_impact}</p>
              </div>
            ) : null}

            {alert.prediction_data?.reasoning ? (
              <div>
                <p className="text-[10px] text-zinc-500 uppercase tracking-wide mb-1">Reasoning</p>
                <p className="text-xs text-zinc-400 leading-relaxed">{alert.prediction_data.reasoning}</p>
              </div>
            ) : null}

            {compoundingFactors.length > 0 && (
              <div>
                <p className="text-[10px] text-zinc-500 uppercase tracking-wide mb-1">Compounding Factors</p>
                <ul className="space-y-0.5">
                  {compoundingFactors.map((f, i) => (
                    <li key={i} className="text-xs text-zinc-400 flex gap-1.5">
                      <span className="text-amber-500 shrink-0">·</span>
                      {f}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {alert.prediction_data?.recommended_action ? (
              <div>
                <p className="text-[10px] text-zinc-500 uppercase tracking-wide mb-1">Recommended Action</p>
                <p className="text-xs text-zinc-400 leading-relaxed">{alert.prediction_data.recommended_action}</p>
              </div>
            ) : null}

            {!alert.prediction_data && (
              <p className="text-xs text-zinc-600 italic">Assessment data not available for this alert.</p>
            )}
          </div>

          {/* Event metadata card */}
          <div className="bg-zinc-900 rounded-lg p-4 space-y-3">
            <h2 className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">
              Event Details
            </h2>

            <dl className="space-y-2">
              <div className="flex justify-between gap-2">
                <dt className="text-[10px] text-zinc-500 uppercase tracking-wide">Source</dt>
                <dd className="text-xs text-zinc-300">{SOURCE_LABELS[alert.source] ?? alert.source}</dd>
              </div>
              {alert.severity !== null && (
                <div className="flex justify-between gap-2">
                  <dt className="text-[10px] text-zinc-500 uppercase tracking-wide">Severity</dt>
                  <dd className="text-xs text-zinc-300">{((alert.severity ?? 0) * 100).toFixed(0)}%</dd>
                </div>
              )}
              {alert.confidence_score !== null && (
                <div className="flex justify-between gap-2">
                  <dt className="text-[10px] text-zinc-500 uppercase tracking-wide">Confidence</dt>
                  <dd className="text-xs text-zinc-300">{((alert.confidence_score ?? 0) * 100).toFixed(0)}%</dd>
                </div>
              )}
              {alert.enrichment_data?.habitat_distance_km !== undefined && (
                <div className="flex justify-between gap-2">
                  <dt className="text-[10px] text-zinc-500 uppercase tracking-wide">Distance to Habitat</dt>
                  <dd className="text-xs text-zinc-300">{alert.enrichment_data.habitat_distance_km.toFixed(1)} km</dd>
                </div>
              )}
              {alert.enrichment_data?.species_status && (
                <div className="flex justify-between gap-2">
                  <dt className="text-[10px] text-zinc-500 uppercase tracking-wide">IUCN Status</dt>
                  <dd className="text-xs text-zinc-300">{alert.enrichment_data.species_status}</dd>
                </div>
              )}
              {alert.enrichment_data?.weather && (
                <div>
                  <dt className="text-[10px] text-zinc-500 uppercase tracking-wide mb-1">Weather</dt>
                  <dd className="text-xs text-zinc-400 leading-relaxed">{alert.enrichment_data.weather}</dd>
                </div>
              )}
            </dl>

            {speciesAtRisk.length > 0 && (
              <div>
                <p className="text-[10px] text-zinc-500 uppercase tracking-wide mb-1">Species at Risk</p>
                <ul className="space-y-0.5">
                  {speciesAtRisk.map((s, i) => (
                    <li key={i} className="text-xs text-zinc-300 italic">{s}</li>
                  ))}
                </ul>
              </div>
            )}

            {alert.discord_message_id && (
              <p className="text-[10px] text-zinc-600 pt-1">Posted to Discord ✓</p>
            )}
          </div>
        </div>

        {/* Refiner Score History */}
        {alert.refiner_scores.length > 0 && (
          <div className="bg-zinc-900 rounded-lg p-4">
            <h2 className="text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-3">
              Prediction Accuracy (Refiner)
            </h2>
            <div className="space-y-3">
              {alert.refiner_scores.map((score, i) => (
                <div key={i} className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-zinc-500 uppercase tracking-wide">
                      {score.evaluation_time} check
                    </span>
                    <span className="text-[10px] text-zinc-600">{formatRelativeTime(score.evaluated_at)}</span>
                  </div>
                  <ScoreBar score={score.composite_score} />
                  <div className="flex gap-4 text-[10px] text-zinc-600">
                    <span>Direction: {Math.round(score.direction_accuracy * 100)}%</span>
                    <span>Magnitude: {Math.round(score.magnitude_accuracy * 100)}%</span>
                  </div>
                  {score.correction_note && (
                    <p className="text-[10px] text-amber-500/80 leading-relaxed pt-0.5">
                      {score.correction_note}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* How You Can Help */}
        {charities.length > 0 && (
          <div className="mt-4 space-y-3">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
              💛 How You Can Help
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {charities.map((c) => (
                <CharityCard key={c.id} charity={c} compact />
              ))}
            </div>
            <p className="text-[10px] text-zinc-600">
              All organizations are vetted conservation nonprofits.{' '}
              <Link href="/charities" className="text-zinc-500 hover:text-zinc-400">
                Browse all conservation partners →
              </Link>
            </p>
          </div>
        )}

        {/* Footer */}
        <div className="mt-6 pt-4 border-t border-zinc-800 space-y-1">
          <span className="text-[10px] text-zinc-700">Wildlife Sentinel · Data: NASA FIRMS / NOAA / USGS / IUCN</span>
          <div className="flex items-center justify-between">
            <Copyright />
            <Link href="/" className="text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors">
              ← Back to dashboard
            </Link>
          </div>
        </div>

      </div>
    </div>
  );
}
