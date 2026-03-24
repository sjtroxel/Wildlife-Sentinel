# Discord Rules

## Channel Structure (Minimal)

Two channels only:
- `#wildlife-alerts` — **Public.** Final synthesized alerts. Clean, informative embeds. This is the product.
- `#sentinel-ops` — **Private (admin only).** Everything else: raw event logs, agent reasoning, pipeline health, critical alerts pending HITL review.

Channel IDs are stored in environment variables:
- `DISCORD_CHANNEL_WILDLIFE_ALERTS`
- `DISCORD_CHANNEL_SENTINEL_OPS`

## Alert Routing Logic

```
threat_level === 'low'     → do NOT post anywhere. Log to DB only.
threat_level === 'medium'  → post directly to #wildlife-alerts
threat_level === 'high'    → post directly to #wildlife-alerts
threat_level === 'critical'→ post to #sentinel-ops first (HITL)
                              user reacts ✅ to approve → bot reposts to #wildlife-alerts
```

## Discord Embed Structure

Every alert to `#wildlife-alerts` is a rich Discord embed:

```typescript
const embed = new EmbedBuilder()
  .setColor(getThreatColor(alert.threat_level))  // red=critical, orange=high, yellow=medium
  .setTitle(`${getEventEmoji(alert.event_type)} ${alert.species_at_risk[0]} — ${alert.threat_level.toUpperCase()} THREAT`)
  .setDescription(alert.synthesized_narrative)   // 2-3 sentences from Synthesis Agent
  .addFields(
    { name: 'Disaster', value: `${alert.event_type} (${alert.source})`, inline: true },
    { name: 'Distance', value: `${alert.habitat_distance_km.toFixed(1)} km from habitat`, inline: true },
    { name: 'Confidence', value: `${(alert.confidence_score * 100).toFixed(0)}%`, inline: true },
    { name: 'At-Risk Species', value: alert.species_at_risk.slice(0, 3).join(', ') },
    { name: 'IUCN Status', value: alert.species_briefs[0]?.iucn_status ?? 'Unknown' },
  )
  .setFooter({ text: 'Wildlife Sentinel • Data: NASA FIRMS / NOAA / USGS / IUCN' })
  .setTimestamp();
```

Tone: informative, not alarmist. A knowledgeable friend telling you something important is happening, not a panic alert.

## HITL (Human-in-the-Loop) Pattern for Critical Alerts

```typescript
// Post to #sentinel-ops with a pending indicator
const reviewMsg = await sentinelOpsChannel.send({
  content: '🔴 **CRITICAL ALERT — AWAITING REVIEW** — React ✅ to approve for public posting',
  embeds: [embed],
});
await reviewMsg.react('✅');

// Listen for reaction
const collector = reviewMsg.createReactionCollector({
  filter: (reaction, user) => reaction.emoji.name === '✅' && !user.bot,
  max: 1,
  time: 24 * 60 * 60 * 1000,  // 24 hour window
});

collector.on('collect', async () => {
  await wildlifeAlertsChannel.send({ embeds: [embed] });
  await reviewMsg.edit({ content: '✅ **Approved and posted to #wildlife-alerts**' });
});
```

## Observability Posts (to #sentinel-ops)

The Discord Publisher also posts brief agent activity logs to `#sentinel-ops`. These are plain text (not embeds) and use a consistent format:

```
[scout:nasa_firms] 🔥 Fire detected: lat=-3.42, lng=104.21, FRP=87.3 MW
[enrichment] ⚠️ Habitat overlap: Sumatran Orangutan critical habitat 18.3km — enriching
[threat_assessment] 🟡 Threat: MEDIUM | Confidence: 0.74 | Predicted: NW spread 40km/24h
[synthesis] 📤 Posting alert to #wildlife-alerts
```

## Discord Bot Setup

- Library: discord.js v14
- Bot token: `DISCORD_BOT_TOKEN` env var
- Guild ID: `DISCORD_GUILD_ID` env var
- Required intents: `GatewayIntentBits.Guilds`, `GatewayIntentBits.GuildMessages`, `GatewayIntentBits.GuildMessageReactions`
- Required permissions: Send Messages, Embed Links, Add Reactions, Read Message History

## What NOT to Do

- Do NOT post raw JSON or API responses to Discord — always format as embeds or clean text
- Do NOT post 'low' threat level events — they generate noise and desensitize users
- Do NOT use the bot token in frontend code — server-side only
- Do NOT auto-post 'critical' alerts — always route through HITL review first
