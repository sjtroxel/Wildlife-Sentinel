# New Project Brief — For a Fresh Claude Code Session

*This document is a complete briefing for starting a new project from scratch. It is self-contained. A new Claude Code session in a new repository should read this file in full before doing anything else. It captures all context, decisions, goals, and architectural thinking developed across prior brainstorming sessions.*

---

## 1. Who the Developer Is

**Handle:** sjtroxel
**Level:** Junior-to-mid developer, progressing rapidly through an advanced AI Masterclass curriculum.
**Background:** Not a career developer by origin. Has been building a portfolio of increasingly sophisticated AI projects, each one targeting new curriculum concepts. Has strong TypeScript instincts now. Understands agent patterns, RAG, and vector databases from hands-on work.

**Imposter syndrome note:** sjtroxel sometimes undersells their own progress. By the end of Asteroid Bonanza (see below), they had built a production-deployed, multi-agent AI swarm with dual RAG indices, confidence scoring, human handoff, real-time SSE observability streaming, and a Three.js orbital visualization. That is not junior work.

---

## 2. Prior Projects (The Portfolio So Far)

Understanding these is important — the new project must be clearly distinct from all of them in subject matter AND in architectural patterns.

### Chrono-Quizzr
- **What it is:** A history trivia game. Users answer questions about historical events and figures.
- **Tech highlights:** Used Claude Haiku for cheap, fast quiz generation. Basic Express + React stack.
- **Subject matter:** History.

### Poster-Pilot
- **What it is:** An AI-powered poster generator. Users describe a theme; the system generates a poster-style visual using historical archival images from DPLA (Digital Public Library of America) + AI-synthesized layout.
- **Tech highlights:** DPLA API for archival images (NARA API was tried but failed — important lesson about API reliability). Claude for text synthesis. Basic multi-step pipeline.
- **Subject matter:** History / archival arts.
- **Lesson learned:** Even if you don't love the subject matter, a compelling project mechanic can carry you through. sjtroxel didn't especially care about posters but loved building Poster-Pilot.

### Asteroid Bonanza (most recent — the benchmark to beat)
- **What it is:** A full AI intelligence platform for analyzing near-Earth asteroids across four dimensions: orbital accessibility, mineral composition, resource economics, and planetary defense risk.
- **Phases completed:** All 9 (Foundation through Observability Polish). Fully deployed.
- **Tech stack:**
  - Frontend: Angular 21, signals-first, Tailwind CSS v4, TypeScript strict
  - Backend: Node.js 22, Express 5, TypeScript strict, NodeNext module resolution
  - AI: Anthropic SDK direct (no LangChain), Claude Sonnet 4.6 (orchestrator + domain agents), Claude Haiku 4.5 (classification tasks)
  - Embeddings: Voyage AI `voyage-large-2-instruct` (1024-dim), cosine similarity
  - Database: Supabase (PostgreSQL + pgvector extension)
  - RAG: Dual index — `science_chunks` (hard facts) + `scenario_chunks` (2050 projections)
  - Real-time: SSE streaming for agent observability — each tool call, RAG lookup, and synthesis token streamed live to frontend
  - Deployment: Railway (backend) + Vercel (frontend)
  - Monorepo: npm workspaces (client, server, shared, scripts)
- **Agent architecture:** Four domain agents (Navigator, Geologist, Economist, Risk Assessor) + Lead Orchestrator. Agents communicate via `SwarmState` object. Confidence scoring computed from observable fields, never self-reported. Human handoff at threshold 0.30.
- **Subject matter:** Space science / near-Earth asteroids.
- **What it did NOT include (important):** Redis Streams as a true message bus, a Refiner/Evaluator learning loop, multi-model routing, an AI gateway layer, PostGIS spatial queries, Discord integration, or autonomous scheduled/push-model operation.

---

## 3. What the New Project Must Accomplish

### Curriculum goals (things not yet built)

The AI Masterclass curriculum covered several advanced patterns that Asteroid Bonanza did not implement. The new project is specifically designed to teach and demonstrate all of them:

**a) Redis Streams as a true message bus**
In Asteroid Bonanza, agents communicated via a shared `SwarmState` object — essentially passing a baton directly hand-to-hand. Redis Streams are different: each agent *publishes* to a named stream and *walks away*. Downstream agents *subscribe* to that stream and consume messages independently. This is a factory conveyor belt, not a relay race. If one agent crashes, messages queue up and wait. The system is resilient. This is the industry-standard pattern for high-volume, asynchronous agent pipelines and sjtroxel has not built one yet.

**b) The Refiner / Evaluator Loop (the "swarm that learns")**
In Asteroid Bonanza, agents had static system prompts. They analyzed data and produced outputs, but those outputs never fed back to improve the agents themselves. A Refiner/Evaluator loop adds a fifth agent whose job is to: (1) compare an agent's prediction or output against a known outcome or rubric, (2) score it, and (3) *rewrite that agent's system prompt* for the next run to address the failure. Over time, the system gets better. This is the closest pattern to actual machine learning at the prompt-engineering level.

**c) The Data Enrichment Pattern**
A background enrichment step where raw data is silently augmented with additional metadata before it ever reaches the main agents. For example: a raw fire event arrives with just coordinates and intensity — an enrichment agent silently attaches wind direction, atmospheric pressure, and habitat proximity data before the event is processed by the main swarm. This creates cleaner agent inputs and separates concerns properly.

**d) Multi-model routing (cheap models for volume, expensive for synthesis)**
Asteroid Bonanza used Claude Sonnet for most things. That gets expensive at scale. The mature pattern is: use Gemini Flash (or another cheap, fast model) for high-volume "reading" tasks (parsing API responses, enrichment, classification), and reserve Claude Sonnet only for synthesis, nuanced reasoning, and the final output. An AI Gateway layer (LiteLLM) sits in the middle and routes requests to the appropriate model transparently.

**e) LiteLLM as an AI Gateway Layer**
LiteLLM is a Python/Node library that presents a single OpenAI-compatible API surface regardless of which underlying model you're using. You configure it once with your Anthropic and Google keys, and your agents just call `litellm.completion(model="gemini/gemini-1.5-flash", ...)` or `litellm.completion(model="claude-sonnet-4-6", ...)` interchangeably. It also tracks token costs per model. This is a Week 5/6 Masterclass concept not yet implemented.

**f) Push-model / autonomous operation**
All prior projects required a user to open an app and trigger something. The new project runs 24/7 without a human prompt. The world triggers it. This is a fundamentally different deployment model.

### Subject matter goals

- **Not space.** Done.
- **Not history.** Done twice.
- **Should be emotionally resonant** — the subject matter should make you want to keep building even when it gets hard.
- **Data sources must be bulletproof** — government or major scientific institution APIs only. The NARA API failure in Poster-Pilot and the occasional PDF access issues in Asteroid Bonanza are cautionary tales.

---

## 4. Architecture Decisions Already Made

- **Primary output: Discord bot.** This is a "push model" — the system monitors the world and speaks up when something happens. A traditional web app that a user has to check is the wrong form factor for this kind of project. sjtroxel already has a Discord server. The bot lives there.
- **Secondary output: Simple read-only web frontend.** Portfolio visitors who are not on Discord need somewhere to see the project. A simple page showing recent alerts + a live map is sufficient. This is NOT the primary interface.
- **TypeScript throughout.** Not Python. This is consistent with all prior projects and is where sjtroxel's fluency is strongest.
- **No LangChain.** Direct SDK usage. This was a firm decision in Asteroid Bonanza and carries forward.
- **Supabase** for PostgreSQL. Familiar, already set up.
- **Railway** for hosting the backend + Redis + bot process. Already familiar.
- **Vercel** for the frontend if Angular or Next.js. Already familiar.
- **Git commits by user only.** Claude Code must never run `git commit`, never suggest co-authorship, and never push to remote. When a block of work is done, summarize and prompt the user to commit.

---

## 5. Primary Project: "Wildlife Sentinel" — Wildlife Crisis Intelligence Discord Bot

### The Core Concept

A 24/7 autonomous intelligence system that monitors multiple types of natural disasters happening globally, right now, and assesses whether each disaster event poses a threat to a known critical habitat or endangered species range. When a threat is detected, a multi-agent swarm analyzes the situation in depth and posts a structured alert to Discord.

The name "Wildlife Sentinel" captures the idea: a sentinel stands post and raises the alarm. For some species, this system is the most attentive observer they have. It never sleeps.

### Why This Works (the non-biology framing)

sjtroxel felt intimidated by "biology" as a domain. The reframe: this is not a biology project. It is a **geospatial event correlation pipeline**. The interesting engineering problems are: *how do you route a continuous stream of disaster events through a multi-agent enrichment pipeline efficiently?* and *how do you learn from your own predictions over time?* The animals are the domain vocabulary. The engineering is the star.

This is the same relationship sjtroxel had with asteroid orbital mechanics in Asteroid Bonanza — you don't need to be a physicist. You need to understand APIs, agents, and data flows.

### The Emotional Hook

sjtroxel mentioned remembering as a child reading about giant pandas, Siberian tigers, and other endangered animals and being moved by their precariousness. That connection is real and is worth trusting. Projects built on genuine feeling tend to get finished.

### What Triggers an Alert (the five disaster streams)

All five of these feed into the same Redis pipeline. The species/habitat overlap logic is identical regardless of which disaster type arrives. Adding more streams is additive, not structural:

**1. Wildfires — NASA FIRMS**
- API: `https://firms.modaps.eosdis.nasa.gov/api/`
- Data: Real-time satellite fire detections (MODIS and VIIRS sensors), updated every 10 minutes for NRT (Near Real-Time) data
- Returns: coordinates, fire radiative power (FRP), acquisition time, confidence level (low/nominal/high)
- Auth: Free API key required (NASA FIRMS registration)
- Reliability: NASA infrastructure. Physically cannot go down without global news coverage.
- Why it's the right source: FIRMS is what professional fire agencies use. It's the authoritative global record.

**2. Tropical Storms & Hurricanes — NOAA NHC**
- API: `https://www.nhc.noaa.gov/CurrentStorms.json` (active storms)
- RSS feeds: `https://www.nhc.noaa.gov/nhc_at1.xml` (Atlantic), `nhc_ep1.xml` (Eastern Pacific)
- Data: Storm center coordinates, projected track, wind speed, storm surge forecasts, landfall predictions
- Auth: None required
- Reliability: NOAA is the US federal weather service. The NHC data is the same data used for evacuation orders.
- Note: Seasonal (Atlantic: June–November), but the Pacific and other basins fill the off-season. When active, these events are high-stakes and high-visibility.

**3. River Flooding — USGS Water Services (NWIS)**
- API: `https://waterservices.usgs.gov/nwis/iv/`
- Data: Real-time streamflow (discharge in cubic feet/second) and river stage (height) from 1.5+ million gauging stations across the US
- Endpoint pattern: `?sites=&parameterCd=00060&format=json` (discharge) or `parameterCd=00065` (gage height)
- Auth: None required
- Reliability: US Geological Survey federal infrastructure. Extremely stable. Used by emergency managers nationwide.
- Trigger logic: When a river gauge crosses "Flood Stage" (a threshold stored per site in the NWIS database), it fires into the pipeline.
- Note: Flood-prone rivers can cross flood stage dozens of times per year. This stream will be one of the most active.

**4. Drought — US Drought Monitor**
- API: `https://droughtmonitor.unl.edu/DmData/GISData.aspx` (GeoJSON weekly maps)
- Data: Drought severity by county/region (D0 Abnormally Dry → D4 Exceptional Drought), updated every Thursday
- Auth: None required
- Reliability: Joint product of NOAA, USDA, and University of Nebraska. Federal standard. Extremely stable.
- Trigger logic: When a region's drought status worsens (e.g., upgrades from D2 to D3 or D4), or when a region containing critical habitat first enters D3/D4 status, it fires into the pipeline.
- Note: Lower frequency than fires or floods, but droughts are slow-moving catastrophes for wildlife. The system should treat worsening drought as a genuine threat event.

**5. Coral Bleaching — NOAA Coral Reef Watch**
- API: `https://coralreefwatch.noaa.gov/product/5km/index.php`
- Data: Satellite sea surface temperature anomalies, bleaching alert levels (Watch, Warning, Alert 1, Alert 2) by reef location
- Auth: None required (data available as CSV/GeoJSON products)
- Reliability: NOAA federal infrastructure. The global scientific standard for coral bleaching monitoring.
- Trigger logic: When any reef location reaches "Bleaching Alert Level 1" or higher, it fires into the pipeline.
- Note: Marine species (fish, sea turtles, invertebrates) with habitats centered on threatened reefs are at direct risk.

### The Species / Habitat Data Sources

**IUCN Red List API**
- API: `https://apiv3.iucnredlist.org/api/v3/`
- What it provides: Global species assessments (status: Least Concern / Near Threatened / Vulnerable / Endangered / Critically Endangered / Extinct in Wild / Extinct), geographic range maps (shapefiles / GeoJSON polygons), threat categorization, population trend data
- Auth: Free API token (register at iucnredlist.org)
- Reliability: This is THE global authority on extinction risk. Used by governments, zoos, conservation organizations worldwide. The data is physically verified by a network of thousands of scientists.
- Key endpoints:
  - `/species/count` — total count by category
  - `/species/category/{category}` — list of species by threat status
  - `/weblink/{name}` — species detail
  - `/species/spatial` — spatial range query (lat/lng bounding box)
- Important note: The IUCN range shapefiles should be downloaded once during setup and stored in PostGIS (PostgreSQL with spatial extension) for fast local querying. Do NOT hit the IUCN API for every disaster event — you will hit rate limits. Pre-load the spatial data.

**GBIF (Global Biodiversity Information Facility)**
- API: `https://api.gbif.org/v1/`
- What it provides: Species occurrence records — where animals have actually been observed, by whom, when. Uses Darwin Core standard.
- Key endpoint: `/occurrence/search?decimalLatitude=&decimalLongitude=&radius=` for geo-bounded searches
- Auth: None required for read operations
- Reliability: International backbone for biodiversity data. Extremely fast and stable. Used by virtually every major conservation organization on Earth.
- Role in this project: Cross-reference — after the IUCN range query identifies which species *should* be in the disaster zone, GBIF provides recent confirmed sightings, confirming actual current presence.

**Open-Meteo (Weather Enrichment)**
- API: `https://api.open-meteo.com/v1/forecast`
- What it provides: Free, no-auth weather forecasts including wind speed, wind direction, precipitation probability, temperature
- Auth: None required
- Role in this project: Used by the enrichment agent to attach current weather context to fire events (critical for spread prediction), storm events (intensity forecasting), and drought events (soil moisture / evaporation rate).

### The Redis Streams Pipeline Architecture

Every disaster event, regardless of source, flows through the same series of streams. This is the true message bus pattern — agents publish and consume independently.

```
[Scout Agents]          [Enrichment]         [Intelligence Swarm]      [Output]
  NASA FIRMS  ──┐
  NOAA NHC   ──┤──► disaster:raw ──► disaster:enriched ──► alerts:assessed ──► discord:queue
  USGS NWIS  ──┤
  Drought Mon ──┤
  Coral Watch ──┘
```

**Stream: `disaster:raw`**
- Published by: Five Scout agents (one per disaster source), running on cron schedules
- Message payload: `{ source, event_type, coordinates, severity, timestamp, raw_data }`
- Consumer: Enrichment Agent

**Stream: `disaster:enriched`**
- Published by: Enrichment Agent
- Message payload: All fields from raw + `{ wind_direction, wind_speed, nearby_habitat_ids[], species_at_risk[], habitat_distance_km }`
- Consumer: Intelligence Swarm (Habitat Agent + Species Agent + Threat Assessment Agent)
- Note: If no IUCN habitat exists within the configured radius, the event is dropped here. Only events with confirmed habitat overlap proceed.

**Stream: `alerts:assessed`**
- Published by: Threat Assessment Agent
- Message payload: Full enriched event + `{ threat_level: 'low'|'medium'|'high'|'critical', predicted_impact, species_detail[], recommended_action, confidence_score }`
- Consumer: Synthesis Agent

**Stream: `discord:queue`**
- Published by: Synthesis Agent (for 'medium'/'high'/'critical' alerts) or directly dropped (for 'low')
- Consumer: Discord Publisher
- Note: 'critical' alerts route to a human-review channel first (HITL pattern). 'medium'/'high' post automatically.

### Agent Design

**Scout Agents (5 total — one per data source)**
- Model: No LLM needed — pure Node.js polling scripts
- Schedule: NASA FIRMS every 10 min; NOAA NHC every 30 min; USGS every 15 min; Drought Monitor every Thursday at 10:00 AM CT; Coral Reef Watch every 6 hours
- Job: Pull new events from their respective API, normalize to the standard `RawDisasterEvent` schema, publish to `disaster:raw` stream

**Enrichment Agent**
- Model: Gemini Flash (cheap — high volume reads, simple spatial math)
- Job: Consume from `disaster:raw`. For each event:
  1. Query local PostGIS for IUCN habitat polygons within configurable radius (default 75km)
  2. If no overlap: drop event
  3. If overlap: pull weather data from Open-Meteo, attach habitat IDs and species, publish to `disaster:enriched`
- This agent runs at high volume (every fire event globally). Gemini Flash cost: roughly $0.00015 per 1M input tokens. This is the right model here.

**Habitat Agent**
- Model: Gemini Flash
- Job: Consume from `disaster:enriched`. For each identified species in the habitat overlap, query GBIF for recent confirmed sightings in the area, assessing current presence. Attach to message.

**Species Context Agent**
- Model: Gemini Flash + RAG (see RAG section below)
- Job: For each at-risk species, retrieve its IUCN status, population trend, key threats, and any relevant conservation context from the RAG knowledge base. Build a species brief.

**Threat Assessment Agent**
- Model: Claude Sonnet 4.6 (this is where nuanced reasoning is needed)
- Job: Take all enriched data and compute a structured threat assessment:
  - Is this disaster type a historically significant threat to this species?
  - What is the likely progression (next 24-72 hours)?
  - What is the threat level (low/medium/high/critical)?
  - What is the confidence score?
  - Are there compounding factors (e.g., this species is already at historic population low)?

**Synthesis Agent (Team Lead)**
- Model: Claude Sonnet 4.6
- Job: Generate the final Discord message as a rich embed. Must include: species name and status, disaster type and current severity, distance from habitat boundary, predicted trajectory, confidence score, and a link to an appropriate conservation organization. Tone should be informative, not alarmist.

**Refiner / Evaluator Agent (the learning loop)**
- Model: Claude Sonnet 4.6
- Schedule: Runs 24 and 48 hours after each fire/storm alert
- Job:
  1. Pull the original prediction from the database (what did we say would happen?)
  2. Pull current NASA FIRMS / NOAA data for the same coordinates
  3. Compare: did the fire spread in the predicted direction? Did the storm hit the predicted location?
  4. Score the prediction quality (0–1 scale, computed from observable field deltas — not self-reported)
  5. If score < 0.6: write a "Correction Note" that identifies exactly what was wrong (e.g., "underweighted offshore wind speed") and update the Threat Assessment Agent's system prompt in the database for future runs
  6. Log score to `refiner_scores` table for trend visualization on the frontend

### Discord Server Structure

Create the following channels in sjtroxel's Discord server:

- `#the-last-watch-alerts` — **Public.** Final synthesized alerts only. This is the "product." Clean, informative posts with species name, disaster type, risk level, and conservation link.
- `#sentinel-raw-feed` — **Private (admin only).** Every event the Scout agents detect globally, before habitat filtering. Gives visibility into the volume of the data pipeline.
- `#sentinel-war-room` — **Private (admin only).** Agent reasoning logs — visible intelligence: "Enrichment Agent: Fire at (-3.4, 104.2) is 18km from Sumatran Orangutan critical habitat..." This is the observability layer analogous to Asteroid Bonanza's SSE panels.
- `#sentinel-needs-review` — **Private (admin only).** Where 'critical'-level alerts land before posting. Human approves with a ✅ reaction; bot watches for the reaction and then posts to `#the-last-watch-alerts`.
- `#weekly-digest` — **Public.** Every Sunday, an automated weekly summary: how many events were detected, how many resulted in alerts, which habitats were most active, Refiner score trends.

### The Lightweight Frontend

The frontend exists to serve portfolio visitors who aren't on Discord. It is NOT the primary experience. Keep it simple.

**What it should show:**
- A world map (Leaflet.js, not Three.js — this is a simpler project) showing:
  - Active disaster events (color-coded by type: red = fire, blue = flood, orange = storm, yellow = drought, teal = coral bleaching)
  - IUCN critical habitat polygons (visible when zoomed in)
  - Lines connecting active threats to the habitats they're threatening
- A "Recent Alerts" feed — the last 15-20 Discord posts, mirrored from the database
- An "Agent Activity" panel — real-time stream of what the agents are doing right now (SSE-powered, same pattern as Asteroid Bonanza's observability)
- A simple header explaining what the project is

**What it should NOT have:**
- User accounts / authentication
- Search or filtering (that's for a v2)
- Complex interaction — just observation

**Tech:** Could stay Angular (familiar) or try Next.js (simpler for a read-only informational page). This is an open decision for discussion at the start of the project.

### RAG Knowledge Base

Two indices (consistent with Asteroid Bonanza's dual-index pattern):

**`species_facts` index:**
- Content: IUCN species assessment summaries (downloadable as PDFs from IUCN Red List), WWF species profiles, Smithsonian NMNH species records
- Purpose: Grounding the Species Context Agent — when it says "the Sumatran Orangutan relies on lowland forest for nesting," it should cite a source, not hallucinate
- Chunk strategy: Per-species documents, chunked by topic (habitat, diet, threats, conservation status, population)

**`conservation_context` index:**
- Content: WWF Living Planet reports, IPBES (Intergovernmental Science-Policy Platform on Biodiversity) assessments, conservation case studies
- Purpose: Grounding the Synthesis Agent's "why this matters" framing in the Discord alerts

### The Learning Loop in Detail

This is one of the most important new skills to implement. It should feel like a first-class feature, not an afterthought.

**For fire events specifically (clearest feedback signal):**
1. At time T=0: Threat Assessment Agent predicts spread direction and radius in next 24h based on wind data
2. At T=24: Refiner Agent queries NASA FIRMS for actual fire perimeter at those coordinates
3. Comparison: Did the fire actually spread in the predicted direction? By how much?
4. Scoring rubric (deterministic math, not LLM judgment):
   - Direction accuracy: actual spread bearing vs predicted bearing, scored 0–1 (1 = within 15 degrees)
   - Magnitude accuracy: actual spread area vs predicted area, scored 0–1 (1 = within 20%)
   - Composite score = 0.6 * direction + 0.4 * magnitude
5. If composite < 0.60:
   - Refiner Agent (Claude Sonnet) analyzes what variables were present when prediction was wrong
   - Generates a "System Prompt Update" — a specific addition to the Threat Assessment Agent's context for fire spread scenarios
   - The update is stored in the database and prepended to future Threat Assessment Agent calls
6. If composite > 0.85: Refiner logs success and increments confidence in current heuristics

**For storm events:** Predicted landfall location vs actual NHC track update 12h later
**For drought:** Predicted severity escalation vs next Thursday's Drought Monitor update
**For floods:** Predicted downstream impact radius vs actual gauge readings 6h later

The Refiner's score history should be visible on the frontend as a trend chart — showing the system's accuracy improving over time.

### PostGIS Setup Note

The IUCN Red List provides species range maps as shapefiles. During the project setup phase, these shapefiles need to be:
1. Downloaded (IUCN provides bulk download for registered accounts)
2. Loaded into PostgreSQL with the PostGIS extension enabled (`CREATE EXTENSION postgis;`)
3. Indexed with a spatial index (`CREATE INDEX ON species_ranges USING GIST (geom);`)
4. Queried via `ST_DWithin(geom, ST_Point(lng, lat)::geography, radius_meters)` for fast proximity lookups

This replaces hitting the IUCN API on every event, which would quickly exceed rate limits.

### Suggested Phase Roadmap

**Phase 0: Foundation**
- New repo, npm workspaces (server, scripts, client), TypeScript strict, Supabase setup, PostGIS enabled
- Discord bot skeleton using discord.js — bot connects to server, can post a test message
- Railway project created, basic deployment configured
- Redis instance provisioned on Railway

**Phase 1: Single Scout + Basic Pipeline**
- NASA FIRMS Scout agent implemented and polling
- `disaster:raw` Redis Stream working
- Enrichment Agent (no LLM yet — just PostGIS lookup) filtering events by habitat proximity
- Basic Discord post when fire + habitat overlap detected
- Small batch of IUCN critical habitat polygons loaded into PostGIS for testing (start with 5-10 species in fire-prone regions: Sumatran Orangutan, California Condor, Florida Panther, Koala, Giant Panda)

**Phase 2: Full Habitat Coverage + Species Data**
- Full IUCN critical habitat shapefiles loaded for all Critically Endangered + Endangered species
- GBIF integration for occurrence cross-reference
- Species Context Agent with Gemini Flash

**Phase 3: LiteLLM Gateway + Multi-Model Routing**
- LiteLLM configured as gateway layer
- Gemini Flash routing for enrichment/species agents
- Claude Sonnet routing for threat assessment + synthesis
- Token cost tracking enabled

**Phase 4: All Five Disaster Sources**
- NOAA NHC storm Scout added
- USGS flood Scout added
- US Drought Monitor Scout added
- NOAA Coral Reef Watch Scout added
- All feeding into same `disaster:raw` stream

**Phase 5: Full Agent Swarm + Discord War Room**
- Threat Assessment Agent (Claude Sonnet) fully implemented
- Synthesis Agent with rich Discord embeds
- `#sentinel-war-room` observability channel live
- HITL review flow for critical-level alerts

**Phase 6: RAG Knowledge Base**
- `species_facts` and `conservation_context` Supabase vector tables
- Document ingestion pipeline (Voyage AI embeddings)
- Species Context Agent and Synthesis Agent grounded in RAG

**Phase 7: Refiner / Evaluator Loop**
- Refiner Agent implemented with 24h/48h delayed evaluation
- Scoring rubrics per disaster type
- System prompt update mechanism
- Score trend storage in database

**Phase 8: Frontend**
- Leaflet map with disaster events + habitat polygons
- Recent alerts feed
- Agent activity SSE panel
- Refiner score trend chart

**Phase 9: Hardening + Weekly Digest**
- Weekly digest automation
- Rate limiting, error handling, monitoring
- Final deployment hardening

---

## 6. Secondary Project: "The Migration" — Bird Migration Intelligence Discord Bot

*This is the alternate project. If "Wildlife Sentinel" proves unfeasible for any reason (API access, data quality, scope concerns), start here instead. It is simpler in scope but equally impressive in technique.*

### The Core Concept

A Discord bot that posts nightly bird migration intelligence. On most nights during spring and fall migration seasons (roughly March–June and August–November), hundreds of millions of birds move across North America. Most people have no idea. This bot makes that invisible phenomenon visible — and explains it with data.

This is a nature project, but it is not really about biology. It is about **predictive modeling with time-series data and learning from outcomes.** The birds are the subject. The engineering is predictive accuracy + autonomous delivery.

### The Emotional Hook

There is something inherently surprising and beautiful about this subject. A developer showing this to a recruiter stands out: "I built a system that tracks when 200 million birds are flying over your city tonight." Nobody expects that. It is memorable.

### Data Sources

**BirdCast (Cornell Lab of Ornithology)**
- API: `https://birdcast.info/api/`
- What it provides: Nightly migration forecast maps (predicted migration intensity by region), live migration traffic counts derived from NEXRAD weather radar, historical migration data
- Auth: Free API key (register at birdcast.info)
- Reliability: Cornell Lab of Ornithology is the world's leading institution for ornithological science. The BirdCast system has been running for over a decade and is the scientific standard for migration monitoring.
- Key data: Migration Traffic Rate (MTR) — birds per km of front per hour. On a high-migration night in the central US, MTR can exceed 100,000. On a low night, under 1,000.
- Update schedule: Nightly forecast published each afternoon; live radar data updated hourly

**eBird API (also Cornell Lab)**
- API: `https://api.ebird.org/v2/`
- What it provides: Recent species observations from millions of birdwatchers, grouped by region and species
- Auth: Free API key
- Reliability: Extremely stable. Tens of millions of observations per year.
- Role in this project: Identify which specific species are currently being observed in each region — the "what's flying" layer on top of BirdCast's "how much is flying" layer

**GBIF**
- Same as in "Wildlife Sentinel" above
- Role here: Historical species occurrence data by date range — confirms which species *should* be in transit through a given region during this week of the year

**Open-Meteo (Weather)**
- Same as in "Wildlife Sentinel" above
- Role: Wind direction, wind speed, cloud cover, precipitation probability — critical because birds prefer to migrate with tailwinds and avoid migrating in rain or into strong headwinds

**Light Pollution (optional — Phase 5+)**
- Globe at Night API or Light Pollution Map API
- Birds navigate by stars and are disoriented by artificial light
- High light pollution cities + major migration nights = high collision risk
- Future enhancement: identify cities where "Lights Out" programs are most needed tonight

### The Redis Streams Pipeline

```
[BirdCast Forecast Agent] ──► migration:forecast ──► migration:enriched ──► discord:nightly
[eBird Scout Agent]       ──►                    ──►
[Weather Agent]           ──────────────────────►
```

**Stream: `migration:forecast`**
- Published by: BirdCast Agent (runs each afternoon)
- Message: `{ date, regions[], predicted_mtr_by_region, source_data }`

**Stream: `migration:enriched`**
- Published by: Enrichment Agent
- Adds: current weather per region, eBird species observations, GBIF expected species for this date
- Consumer: Narrative Agent

**Stream: `discord:nightly`**
- Published by: Narrative Agent
- Consumer: Discord Publisher
- Schedule: Post each evening around dusk (when migration begins)

### Agent Design

**BirdCast Scout Agent**
- Model: None (pure data fetch + normalize)
- Schedule: Daily at 3:00 PM local time
- Job: Pull tonight's migration forecast from BirdCast API, normalize to standard schema, publish to `migration:forecast`

**eBird Scout Agent**
- Model: None
- Schedule: Daily at 3:30 PM
- Job: Pull recent species observations for each region with predicted significant migration, publish to `migration:forecast` stream as enrichment data

**Weather Enrichment Agent**
- Model: Gemini Flash
- Job: For each region in the forecast, pull weather conditions (wind direction/speed, precipitation, cloud cover), assess whether conditions are favorable or unfavorable for migration, attach "conditions summary" to message

**Species Identification Agent**
- Model: Gemini Flash + RAG
- Job: Cross-reference tonight's migration regions with GBIF historical data to identify the 3-5 most likely species currently in peak migration through each region. Build a "Who's flying tonight" brief.

**Narrative Agent (Team Lead)**
- Model: Claude Sonnet 4.6
- Job: Synthesize all enriched data into a nightly Discord post. The tone should feel like a knowledgeable friend texting you about something cool happening outside right now — not a scientific report. Include: overall migration intensity, highlighted species, weather conditions, and one interesting fact about tonight's migration context. Also produce a "low migration" variant for off-season or poor-weather nights.

**Accuracy Agent (the learning loop)**
- Model: Claude Sonnet 4.6
- Schedule: Each morning, 12 hours after the previous night's post
- Job:
  1. Pull yesterday evening's prediction (predicted MTR by region)
  2. Pull actual overnight radar-derived migration data from BirdCast
  3. Compare: how accurate was the forecast?
  4. Scoring: predicted MTR vs actual MTR per region, scored 0–1
  5. Identify which meteorological variables the system over- or under-weighted
  6. Update Narrative Agent's "prediction confidence" framing for future posts
  7. Log accuracy score to database for trend visualization

### Discord Structure

- `#migration-tonight` — **Public.** Nightly posts. The main channel.
- `#migration-science` — **Public.** Weekly deeper dive: migration biology context, species spotlight, fascinating migration facts. Posted every Sunday.
- `#migration-data` — **Private (admin).** Raw BirdCast + eBird data before processing. Observability.
- `#migration-accuracy` — **Private (admin).** Accuracy Agent's morning reports.

### Suggested Phase Roadmap

**Phase 0:** Foundation — repo, Discord bot skeleton, Railway, Redis, Supabase

**Phase 1:** BirdCast integration — pull nightly forecast, post basic message to Discord

**Phase 2:** eBird + GBIF enrichment — "who's flying" layer

**Phase 3:** Weather integration + LiteLLM multi-model routing

**Phase 4:** Full Narrative Agent (Claude Sonnet) — quality nightly posts

**Phase 5:** RAG Knowledge Base — species context grounded in ornithological literature

**Phase 6:** Accuracy Agent (learning loop) — morning after evaluation, system prompt updates

**Phase 7:** Light pollution integration + risk alerts for high-traffic migration nights

**Phase 8:** Simple frontend — migration map, recent posts feed, accuracy trend chart

**Phase 9:** Hardening, weekly digest, deployment polish

---

## 7. Tech Stack Reference (Open Decisions and Recommendations)

| Component | Decision | Notes |
|---|---|---|
| Language | TypeScript (Node.js 22 LTS) | Carries over from Asteroid Bonanza. No Python. |
| Backend framework | Express 5 | Familiar. app.ts / server.ts split. Same pattern. |
| Discord library | discord.js | The standard Node.js Discord library |
| Redis client | ioredis or node-redis | Either works; ioredis has better TypeScript support |
| Database | Supabase (PostgreSQL) | Already set up. Add PostGIS extension for "Last Watch". |
| Spatial queries | PostGIS (`ST_DWithin`, `ST_Intersects`) | New skill. Required for "Last Watch" habitat queries. |
| Vector embeddings | Voyage AI (`voyage-large-2-instruct`) | Same as Asteroid Bonanza if RAG is needed |
| Primary AI model | Claude Sonnet 4.6 | For synthesis, threat assessment, narrative generation |
| Secondary AI model | Google Gemini 1.5 Flash | For high-volume enrichment, species lookups, classification |
| AI Gateway | LiteLLM | Routes between models, tracks token costs. **New skill.** |
| Frontend framework | Angular 21 or Next.js | **Open decision.** Angular is familiar; Next.js is lighter for a read-only page. Discuss at project start. |
| Map library | Leaflet.js | Simpler than Three.js for 2D geospatial data. Standard. |
| Hosting (backend) | Railway | Same as Asteroid Bonanza. Redis + PostgreSQL + bot process all run here. |
| Hosting (frontend) | Vercel | Same as Asteroid Bonanza. |
| Module resolution | NodeNext | `.js` extensions on all relative imports. Carries over. |
| TypeScript strictness | `strict: true`, `noUncheckedIndexedAccess: true` | Carries over. No exceptions. |
| LLM response fixtures | `server/tests/fixtures/llm/` | Same testing pattern as Asteroid Bonanza |

---

## 8. Key Constraints and Non-Negotiables

These carry forward from prior projects and must not be relitigated:

- **No LangChain.** Direct SDK usage. Always.
- **No authentication.** Both projects are public-facing. No user accounts, no sessions.
- **Mobile-first frontend.** If there is a frontend, 375px is the base. Desktop is layered on with `md:` breakpoints.
- **Git commits by user only.** Claude Code must NEVER run `git commit` and must NEVER suggest adding Claude or Anthropic as a co-author. When a block of work is complete, summarize what was done and prompt the user to commit.
- **Secrets via environment variables only.** Never read or write `.env` files, `*.key` files, or anything under `.aws/` or `.ssh/`.
- **Confidence scores are computed, not self-reported.** Same rule as Asteroid Bonanza agents. Observable fields only.

---

## 9. Open Questions for the Start of the New Project

These should be the first things discussed in the new Claude Code session before writing any code:

1. **Primary vs. Secondary:** Confirm we are starting with "Wildlife Sentinel" (primary) or "The Migration" (secondary).
2. **Frontend framework:** Angular (familiar, heavier) or Next.js (new, lighter)? Or something even simpler like plain HTML + a bit of vanilla JS for the read-only display?
3. **LiteLLM setup:** Python process or Node.js compatible mode? LiteLLM is Python-native but has a proxy mode that any language can call via HTTP.
4. **IUCN data download:** Register for IUCN bulk shapefile download before coding starts — this can take a day or two for approval and is needed for Phase 1 of "Wildlife Sentinel."
5. **BirdCast API access:** Register for BirdCast API key before coding starts if going with "The Migration."
6. **Discord server:** sjtroxel already has a Discord server. Need to create the channels listed above and create a new bot application in the Discord Developer Portal.
7. **Railway setup:** Decide whether to create a new Railway project or add to an existing one.

---

## 10. The "Why This Project Gets You Hired" Brief

When presenting this project to a recruiter or engineering hiring manager, these are the talking points:

- **Distributed systems:** You built an asynchronous multi-agent pipeline using Redis Streams. You understand message queues, consumer groups, and event-driven architecture.
- **Multi-agent AI orchestration:** You managed a hierarchy of specialized agents with different models and different costs, with a Team Lead coordinating synthesis.
- **Machine learning-adjacent:** Your system actually improves over time. The Refiner/Evaluator loop is the prompt-engineering analog of model fine-tuning.
- **Data integrity:** You used NASA, NOAA, USGS, and IUCN as data sources — the most rigorous scientific institutions on Earth. There is no hallucination in the source data.
- **Cost efficiency:** You architected for cost — cheap models for volume, expensive models for nuance — using an AI gateway layer.
- **Real-world impact:** The system monitors the real world, right now, and responds autonomously. This is not a demo. It runs when you're sleeping.
- **Full-stack:** From PostGIS spatial queries on the backend to a Leaflet map on the frontend to Discord embeds in the wild — you own the whole stack.

---

*End of brief. A new Claude Code session in a new repository should now have everything it needs to start building.*
