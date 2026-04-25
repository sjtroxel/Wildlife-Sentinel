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

const EVENT_COLORS: Record<EventType, string> = {
  wildfire: '#ef4444',
  tropical_storm: '#3b82f6',
  flood: '#06b6d4',
  drought: '#f59e0b',
  coral_bleaching: '#14b8a6',
  earthquake: '#a855f7',
  volcanic_eruption: '#f97316',
  deforestation: '#78350f',    // dark brown — cleared forest / exposed soil
  sea_ice_loss: '#bfdbfe',     // icy blue — polar ice
  climate_anomaly: '#6366f1',  // indigo — macro climate signal (ENSO)
  illegal_fishing: '#be185d',  // rose — anthropogenic MPA violation
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

interface DisasterMapInnerProps {
  activeLayers: Set<EventType>;
}

export default function DisasterMapInner({ activeLayers }: DisasterMapInnerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const layerGroupsRef = useRef<Partial<Record<EventType, L.LayerGroup>>>({});
  const [isDark, setIsDark] = useState(false);

  // Effect 1: initialize map
  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;
    const m = L.map(container, {
      zoomControl: false,
      worldCopyJump: true,
      maxBounds: L.latLngBounds(L.latLng(-85, -180), L.latLng(85, 180)),
      maxBoundsViscosity: 1.0,
      minZoom: 2,
    });
    L.control.zoom({ position: 'bottomright' }).addTo(m);
    const { url, attribution } = TILE_LAYERS.light;
    tileLayerRef.current = L.tileLayer(url, {
      attribution,
      maxZoom: 18,
      minZoom: 2,
    }).addTo(m);
    m.setView([20, 0], 2);
    setMap(m);

    // Recompute tile coverage whenever the container is resized (e.g. SPA navigation)
    const ro = new ResizeObserver(() => { m.invalidateSize(); });
    ro.observe(container);

    return () => {
      ro.disconnect();
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

  // Effect 3: load alert markers into per-type layer groups
  useEffect(() => {
    if (!map) return;

    // Create one LayerGroup per event type and add all to the map
    const groups: Partial<Record<EventType, L.LayerGroup>> = {};
    EVENT_TYPES.forEach((type) => {
      groups[type] = L.layerGroup().addTo(map);
    });
    layerGroupsRef.current = groups;

    api.getMapAlerts(15).then((alerts) => {
      alerts.forEach((alert) => {
        if (!alert.coordinates) return;
        const color = EVENT_COLORS[alert.event_type as EventType] ?? '#6b7280';
        const radius = 6 + (alert.severity ?? 0) * 8;
        const threatColor = alert.threat_level === 'critical' ? '#dc2626'
          : alert.threat_level === 'high'     ? '#ea580c'
          : alert.threat_level === 'medium'   ? '#d97706'
          : '#6b7280';
        const popupContent =
          `<strong style="text-transform:capitalize">${alert.event_type.replace(/_/g, ' ')}</strong><br>` +
          `<span style="color:${threatColor};font-weight:600;font-size:11px">${(alert.threat_level ?? 'unknown').toUpperCase()}</span>` +
          `<span style="color:#9ca3af;font-size:11px"> · ${new Date(alert.created_at).toLocaleDateString()}</span><br>` +
          `<a href="/alerts/${alert.id}" class="ws-popup-link">View details →</a>`;
        const marker = L.circleMarker(
          [alert.coordinates.lat, alert.coordinates.lng],
          { color, fillColor: color, fillOpacity: 0.7, radius, weight: 1 }
        ).bindPopup(popupContent, { className: `ws-popup-${alert.event_type}` });

        const group = groups[alert.event_type as EventType];
        if (group) {
          marker.addTo(group);
        } else {
          marker.addTo(map);
        }
      });
    }).catch(() => {
      // Map renders without markers — fail silently
    });

    return () => {
      Object.values(layerGroupsRef.current).forEach((g) => g?.remove());
      layerGroupsRef.current = {};
    };
  }, [map]);

  // Effect 4: sync layer group visibility with activeLayers prop
  useEffect(() => {
    if (!map) return;
    EVENT_TYPES.forEach((type) => {
      const group = layerGroupsRef.current[type];
      if (!group) return;
      if (activeLayers.has(type)) {
        if (!map.hasLayer(group)) group.addTo(map);
      } else {
        if (map.hasLayer(group)) map.removeLayer(group);
      }
    });
  }, [activeLayers, map]);

  return (
    <div className="relative w-full h-full">
      <div ref={containerRef} className="w-full h-full" />
      <button
        onClick={() => setIsDark((d) => !d)}
        className="absolute bottom-24 right-2 z-1000 flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium shadow-md transition-colors bg-white text-gray-700 hover:bg-gray-100 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
        aria-label="Toggle map theme"
        title="Toggle map theme"
      >
        {isDark ? '☀ Light' : '🌙 Dark'}
      </button>
    </div>
  );
}
