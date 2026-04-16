function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) {
    console.error(`FATAL: Missing required env var: ${name}`);
    process.exit(1);
  }
  return val;
}

function optionalEnv(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

export const config = {
  databaseUrl: requireEnv('DATABASE_URL'),
  redisUrl: requireEnv('REDIS_URL'),
  discordToken: requireEnv('DISCORD_BOT_TOKEN'),
  discordClientId: requireEnv('DISCORD_CLIENT_ID'),
  discordGuildId: requireEnv('DISCORD_GUILD_ID'),
  discordChannelWildlifeAlerts: requireEnv('DISCORD_CHANNEL_WILDLIFE_ALERTS'),
  discordChannelSentinelOps: requireEnv('DISCORD_CHANNEL_SENTINEL_OPS'),
  nasaFirmsKey: requireEnv('NASA_FIRMS_API_KEY'),
  googleAiKey: requireEnv('GOOGLE_AI_API_KEY'),
  anthropicKey: requireEnv('ANTHROPIC_API_KEY'),
  iucnApiToken: requireEnv('IUCN_API_TOKEN'),
  gfwApiKey: requireEnv('GFW_API_KEY'),
  fishingWatchApiKey: optionalEnv('FISHING_WATCH_API_KEY', ''),
  port: parseInt(optionalEnv('PORT', '3000'), 10),
  nodeEnv: optionalEnv('NODE_ENV', 'development'),
  allowedOrigins: optionalEnv('ALLOWED_ORIGINS', 'http://localhost:3001').split(','),
  isProduction: process.env['NODE_ENV'] === 'production',
  // Falls back to first ALLOWED_ORIGINS entry so only one variable is needed in practice.
  frontendUrl: optionalEnv('FRONTEND_URL', optionalEnv('ALLOWED_ORIGINS', '').split(',')[0] ?? ''),
} as const;
