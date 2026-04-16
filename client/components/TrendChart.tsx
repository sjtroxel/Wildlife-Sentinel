'use client';

import { useEffect, useState } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { api } from '@/lib/api';
import type { TrendPoint } from '@wildlife-sentinel/shared/types';

const EVENT_COLORS: Record<string, string> = {
  wildfire:          '#ef4444',
  tropical_storm:    '#3b82f6',
  flood:             '#06b6d4',
  drought:           '#f59e0b',
  coral_bleaching:   '#14b8a6',
  earthquake:        '#a855f7',
  volcanic_eruption: '#f97316',
  deforestation:     '#78350f',
  sea_ice_loss:      '#bfdbfe',
};

const EVENT_LABELS: Record<string, string> = {
  wildfire:          'Wildfire',
  tropical_storm:    'Tropical Storm',
  flood:             'Flood',
  drought:           'Drought',
  coral_bleaching:   'Coral Bleaching',
  earthquake:        'Earthquake',
  volcanic_eruption: 'Volcanic Eruption',
  deforestation:     'Deforestation',
  sea_ice_loss:      'Sea Ice Loss',
};

export default function TrendChart() {
  const [data, setData] = useState<TrendPoint[]>([]);

  useEffect(() => {
    api.getTrends(30).then((points: TrendPoint[]) => {
      setData(points);
    }).catch(() => {});
  }, []);

  if (data.length === 0) return null;

  const isDark = typeof document !== 'undefined'
    ? document.documentElement.classList.contains('dark')
    : true;

  const gridColor    = isDark ? '#27272a' : '#e4e4e7';
  const tickColor    = isDark ? '#71717a' : '#71717a';
  const tooltipBg    = isDark ? '#18181b' : '#ffffff';
  const tooltipBorder = isDark ? '#3f3f46' : '#e4e4e7';

  // Shorten date label to MM/DD
  const formatDate = (d: string) => {
    const parts = d.split('-');
    return parts.length === 3 ? `${parts[1]}/${parts[2]}` : d;
  };

  return (
    <div className="p-3">
      <h2 className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide mb-2">
        Alert Frequency (30 days)
      </h2>
      <ResponsiveContainer width="100%" height={120}>
        <BarChart data={data} margin={{ top: 4, right: 8, left: -20, bottom: 0 }} barSize={4}>
          <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={formatDate}
            tick={{ fontSize: 9, fill: tickColor }}
            interval="preserveStartEnd"
          />
          <YAxis
            allowDecimals={false}
            tick={{ fontSize: 10, fill: tickColor }}
          />
          <Tooltip
            contentStyle={{ background: tooltipBg, border: `1px solid ${tooltipBorder}`, fontSize: 10 }}
            labelFormatter={(label) => String(label)}
            formatter={(value, name) => [value, EVENT_LABELS[String(name)] ?? String(name)]}
          />
          <Legend
            iconType="square"
            iconSize={8}
            wrapperStyle={{ fontSize: 9, paddingTop: 2 }}
            formatter={(value) => EVENT_LABELS[value] ?? value}
          />
          {Object.keys(EVENT_COLORS).map(type => (
            <Bar
              key={type}
              dataKey={type}
              stackId="a"
              fill={EVENT_COLORS[type]}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
