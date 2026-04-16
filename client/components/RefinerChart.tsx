'use client';

import { useEffect, useState } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from 'recharts';
import { api } from '@/lib/api';
import type { RefinerScoreRow } from '@wildlife-sentinel/shared/types';

interface ChartPoint {
  index: number;
  score: number;
  event_type: string;
}

export default function RefinerChart() {
  const [data, setData] = useState<ChartPoint[]>([]);

  useEffect(() => {
    api.getRefinerScores().then((scores: RefinerScoreRow[]) => {
      const points = scores
        .slice()
        .reverse()
        .map((s, i) => ({
          index: i + 1,
          score: parseFloat(String(s.composite_score)),
          event_type: s.event_type,
        }));
      setData(points);
    }).catch(() => {});
  }, []);

  if (data.length === 0) {
    return (
      <div className="p-3">
        <h2 className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide mb-2">
          Prediction Accuracy
        </h2>
        <p className="text-[10px] text-zinc-400 dark:text-zinc-600 text-center py-3">
          Scores appear after the Refiner evaluates its first alert (24–48h post-event).
        </p>
      </div>
    );
  }

  const isDark = typeof document !== 'undefined'
    ? document.documentElement.classList.contains('dark')
    : true;

  const gridColor = isDark ? '#27272a' : '#e4e4e7';
  const tickColor = isDark ? '#71717a' : '#71717a';
  const tooltipBg = isDark ? '#18181b' : '#ffffff';
  const tooltipBorder = isDark ? '#3f3f46' : '#e4e4e7';

  return (
    <div className="p-3">
      <h2 className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide mb-2">
        Prediction Accuracy
      </h2>
      <ResponsiveContainer width="100%" height={120}>
        <LineChart data={data} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
          <XAxis dataKey="index" tick={{ fontSize: 10, fill: tickColor }} />
          <YAxis domain={[0, 1]} tick={{ fontSize: 10, fill: tickColor }} />
          <Tooltip
            contentStyle={{ background: tooltipBg, border: `1px solid ${tooltipBorder}`, fontSize: 11 }}
            formatter={(value) => [typeof value === 'number' ? value.toFixed(2) : value, 'Score']}
          />
          <ReferenceLine y={0.6} stroke="#ef4444" strokeDasharray="4 2" label={{ value: '0.60', fontSize: 9, fill: '#ef4444' }} />
          <ReferenceLine y={0.85} stroke="#22c55e" strokeDasharray="4 2" label={{ value: '0.85', fontSize: 9, fill: '#22c55e' }} />
          <Line
            type="monotone"
            dataKey="score"
            stroke="#3b82f6"
            dot={false}
            strokeWidth={1.5}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
