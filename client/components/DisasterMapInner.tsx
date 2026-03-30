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

export default function DisasterMapInner() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<L.Map | null>(null);

  // Effect 1: initialize map
  useEffect(() => {
    if (!containerRef.current) return;
    const m = L.map(containerRef.current, { zoomControl: true });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 18,
    }).addTo(m);
    m.setView([20, 0], 2);
    setMap(m);
    return () => {
      m.remove();
    };
  }, []);

  // Effect 2: load alert markers
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

  return <div ref={containerRef} className="w-full h-full" />;
}
