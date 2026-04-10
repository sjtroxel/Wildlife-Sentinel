import dynamic from 'next/dynamic';

const SpeciesRangeMapInner = dynamic(() => import('./SpeciesRangeMapInner'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center bg-zinc-100 dark:bg-zinc-900 text-zinc-500 text-sm">
      Loading map...
    </div>
  ),
});

export default SpeciesRangeMapInner;
