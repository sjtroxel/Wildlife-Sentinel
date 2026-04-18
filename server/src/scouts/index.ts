import cron from 'node-cron';
import { FirmsScout } from './FirmsScout.js';
import { NhcScout } from './NhcScout.js';
import { GdacsRssScout } from './GdacsRssScout.js';
import { UsgsScout } from './UsgsScout.js';
import { UsgsEarthquakeScout } from './UsgsEarthquakeScout.js';
import { DroughtScout } from './DroughtScout.js';
import { CoralScout } from './CoralScout.js';
import { GladDeforestationScout } from './GladDeforestationScout.js';
import { NsidcSeaIceScout } from './NsidcSeaIceScout.js';
import { NoaaCpcEnsoScout } from './NoaaCpcEnsoScout.js';
import { GfwFishingScout } from './GfwFishingScout.js';

const scouts = {
  firms:         new FirmsScout(),
  nhc:           new NhcScout(),
  gdacs:         new GdacsRssScout(),
  usgs:          new UsgsScout(),
  earthquake:    new UsgsEarthquakeScout(),
  drought:       new DroughtScout(),
  coral:         new CoralScout(),
  deforestation: new GladDeforestationScout(),
  seaIce:        new NsidcSeaIceScout(),
  enso:          new NoaaCpcEnsoScout(),
  fishing:       new GfwFishingScout(),
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

  // GDACS RSS — every 30 minutes (TC + FL + DR + VO from single RSS feed)
  cron.schedule('*/30 * * * *', () => {
    scouts.gdacs.run().catch(err => console.error('[scouts] GdacsRssScout error:', err));
  });

  // USGS NWIS — every 15 minutes
  cron.schedule('*/15 * * * *', () => {
    scouts.usgs.run().catch(err => console.error('[scouts] UsgsScout error:', err));
  });

  // USGS Earthquake — every 15 minutes (M5.5+ global events)
  cron.schedule('*/15 * * * *', () => {
    scouts.earthquake.run().catch(err => console.error('[scouts] UsgsEarthquakeScout error:', err));
  });

  // US Drought Monitor — Thursday 10:30 AM CT (data releases ~10 AM CT)
  cron.schedule('30 10 * * 4', () => {
    scouts.drought.run().catch(err => console.error('[scouts] DroughtScout error:', err));
  }, { timezone: 'America/Chicago' });

  // NOAA Coral Reef Watch — every 6 hours
  cron.schedule('0 */6 * * *', () => {
    scouts.coral.run().catch(err => console.error('[scouts] CoralScout error:', err));
  });

  // GFW Integrated Alerts (GLAD) — every 24 hours at 08:00 UTC (data publishes ~06:00 UTC)
  cron.schedule('0 8 * * *', () => {
    scouts.deforestation.run().catch(err => console.error('[scouts] GladDeforestationScout error:', err));
  });

  // NSIDC Sea Ice Index — every 24 hours at 09:00 UTC (NRT data updates ~08:00 UTC)
  cron.schedule('0 9 * * *', () => {
    scouts.seaIce.run().catch(err => console.error('[scouts] NsidcSeaIceScout error:', err));
  });

  // NOAA CPC ENSO (ONI) — every 24 hours at 10:00 UTC (ONI updated monthly; daily poll detects changes within 24h)
  cron.schedule('0 10 * * *', () => {
    scouts.enso.run().catch(err => console.error('[scouts] NoaaCpcEnsoScout error:', err));
  });

  // Global Fishing Watch — every 24 hours at 11:00 UTC (checks previous day's vessel activity in MPAs)
  cron.schedule('0 11 * * *', () => {
    scouts.fishing.run().catch(err => console.error('[scouts] GfwFishingScout error:', err));
  });

  console.log('[scouts] All 11 scouts scheduled');

  // Run each immediately on startup so the pipeline has data without waiting.
  // Drought Scout is omitted — it only produces valid data on Thursdays after 10:30 AM CT.
  scouts.firms.run().catch(err => console.error('[scouts] FirmsScout startup error:', err));
  scouts.nhc.run().catch(err => console.error('[scouts] NhcScout startup error:', err));
  scouts.gdacs.run().catch(err => console.error('[scouts] GdacsRssScout startup error:', err));
  scouts.usgs.run().catch(err => console.error('[scouts] UsgsScout startup error:', err));
  scouts.earthquake.run().catch(err => console.error('[scouts] UsgsEarthquakeScout startup error:', err));
  scouts.coral.run().catch(err => console.error('[scouts] CoralScout startup error:', err));
  scouts.deforestation.run().catch(err => console.error('[scouts] GladDeforestationScout startup error:', err));
  scouts.seaIce.run().catch(err => console.error('[scouts] NsidcSeaIceScout startup error:', err));
  scouts.enso.run().catch(err => console.error('[scouts] NoaaCpcEnsoScout startup error:', err));
  scouts.fishing.run().catch(err => console.error('[scouts] GfwFishingScout startup error:', err));
}

/**
 * Immediately runs all daily scouts (GLAD, NSIDC, NOAA CPC, GFW, Coral).
 * Called on pipeline resume so data isn't lost when the app restarts outside
 * the daily cron window. Safe to call multiple times — scouts self-deduplicate.
 */
export function runDailyScoutsNow(): void {
  console.log('[scouts] Running daily scouts on resume');
  scouts.coral.run().catch(err => console.error('[scouts] CoralScout resume error:', err));
  scouts.deforestation.run().catch(err => console.error('[scouts] GladDeforestationScout resume error:', err));
  scouts.seaIce.run().catch(err => console.error('[scouts] NsidcSeaIceScout resume error:', err));
  scouts.enso.run().catch(err => console.error('[scouts] NoaaCpcEnsoScout resume error:', err));
  scouts.fishing.run().catch(err => console.error('[scouts] GfwFishingScout resume error:', err));
}
