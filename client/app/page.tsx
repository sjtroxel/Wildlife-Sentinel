'use client';

import { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import Image from 'next/image';
import Link from 'next/link';
import { Group, Panel, Separator } from 'react-resizable-panels';
import AlertsFeed from '@/components/AlertsFeed';
import AgentActivity from '@/components/AgentActivity';
import RefinerChart from '@/components/RefinerChart';
import ThemeToggle from '@/components/ThemeToggle';

const DisasterMap = dynamic(() => import('@/components/DisasterMap'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center bg-zinc-100 dark:bg-zinc-900 text-zinc-500 text-sm">
      Loading map...
    </div>
  ),
});

function HResizeHandle() {
  return (
    <Separator className="group w-1.5 cursor-col-resize bg-zinc-200 hover:bg-zinc-300 active:bg-zinc-400 dark:bg-zinc-800 dark:hover:bg-zinc-600 dark:active:bg-zinc-500 transition-colors flex items-center justify-center" />
  );
}

function VResizeHandle() {
  return (
    <Separator className="group h-1.5 cursor-row-resize bg-zinc-200 hover:bg-zinc-300 active:bg-zinc-400 dark:bg-zinc-800 dark:hover:bg-zinc-600 dark:active:bg-zinc-500 transition-colors flex items-center justify-center" />
  );
}

export default function Home() {
  const [isDesktop, setIsDesktop] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(min-width: 1024px)').matches;
  });

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  return (
    <div className="flex flex-col h-screen bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 overflow-hidden">
      <header className="shrink-0 px-4 py-2 border-b border-zinc-200 dark:border-zinc-800 flex items-center gap-3">
        {/* Light logo — visible in light mode */}
        <Image
          src="/WildlifeSentinel-Light1048x768.png"
          alt="Wildlife Sentinel"
          width={160}
          height={117}
          className="h-8 w-auto dark:hidden"
          priority
        />
        {/* Dark logo — visible in dark mode */}
        <Image
          src="/WildlifeSentinel-Dark1048x768.png"
          alt="Wildlife Sentinel"
          width={160}
          height={117}
          className="h-8 w-auto hidden dark:block"
          priority
        />
        <span className="flex-1 text-xs text-zinc-500 hidden sm:inline">
          Real-time disaster monitoring for endangered species
        </span>
        <nav className="flex items-center gap-3 text-xs">
          <Link href="/alerts" className="text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors">
            Alerts
          </Link>
          <Link href="/species" className="text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors">
            Species
          </Link>
        </nav>
        <ThemeToggle />
      </header>

      {isDesktop ? (
        // ── Desktop: horizontal split — map | right column ──────────────────
        <Group orientation="horizontal" className="flex-1 min-h-0">
          <Panel defaultSize={65} minSize={30} className="relative">
            <DisasterMap />
          </Panel>
          <HResizeHandle />
          <Panel defaultSize={35} minSize={18} className="flex flex-col border-l border-zinc-200 dark:border-zinc-800">
            <Group orientation="vertical" className="h-full">
              <Panel defaultSize={55} minSize={15} className="min-h-0 overflow-y-auto">
                <AlertsFeed />
              </Panel>
              <VResizeHandle />
              <Panel defaultSize={25} minSize={8} className="min-h-0 overflow-y-auto border-t border-zinc-200 dark:border-zinc-800">
                <AgentActivity />
              </Panel>
              <VResizeHandle />
              <Panel defaultSize={20} minSize={8} className="min-h-0 overflow-y-auto border-t border-zinc-200 dark:border-zinc-800">
                <RefinerChart />
              </Panel>
            </Group>
          </Panel>
        </Group>
      ) : (
        // ── Mobile: vertical stack — map / alerts / activity / chart ────────
        <Group orientation="vertical" className="flex-1 min-h-0">
          <Panel defaultSize={40} minSize={15} className="relative">
            <DisasterMap />
          </Panel>
          <VResizeHandle />
          <Panel defaultSize={35} minSize={10} className="min-h-0 overflow-y-auto border-t border-zinc-200 dark:border-zinc-800">
            <AlertsFeed />
          </Panel>
          <VResizeHandle />
          <Panel defaultSize={15} minSize={5} className="min-h-0 overflow-y-auto border-t border-zinc-200 dark:border-zinc-800">
            <AgentActivity />
          </Panel>
          <VResizeHandle />
          <Panel defaultSize={10} minSize={5} className="min-h-0 overflow-y-auto border-t border-zinc-200 dark:border-zinc-800">
            <RefinerChart />
          </Panel>
        </Group>
      )}
    </div>
  );
}
