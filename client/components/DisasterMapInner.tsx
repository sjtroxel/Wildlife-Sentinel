'use client';

import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { api } from '@/lib/api';
import type { EventType } from '@wildlife-sentinel/shared/types';

// Fix Leaflet's webpack icon issue
// eslint-disable-next-line @typescript-eslint/no-explicit-any
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

const EVENT_COLORS: Record<EventType, string> = {
  wildfire: '#ef4444',
  tropical_storm: '#3b82f6',
  flood: '#06b6d4',
  drought: '#f59e0b',
  coral_bleaching: '#14b8a6',
};

const TILE_LAYERS = {
  light: {
    url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
  },
  dark: {
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
  },
};

export default function DisasterMapInner() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const [isDark, setIsDark] = useState(false);

  // Effect 1: initialize map
  useEffect(() => {
    if (!containerRef.current) return;
    const worldBounds = L.latLngBounds(L.latLng(-90, -180), L.latLng(90, 180));
    const m = L.map(containerRef.current, {
      zoomControl: true,
      maxBounds: worldBounds,
      maxBoundsViscosity: 1.0,
      minZoom: 2,
    });
    const { url, attribution } = TILE_LAYERS.light;
    tileLayerRef.current = L.tileLayer(url, {
      attribution,
      maxZoom: 18,
      minZoom: 2,
    }).addTo(m);
    m.setView([20, 0], 2);
    setMap(m);
    return () => {
      m.remove();
    };
  }, []);

  // Effect 2: swap tile layer when dark mode toggles
  useEffect(() => {
    if (!map || !tileLayerRef.current) return;
    const { url, attribution } = isDark ? TILE_LAYERS.dark : TILE_LAYERS.light;
    map.removeLayer(tileLayerRef.current);
    tileLayerRef.current = L.tileLayer(url, {
      attribution,
      maxZoom: 18,
      minZoom: 2,
    }).addTo(map);
  }, [isDark, map]);

  // Effect 3: load alert markers
  useEffect(() => {
    if (!map) return;
    api.getRecentAlerts(50).then((alerts) => {
      alerts.forEach((alert) => {
        if (!alert.coordinates) return;
        const color = EVENT_COLORS[alert.event_type] ?? '#6b7280';
        const radius = 6 + (alert.severity ?? 0) * 8;
        L.circleMarker([alert.coordinates.lat, alert.coordinates.lng], {
          color,
          fillColor: color,
          fillOpacity: 0.7,
          radius,
          weight: 1,
        })
          .bindPopup(
            `<strong>${alert.event_type.replace(/_/g, ' ')}</strong><br>` +
            `Threat: ${alert.threat_level ?? 'unknown'}<br>` +
            `${new Date(alert.created_at).toLocaleDateString()}`
          )
          .addTo(map);
      });
    }).catch(() => {
      // Map renders without markers — fail silently
    });
  }, [map]);

  return (
    <div className="relative w-full h-full">
      <div ref={containerRef} className="w-full h-full" />
      <button
        onClick={() => setIsDark(d => !d)}
        className="absolute bottom-8 right-2 z-1000 flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium shadow-md transition-colors bg-white text-gray-700 hover:bg-gray-100 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
        aria-label="Toggle map theme"
        title="Toggle map theme"
      >
        {isDark ? '☀ Light' : '🌙 Dark'}
      </button>
    </div>
  );
}
