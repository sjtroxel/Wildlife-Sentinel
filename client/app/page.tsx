'use client';

import dynamic from 'next/dynamic';
import Image from 'next/image';
import AlertsFeed from '@/components/AlertsFeed';
import AgentActivity from '@/components/AgentActivity';
import RefinerChart from '@/components/RefinerChart';

const DisasterMap = dynamic(() => import('@/components/DisasterMap'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center bg-zinc-900 text-zinc-500 text-sm">
      Loading map...
    </div>
  ),
});

export default function Home() {
  return (
    <div className="flex flex-col h-screen bg-zinc-950 text-zinc-100 overflow-hidden">
      <header className="shrink-0 px-4 py-2 border-b border-zinc-800 flex items-center gap-3">
        <picture>
          <source srcSet="/WildlifeSentinel-Dark1048x768.png" media="(prefers-color-scheme: dark)" />
          <Image
            src="/WildlifeSentinel-Light1048x768.png"
            alt="Wildlife Sentinel"
            width={160}
            height={117}
            className="h-8 w-auto"
            priority
          />
        </picture>
        <span className="text-xs text-zinc-500 hidden sm:inline">
          Real-time disaster monitoring for endangered species
        </span>
      </header>

      <main className="flex-1 flex flex-col lg:grid lg:grid-cols-[1fr_380px] overflow-hidden min-h-0">
        {/* Map panel */}
        <div className="h-75 sm:h-100 lg:h-full relative">
          <DisasterMap />
        </div>

        {/* Right panel */}
        <div className="flex flex-col min-h-0 overflow-hidden lg:border-l lg:border-zinc-800">
          <div className="flex-1 min-h-0 overflow-y-auto border-b border-zinc-800">
            <AlertsFeed />
          </div>
          <div className="shrink-0 border-b border-zinc-800">
            <AgentActivity />
          </div>
          <div className="shrink-0">
            <RefinerChart />
          </div>
        </div>
      </main>
    </div>
  );
}
