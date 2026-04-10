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
];

const EVENT_COLORS: Record<EventType, string> = {
  wildfire: '#ef4444',
  tropical_storm: '#3b82f6',
  flood: '#06b6d4',
  drought: '#f59e0b',
  coral_bleaching: '#14b8a6',
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
