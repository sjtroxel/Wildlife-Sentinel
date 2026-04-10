'use client';

import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

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

interface SpeciesRangeMapInnerProps {
  rangeGeojson: Record<string, unknown> | null;
  centroid: { lat: number; lng: number };
}

export default function SpeciesRangeMapInner({ rangeGeojson, centroid }: SpeciesRangeMapInnerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const [isDark, setIsDark] = useState(false);

  // Effect 1: initialize map
  useEffect(() => {
    if (!containerRef.current) return;
    const m = L.map(containerRef.current, {
      zoomControl: true,
      minZoom: 2,
    });
    const { url, attribution } = TILE_LAYERS.light;
    tileLayerRef.current = L.tileLayer(url, { attribution, maxZoom: 18, minZoom: 2 }).addTo(m);
    m.setView([centroid.lat, centroid.lng], 4);
    setMap(m);
    return () => { m.remove(); };
  }, []); // centroid is stable — intentionally omitted to prevent map re-init on re-render

  // Effect 2: swap tile layer when dark mode toggles
  useEffect(() => {
    if (!map || !tileLayerRef.current) return;
    const { url, attribution } = isDark ? TILE_LAYERS.dark : TILE_LAYERS.light;
    map.removeLayer(tileLayerRef.current);
    tileLayerRef.current = L.tileLayer(url, { attribution, maxZoom: 18, minZoom: 2 }).addTo(map);
  }, [isDark, map]);

  // Effect 3: draw range polygon and fit bounds
  useEffect(() => {
    if (!map || !rangeGeojson) return;
    const layer = L.geoJSON(rangeGeojson as unknown as GeoJSON.GeoJsonObject, {
      style: {
        color: '#16a34a',
        fillColor: '#22c55e',
        fillOpacity: 0.25,
        weight: 1.5,
      },
    }).addTo(map);

    try {
      const bounds = layer.getBounds();
      if (bounds.isValid()) map.fitBounds(bounds, { padding: [20, 20], maxZoom: 8 });
    } catch {
      // If bounds are invalid (e.g. empty geometry), stay at centroid
    }

    return () => { layer.remove(); };
  }, [map, rangeGeojson]);

  return (
    <div className="relative w-full h-full">
      <div ref={containerRef} className="w-full h-full" />
      <button
        onClick={() => setIsDark((d) => !d)}
        className="absolute bottom-8 right-2 z-1000 flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium shadow-md transition-colors bg-white text-gray-700 hover:bg-gray-100 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
        aria-label="Toggle map theme"
        title="Toggle map theme"
      >
        {isDark ? '☀ Light' : '🌙 Dark'}
      </button>
    </div>
  );
}
