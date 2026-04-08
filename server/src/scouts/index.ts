import cron from 'node-cron';
import { FirmsScout } from './FirmsScout.js';
import { NhcScout } from './NhcScout.js';
import { GdacsScout } from './GdacsScout.js';
import { UsgsScout } from './UsgsScout.js';
import { DroughtScout } from './DroughtScout.js';
import { CoralScout } from './CoralScout.js';

const scouts = {
  firms:  new FirmsScout(),
  nhc:    new NhcScout(),
  gdacs:  new GdacsScout(),
  usgs:   new UsgsScout(),
  drought: new DroughtScout(),
  coral:  new CoralScout(),
};

export function startScouts(): void {
  // NASA FIRMS — every 10 minutes
  cron.schedule('*/10 * * * *', () => {
    scouts.firms.run().catch(err => console.error('[scouts] FirmsScout error:', err));
  });

  // NOAA NHC — every 30 minutes (Atlantic + E. Pacific)
  cron.schedule('*/30 * * * *', () => {
    scouts.nhc.run().catch(err => console.error('[scouts] NhcScout error:', err));
  });

  // GDACS — every 30 minutes (global — all ocean basins)
  cron.schedule('*/30 * * * *', () => {
    scouts.gdacs.run().catch(err => console.error('[scouts] GdacsScout error:', err));
  });

  // USGS NWIS — every 15 minutes
  cron.schedule('*/15 * * * *', () => {
    scouts.usgs.run().catch(err => console.error('[scouts] UsgsScout error:', err));
  });

  // US Drought Monitor — Thursday 10:30 AM CT (data releases ~10 AM CT)
  cron.schedule('30 10 * * 4', () => {
    scouts.drought.run().catch(err => console.error('[scouts] DroughtScout error:', err));
  }, { timezone: 'America/Chicago' });

  // NOAA Coral Reef Watch — every 6 hours
  cron.schedule('0 */6 * * *', () => {
    scouts.coral.run().catch(err => console.error('[scouts] CoralScout error:', err));
  });

  console.log('[scouts] All 6 scouts scheduled');

  // Run each immediately on startup so the pipeline has data without waiting.
  // Drought Scout is omitted — it only produces valid data on Thursdays after 10:30 AM CT.
  scouts.firms.run().catch(err => console.error('[scouts] FirmsScout startup error:', err));
  scouts.nhc.run().catch(err => console.error('[scouts] NhcScout startup error:', err));
  scouts.gdacs.run().catch(err => console.error('[scouts] GdacsScout startup error:', err));
  scouts.usgs.run().catch(err => console.error('[scouts] UsgsScout startup error:', err));
  scouts.coral.run().catch(err => console.error('[scouts] CoralScout startup error:', err));
}
