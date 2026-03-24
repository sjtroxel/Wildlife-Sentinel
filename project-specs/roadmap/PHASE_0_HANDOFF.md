# Phase 0 Handoff — Do These Before Writing Code

*Complete every item on this list before starting Phase 0 implementation. Tell Claude at the start of the next session which ones are done.*

---

## 1. IUCN Red List — Shapefile Download

**What it is:** The IUCN provides geographic range maps (polygon shapes) for every endangered species. We need these to load into our database so we know WHERE each species lives.

**Good news: No approval process.** Just create a free account and download directly.

**Steps:**
1. Go to: `https://www.iucnredlist.org/resources/spatial-data-download`
2. Create a free account if you don't have one (or log in)
3. Accept the terms of use when prompted
4. On the download page, find **"Terrestrial Mammals"** → click **"polygon 815MB"** to download
   - This one file covers: orangutans, tigers, gorillas, giant pandas, elephants, condors, Florida panther, koala — everything we need for Phase 1 and 2
   - It's a large zip file — save it somewhere you won't lose it (e.g., a `data/` folder outside the repo)
5. Optionally also download **"Marine Mammals"** (<500MB) for Phase 4+ coral/marine work

**Also do:** Get a free IUCN API token while you're there:
- Go to: `https://apiv3.iucnredlist.org/`
- Click "Register" → get a free API token
- Save it — goes in `.env` as `IUCN_API_TOKEN`

**Note:** The 815MB download may take a few minutes depending on your connection. You don't need to unzip it yet — just have it saved and ready. We'll load it into PostGIS during Phase 2 using a script we'll write together.

---

## 2. NASA FIRMS API Key — 5 Minutes

**What it is:** Wildfire satellite detection data. The first Scout agent polls this every 10 minutes.

**How to get it:**
1. Go to: `https://firms.modaps.eosdis.nasa.gov/api/`
2. Click "Register" or "Get API Key" (NASA Earthdata account required)
3. If you don't have a NASA Earthdata account: `https://urs.earthdata.nasa.gov/users/new`
4. Once registered, your API key appears on the FIRMS account page
5. Save it — goes in `.env` as `NASA_FIRMS_API_KEY`

---

## 3. Neon Database — 5 Minutes

**What it is:** Our PostgreSQL database host, replacing Supabase. Free plan has 3GB (vs Supabase's 500MB). Supports PostGIS (spatial queries) and pgvector (RAG embeddings).

**How to set it up:**
1. Go to: `https://neon.tech`
2. Sign up (GitHub login works)
3. Create a new project — name it `wildlife-sentinel`
4. Choose a region close to you (US East works fine)
5. On the dashboard, find the **Connection String** — it looks like:
   `postgresql://user:password@host.neon.tech/neondb?sslmode=require`
6. Save it — goes in `.env` as `DATABASE_URL`
7. In the Neon SQL editor, run these two commands to enable our extensions:
   ```sql
   CREATE EXTENSION IF NOT EXISTS postgis;
   CREATE EXTENSION IF NOT EXISTS vector;
   ```
8. Confirm both extensions appear when you run:
   ```sql
   SELECT extname FROM pg_extension WHERE extname IN ('postgis', 'vector');
   ```

---

## 4. Google AI API Key — 5 Minutes

**What it is:** Gives access to Gemini 2.5 Flash, Gemini 2.5 Flash-Lite, and text-embedding-004. The free tier covers all our high-volume agents.

**How to get it:**
1. Go to: `https://aistudio.google.com/app/apikey`
2. Sign in with your Google account
3. Click "Create API Key"
4. Save it — goes in `.env` as `GOOGLE_AI_API_KEY`

---

## 5. Discord Bot — 10 Minutes

**What it is:** The bot that posts alerts to your Discord server.

**How to create it (even if you already have a bot, create a fresh one for this project):**
1. Go to: `https://discord.com/developers/applications`
2. Click "New Application" — name it "Wildlife Sentinel"
3. Go to the "Bot" tab on the left
4. Click "Add Bot" → confirm
5. Under "Token" click "Reset Token" → copy and save it immediately (you won't see it again)
   - Goes in `.env` as `DISCORD_BOT_TOKEN`
6. Scroll down to "Privileged Gateway Intents" — enable:
   - Server Members Intent
   - Message Content Intent
7. Go to "OAuth2" → "URL Generator":
   - Scopes: check `bot`
   - Bot Permissions: check `Send Messages`, `Embed Links`, `Add Reactions`, `Read Message History`, `View Channels`
8. Copy the generated URL, open it in your browser, and add the bot to your Discord server

**Get your Server ID:**
- In Discord, go to Settings → Advanced → Enable Developer Mode
- Right-click your server name → "Copy Server ID"
- Goes in `.env` as `DISCORD_GUILD_ID`

---

## 6. Discord Channels — 5 Minutes

In your Discord server, create exactly two channels:

1. **#wildlife-alerts** — set to Public (everyone can see it)
2. **#sentinel-ops** — set to Private (only you/admins)

After creating them, get each channel's ID:
- Right-click the channel name → "Copy Channel ID" (Developer Mode must be on — see step above)
- `#wildlife-alerts` ID → goes in `.env` as `DISCORD_CHANNEL_WILDLIFE_ALERTS`
- `#sentinel-ops` ID → goes in `.env` as `DISCORD_CHANNEL_SENTINEL_OPS`

---

## 7. Your .env File (Server)

Once all the above is done, create `server/.env` with:

```
DATABASE_URL=postgresql://...your neon connection string...
DISCORD_BOT_TOKEN=...your bot token...
DISCORD_GUILD_ID=...your server ID...
DISCORD_CHANNEL_WILDLIFE_ALERTS=...channel ID...
DISCORD_CHANNEL_SENTINEL_OPS=...channel ID...
NASA_FIRMS_API_KEY=...your firms key...
GOOGLE_AI_API_KEY=...your google key...
ANTHROPIC_API_KEY=...your existing anthropic key...
IUCN_API_TOKEN=...your iucn token...
NODE_ENV=development
PORT=3000
REDIS_URL=redis://localhost:6379
```

**Never commit this file.** It should already be in `.gitignore`.

---

## 8. What to Tell Claude at the Start of the Next Session

Say something like:

> "Good morning. Please run /phase-check, then review and expand every spec and rules doc we wrote last session. Here's what I've completed from the handoff list: [list what you've done]. IUCN shapefile is still pending / arrived [whichever is true]."

Claude will check your session checklist, expand all the planning docs, and then you'll be ready to start Phase 0 implementation.

---

## Priority Order

| Priority | Item | Time Required |
|---|---|---|
| 🔴 Do TODAY | IUCN shapefile download (Terrestrial Mammals, 815MB) | 10 min — account + download |
| 🟡 Do soon | NASA FIRMS API key | 5 min |
| 🟡 Do soon | Neon database setup | 5 min |
| 🟡 Do soon | Google AI API key | 5 min |
| 🟡 Do soon | Discord bot + channels | 10 min |
| 🟢 After above | Fill in .env file | 5 min |
