import postgres from 'postgres';
import { config } from '../config.js';

export const sql = postgres(config.databaseUrl, {
  ssl: 'require',
  max: 10,
  idle_timeout: 30,
  connect_timeout: 10,
  transform: { undefined: null },
});

process.on('SIGTERM', async () => {
  await sql.end({ timeout: 5 });
});
