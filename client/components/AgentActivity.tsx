'use client';

import { useEffect, useRef, useState } from 'react';
import { formatTime } from '@/lib/utils';

interface ActivityEntry {
  agent: string;
  action: string;
  detail: string;
  timestamp: string;
}

export default function AgentActivity() {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const base = process.env.NEXT_PUBLIC_API_URL ?? '';
    const source = new EventSource(`${base}/agent-activity`);

    source.onmessage = (e: MessageEvent<string>) => {
      try {
        const entry = JSON.parse(e.data) as ActivityEntry;
        setEntries((prev) => [...prev, entry].slice(-50));
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

  // Scroll to bottom whenever a new entry arrives
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [entries]);

  return (
    <div className="p-3 h-40 flex flex-col">
      <h2 className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide mb-2 shrink-0">
        Agent Activity
      </h2>
      <div className="flex-1 overflow-y-auto space-y-1 min-h-0">
        {entries.length === 0 ? (
          <p className="text-xs text-zinc-400 dark:text-zinc-600 text-center py-2">Awaiting activity...</p>
        ) : (
          entries.map((entry, i) => (
            <div key={i} className="text-[11px] font-mono leading-relaxed text-zinc-600 dark:text-zinc-400">
              <span className="text-zinc-400 dark:text-zinc-600 mr-1.5">{formatTime(entry.timestamp)}</span>
              <span className="text-zinc-400 dark:text-zinc-600">[{entry.agent}]</span>{' '}
              <span className="text-zinc-800 dark:text-zinc-300">{entry.action}</span>
              {entry.detail && (
                <span className="text-zinc-500"> — {entry.detail}</span>
              )}
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
