'use client';

import { useEffect, useState } from 'react';
import { formatRelativeTime } from '@/lib/utils';

interface ActivityEntry {
  agent: string;
  action: string;
  detail: string;
  timestamp: string;
}

export default function AgentActivity() {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);

  useEffect(() => {
    const base = process.env.NEXT_PUBLIC_API_URL ?? '';
    const source = new EventSource(`${base}/agent-activity`);

    source.onmessage = (e: MessageEvent<string>) => {
      try {
        const entry = JSON.parse(e.data) as ActivityEntry;
        setEntries((prev) => [entry, ...prev].slice(0, 50));
      } catch {
        // ignore malformed messages
      }
    };

    source.onerror = () => {
      source.close();
    };

    return () => {
      source.close();
    };
  }, []);

  return (
    <div className="p-3 h-40 flex flex-col">
      <h2 className="text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-2 shrink-0">
        Agent Activity
      </h2>
      <div className="flex-1 overflow-y-auto space-y-1 min-h-0">
        {entries.length === 0 ? (
          <p className="text-xs text-zinc-600 text-center py-2">Awaiting activity...</p>
        ) : (
          entries.map((entry, i) => (
            <div key={i} className="text-[11px] font-mono leading-relaxed text-zinc-400">
              <span className="text-zinc-600">[{entry.agent}]</span>{' '}
              <span className="text-zinc-300">{entry.action}</span>
              {entry.detail && (
                <span className="text-zinc-500"> — {entry.detail}</span>
              )}
              <span className="text-zinc-700 ml-1">{formatRelativeTime(entry.timestamp)}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
