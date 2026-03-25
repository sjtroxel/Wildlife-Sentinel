import cron from 'node-cron';
import { FirmsScout } from './FirmsScout.js';

const firmsScout = new FirmsScout();

export function startScouts(): void {
  // Every 10 minutes
  cron.schedule('*/10 * * * *', () => {
    firmsScout.run().catch(err => console.error('[scouts] FirmsScout unhandled error:', err));
  });

  console.log('[scouts] FIRMS Scout scheduled (every 10 min)');

  // Run immediately on startup — don't wait 10 minutes for first data
  firmsScout.run().catch(err => console.error('[scouts] FirmsScout startup run failed:', err));
}
