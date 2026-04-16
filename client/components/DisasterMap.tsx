'use client';

import { useState } from 'react';
import DisasterMapInner from './DisasterMapInner';
import type { EventType } from '@wildlife-sentinel/shared/types';

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
  earthquake: '#a855f7',        // purple
  volcanic_eruption: '#f97316', // orange — lava
  deforestation: '#78350f',     // dark brown — cleared forest
  sea_ice_loss: '#bfdbfe',      // icy blue — polar ice
  climate_anomaly: '#6366f1',   // indigo — macro climate signal (ENSO)
  illegal_fishing: '#be185d',   // rose — anthropogenic MPA violation
};

export default function DisasterMap() {
  const [activeLayers, setActiveLayers] = useState<Set<EventType>>(
    new Set(EVENT_TYPES)
  );

  function toggleLayer(type: EventType) {
    setActiveLayers((prev) => {
      const next = new Set(prev);
      if (next.has(type)) {
        next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
  }

  return (
    <div className="relative w-full h-full">
      <DisasterMapInner activeLayers={activeLayers} />
      <div className="absolute top-2 left-2 z-1000 flex flex-wrap gap-1">
        {EVENT_TYPES.map((type) => (
          <button
            key={type}
            onClick={() => toggleLayer(type)}
            style={{ borderColor: EVENT_COLORS[type] }}
            className={`text-[10px] px-2 py-1 rounded border font-medium transition-opacity
              bg-white/90 text-zinc-800 dark:bg-zinc-900/90 dark:text-zinc-200
              ${activeLayers.has(type) ? 'opacity-100' : 'opacity-30'}`}
          >
            {type.replace(/_/g, ' ')}
          </button>
        ))}
      </div>
    </div>
  );
}
