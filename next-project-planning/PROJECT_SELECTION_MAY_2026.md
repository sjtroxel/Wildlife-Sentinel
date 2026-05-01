# Project Selection — May 2026

*Companion to `PROJECT_BRAINSTORM_MAY_2026.md`. This document collects all candidate projects for the next build cycle, evaluated against a consistent set of criteria. Decision expected before the new repo is created.*

---

## Selection Criteria (Fixed)

**Must-haves:**
1. **Web app as primary output.** Live URL, no account required, demo-able in 30 seconds.
2. **3–4 week scope.** Smaller and more focused than Wildlife Sentinel.
3. **LangGraph** as the orchestration layer — TypeScript SDK (`@langchain/langgraph`).
4. **Pinecone** (or comparable managed vector DB) — something architecturally distinct from pgvector.
5. **Voice AI** — Whisper (STT) and/or ElevenLabs (TTS) as a first-class feature.
6. **Evaluation framework** — Ragas and/or TruLens for measuring LLM output quality (not custom math).

**Strong preferences:**
7. Emotionally resonant subject matter — projects with genuine interest get finished.
8. No login required — recruiter opens URL and tries it immediately.
9. At least one new data source not used in prior projects.

---

## Quick Comparison

| Option | Domain | Voice role | Emotional hook | Scope fit |
|---|---|---|---|---|
| **ParkBrief** | National parks + outdoor travel | Pre-trip briefing | High | ✅ |
| **GameDay** | Sports pre-game intelligence | Game analysis | Medium | ✅ |
| **VoiceNotes** | Personal productivity | Core feature | Lower | ✅ |
| **HighwayBrief** | Interstate highway system | Route briefing | Medium | ✅ |
| **MuseumGuide** | Art museums + cultural institutions | Audio tour | High | ✅ |
| **NightSky** | Stargazing + astronomy | Observing guide | High | ✅ |
| **AncestorMap** | Genealogy + family migration history | Narrative storytelling | Very high | ✅ |
| **OceanPulse** | Marine science + surf/dive travel | Pre-trip briefing | High | ✅ |
| **SolarWatch** | Space weather + aurora forecasting | Event briefing | High | ✅ |
| **FoodOrigins** | Culinary history + food culture | Story narration | Medium-high | ✅ |

---

## The Ten Options

---

### Option 1: ParkBrief — National Parks Trip Intelligence

**Elevator pitch:** Planning a trip to any US national park → get an AI-generated voice briefing covering wildlife activity that month, permit/reservation status, trail conditions, crowd patterns, and what's genuinely worth seeing right now.

**30-second demo:** "I'm going to Yellowstone in late July with two kids. What do I need to know?" → voice briefing in under 30 seconds.

**Emotional hook:** High. Nature + travel + the national park system is universally resonant. Everyone who's tried to get a Yosemite permit or been stuck in Yellowstone traffic has thought "there has to be a smarter way to plan this."

**LangGraph pipeline:**
- `WildlifeActivityAgent` — what species are active/visible in the target month
- `ParkConditionsAgent` — trail closures, fire/flood status, NPS alerts feed
- `CrowdAndPermitAgent` — reservation windows, historically busy dates, entry strategies
- `NarrativeAgent` — synthesizes into a voice briefing

**Voice:** ElevenLabs reads the pre-trip briefing. Natural fit — trip planning is a listening activity.

**Vector DB (Pinecone):** Index of NPS ranger notes, park-specific ecology guides, seasonal activity reports.

**Evaluation (Ragas):** Score the quality of retrieved park knowledge against ground truth park documentation. Also: post-trip feedback loop (did the briefing match reality?).

**Data sources:**
- NPS API (`developer.nps.gov`) — public, free, well-documented. Alerts, visitor centers, trails, fees.
- iNaturalist API — species observations by park and month
- Recreation.gov — permit and reservation data
- Open-Meteo — weather and seasonal conditions

**Concerns:**
- NPS data varies in freshness. Some trail status info is only updated weekly.
- Very US-centric. International parks would require different data sources.

---

### Option 2: GameDay — Sports Pre-Game Intelligence

**Elevator pitch:** Ask about any game tonight → a swarm of agents researches team form, player matchups, head-to-head history, and injury reports → ElevenLabs delivers a voice pre-game analysis. After the game, Ragas evaluates prediction accuracy against the actual result.

**30-second demo:** "Give me a pre-game breakdown of the Celtics vs. Heat tonight." → 90-second voice analysis.

**Emotional hook:** Medium. Minor sports interest — engaging enough to build, but not deeply personal.

**LangGraph pipeline:**
- `TeamFormAgent` — last 10 games, home/away split
- `MatchupAgent` — head-to-head history, stylistic matchups
- `PlayerStatusAgent` — injury report, recent individual form
- `ContextAgent` — playoff implications, rivalry context, home crowd factor
- `NarrativeAgent` — synthesizes into broadcast-style voice analysis

**Voice:** ElevenLabs — the broadcast sports voice format is a natural fit. Core feature.

**Vector DB (Pinecone):** Index of historical game summaries, player profiles, team season narratives.

**Evaluation (Ragas + custom):** Ragas scores the RAG retrieval quality. After games resolve: prediction accuracy scoring (predicted winner, point margin) → trend chart on frontend. Built-in refiner analog.

**Data sources:**
- TheSportsDB (`thesportsdb.com/api.php`) — free, covers NBA/NFL/MLB/soccer/more
- ESPN unofficial API — team stats, injury reports
- Sports-reference (reference scraping or API) — historical depth

**Concerns:**
- Real-time injury data is often behind a paywall. Free tier is T+24h.
- NBA/NFL season schedules limit when the demo is compelling.

---

### Option 3: VoiceNotes — Smart Voice Memo Intelligence

**Elevator pitch:** Record a voice memo or upload any audio → LangGraph agents extract structured intelligence (action items, decisions made, open questions, mood/tone, key names) → ElevenLabs reads the summary back. All memos are Pinecone-indexed for semantic search.

**30-second demo:** "Record yourself for 30 seconds about anything — a project, a meeting, a thought. Watch it become structured." Every recruiter immediately sees themselves using this.

**Emotional hook:** Lower than domain-specific options, but universal. The demo is the hook, not the subject matter.

**LangGraph pipeline (parallel):**
- `ActionItemsAgent` — concrete next steps with owner and deadline if mentioned
- `DecisionsAgent` — what was decided or concluded
- `QuestionsAgent` — open questions that need answers
- `SummaryAgent` — 2–3 sentence TL;DR
- `SynthesisAgent` — combines all four into a structured output

**Voice:** Dual direction — Whisper transcribes the input, ElevenLabs reads back the summary. Voice is core to the value proposition.

**Vector DB (Pinecone):** Every transcript embedded and stored. Search all memos by meaning ("find everything I said about the Q3 launch"). Time-decay weighting for recency.

**Evaluation (Ragas):** Score extraction quality — did the action items agent actually find all the action items? Ragas evaluates against a test set of human-labeled memos.

**Data sources:** No external APIs needed. User-provided audio is the data source.

**Concerns:**
- Whisper API costs $0.006/minute — trivial for short memos, relevant for hour-long meetings.
- Browser audio recording has codec inconsistencies. `audio/webm` on Chrome, `audio/mp4` on Safari.

---

### Option 4: HighwayBrief — Road Trip Intelligence

**Elevator pitch:** Planning a long drive on the US Interstate system → LangGraph agents research construction delays, mountain pass conditions, weather windows, and points of interest along the route → ElevenLabs delivers a pre-departure voice briefing with the feel of talking to someone who's driven that route many times.

**30-second demo:** "Driving I-70 from Denver to Kansas City on Friday — what do I need to know?" → voice briefing covering Eisenhower Tunnel traffic timing, weather at the pass, estimated drive time by departure hour, and two good lunch stops.

**Emotional hook:** Medium. The Eisenhower Interstate System has genuinely fascinating history — it was modeled on the German Autobahn, designed for civil defense as much as commerce. The system has stories built into it if the agent surfaces them.

**LangGraph pipeline:**
- `TrafficIntelAgent` — historical and predicted congestion by segment
- `WeatherWindowAgent` — mountain pass conditions, storm timing, wind advisories
- `ConstructionAgent` — active FHWA work zones along the route
- `RouteStoryAgent` — points of interest, historical milestones, good stops (the differentiating agent)
- `NarrativeAgent` — combines into a voice departure briefing

**Voice:** ElevenLabs. The "knowledgeable friend who's driven this route before" voice format.

**Vector DB (Pinecone):** Index of Interstate history, notable stops, regional lore, driving guides.

**Evaluation (Ragas):** Evaluate recommendation quality. Post-trip: did the weather prediction hold? Traffic estimate accuracy.

**Data sources:**
- FHWA Traffic API — construction zones and incident data
- Open-Meteo — weather along route segments
- Wikipedia/NPS — Interstate history and points of interest
- Google Maps Directions API (optional) — route segmentation baseline

**Concerns:**
- Government traffic APIs are inconsistently maintained by state.
- US-only and somewhat seasonal (mountain passes, winter weather).

---

### Option 5: MuseumGuide — Intelligent Art Museum Audio Tour

**Elevator pitch:** Tell the app which museum you're visiting → LangGraph agents research the current exhibitions, highlighted works, artist backgrounds, and art-historical context → ElevenLabs generates a personalized voice audio guide for your visit, including what to see first and why.

**30-second demo:** "I'm visiting the Art Institute of Chicago next Saturday morning. I have 2 hours and I love Impressionism." → voice tour plan with 6 stops, estimated times, and commentary for each work.

**Emotional hook:** High. Art + cultural institutions + the feeling of having a knowledgeable friend alongside you in a museum. The museum audio guide is a universally understood format that is almost universally bad — replacing it with something genuinely personalized is a compelling pitch.

**LangGraph pipeline:**
- `ExhibitionsAgent` — what's currently showing, temporary vs. permanent
- `WorkSelectionAgent` — given time constraints and stated interests, which works to prioritize
- `ArtistContextAgent` — biographical and historical context for each selected artist
- `ArtHistoryAgent` — RAG retrieval from art history knowledge base
- `NarrativeAgent` — weaves everything into a personalized audio guide script

**Voice:** ElevenLabs — voice is the entire product. The audio guide is the deliverable.

**Vector DB (Pinecone):** Art history knowledge base (movements, artists, periods, techniques). The Metropolitan Museum and Art Institute Chicago both publish extensive open-access scholarly content.

**Evaluation (Ragas):** Score the factual accuracy of art historical claims against the indexed knowledge base. Are citations grounded in retrieved content or hallucinated?

**Data sources:**
- Art Institute of Chicago API — completely open, free, 100k+ works with full metadata
- Metropolitan Museum of Art API — also completely open, 470k+ objects
- WikiArt — additional artist and work data
- Wikipedia art history content for RAG ingest

**Concerns:**
- "Current exhibitions" data requires museum-specific scraping or calendar APIs, which are inconsistent.
- Very strong if the user is in a major city. Less compelling if they're not near a major museum.
- Could lean web-only (no actual audio needed to demo) if voice adds too much complexity to scope.

---

### Option 6: NightSky — Stargazing Intelligence Companion

**Elevator pitch:** Ask what's worth looking at tonight from your location → LangGraph agents check celestial events, atmospheric conditions, ISS passes, and planetary positions → ElevenLabs delivers a personalized voice observing guide. A knowledgeable amateur astronomer in your pocket.

**30-second demo:** "I'm in rural Vermont tonight, skies look clear. I have 10×50 binoculars and I'm a beginner. What should I look for?" → voice guide covering the 3 best targets for tonight with what to look for and why they're interesting.

**Emotional hook:** High. The sense of wonder at the night sky is deep and nearly universal. This is meaningfully different from Asteroid Bonanza — that was about resource economics and orbital mechanics. This is about the experience of standing outside in the dark and understanding what you're looking at.

**LangGraph pipeline:**
- `CelestialEventsAgent` — planets, conjunctions, meteor showers, special events for tonight
- `SkyConditionsAgent` — cloud cover, atmospheric seeing quality, light pollution for the user's location
- `ISSTrackerAgent` — ISS pass times and visibility for the next 24h
- `TargetSelectorAgent` — given equipment and skill level, which objects are actually achievable tonight
- `ObservingGuideAgent` — how to find each target, what to look for, interesting context

**Voice:** ElevenLabs. The observing guide is inherently a voice format — you can't read a screen outside in the dark.

**Vector DB (Pinecone):** Astronomy knowledge base — Messier objects, deep-sky descriptions, constellation mythology, observing tips indexed for retrieval.

**Evaluation (Ragas):** Factual accuracy of astronomical claims against indexed reference material.

**Data sources:**
- Astronomy API (`astronomyapi.com`) — paid but affordable; positions, events, ISS tracking
- Open-Meteo — cloud cover and atmospheric seeing forecasts
- Light pollution map API or static tile data
- NASA Heavens-Above — ISS pass predictions (scrapable or API)

**Concerns:**
- Compelling demo requires clear skies. Less dramatic in an overcast city.
- Astronomy API has costs — would need to manage per-request spend.

---

### Option 7: AncestorMap — Family Migration & History Intelligence

**Elevator pitch:** Enter a surname, country of origin, and approximate time period → LangGraph agents research historical emigration patterns, the political/economic conditions that drove people to leave, the ships and routes commonly taken, and what life looked like at the destination → ElevenLabs narrates your family's probable story.

**30-second demo:** "My great-great-grandparents were Irish, left County Cork around 1847." → voice narrative covering the Famine emigration, the coffin ships, Ellis Island arrival statistics, and what Irish immigrant life looked like in Boston or New York in the 1850s.

**Emotional hook:** Very high. Genealogy is one of the most emotionally resonant research domains that exists — people cry over this material. The AI doesn't fabricate specific family records; it narrates the probable historical context with honesty about what it does and doesn't know. That combination of emotional weight and epistemic honesty is powerful.

**LangGraph pipeline:**
- `MigrationPatternAgent` — when and why people left this region, common routes and destinations
- `HistoricalContextAgent` — what was happening politically/economically to drive emigration
- `JourneyAgent` — ships, ports, crossing conditions, typical timelines
- `ArrivalAgent` — what the destination looked like, immigrant communities, early settlement patterns
- `NarrativeAgent` — weaves into a family story with appropriate epistemic framing ("your family likely...")

**Voice:** ElevenLabs — the narrative storytelling format is inherently voice. This is oral history.

**Vector DB (Pinecone):** Index of immigration history documents, Ellis Island records context, regional emigration histories, period accounts.

**Evaluation (Ragas):** Factual accuracy against historical knowledge base. Are claims about emigration routes and conditions grounded in retrieved documents?

**Data sources:**
- FamilySearch API — genealogical records and historical documentation
- Ellis Island Foundation — passenger records (public domain)
- Wikipedia historical emigration articles for RAG ingest
- National Archives — various emigration record collections

**Concerns:**
- Specific genealogical records are often incomplete or behind paywalls. The project works best as historical context rather than specific record lookup.
- High emotional stakes: if the AI confidently says something wrong about someone's family history, it feels worse than other error types. Epistemic framing matters.

---

### Option 8: OceanPulse — Marine & Surf/Dive Travel Intelligence

**Elevator pitch:** Planning a surf trip, dive trip, or coastal visit → LangGraph agents research swell forecasts, water temperature, marine life activity by season, reef conditions, and local ocean knowledge → ElevenLabs delivers a pre-trip voice briefing from the perspective of a local who knows the water.

**30-second demo:** "I'm going to the Big Island of Hawaii in October. I want to dive and I care about manta rays and whale sharks." → voice briefing on peak manta ray aggregation sites, whale shark seasonality, current dive conditions, water temp, and which side of the island to base yourself on.

**Emotional hook:** High for anyone who surfs, dives, or cares about ocean health. The ocean has the same "invisible depth" quality as Wildlife Sentinel — there's a whole world happening there that most people don't have access to.

**LangGraph pipeline:**
- `SwellForecastAgent` — wave height, period, direction for the target dates
- `MarineLifeAgent` — what species are active in this location during this season
- `WaterConditionsAgent` — visibility, temperature, thermocline depth
- `LocalKnowledgeAgent` — RAG retrieval from regional dive/surf guides
- `NarrativeAgent` — synthesizes into a pre-trip voice briefing

**Voice:** ElevenLabs. The "local diver/surfer briefing" voice format is natural and engaging.

**Vector DB (Pinecone):** Regional marine life guides, dive site descriptions, surf spot breakdowns, seasonal activity patterns.

**Evaluation (Ragas):** Factual accuracy of marine biology claims against indexed reference material.

**Data sources:**
- NOAA CoastWatch — sea surface temperature, buoy data
- NOAA Tides & Currents — tidal data by location
- Global Biodiversity Information Facility (GBIF) — marine species occurrence data
- Surfline/Magic Seaweed (MSW) API — swell forecasting (MSW has a free tier)
- OBIS (Ocean Biodiversity Information System) — marine species sightings

**Concerns:**
- Surf APIs (Surfline, MSW) have limited free tiers and some require scraping.
- Strong demo requires choosing a destination with good available data. Hawaii, Caribbean, and California are well-covered; more obscure destinations are less so.

---

### Option 9: SolarWatch — Space Weather & Aurora Intelligence

**Elevator pitch:** The sun is constantly erupting with solar flares, coronal mass ejections, and geomagnetic storms that affect aurora visibility, satellite operations, GPS accuracy, and shortwave radio. SolarWatch makes this invisible activity visible and actionable — with a voice briefing for aurora chasers, pilots, ham radio operators, and anyone curious about what the sun is doing right now.

**30-second demo:** "Is there any aurora activity expected in northern Minnesota this week?" → voice briefing on current Kp index, upcoming CME arrival windows, best viewing nights and times, and what color to expect at that latitude.

**Emotional hook:** High for a specific audience. Aurora photography is a passionate hobby with a large online community. The "invisible forces affecting real life" quality is similar to what made Wildlife Sentinel emotionally compelling — showing people something real they couldn't otherwise see.

**LangGraph pipeline:**
- `SolarActivityAgent` — current solar flare activity, X-ray flux, active sunspot regions
- `CMETrackingAgent` — coronal mass ejections in transit, estimated Earth arrival
- `GeomagneticAgent` — current and forecast Kp index, geomagnetic storm warnings
- `ViewingConditionsAgent` — cloud cover, moon phase, light pollution for the user's location
- `NarrativeAgent` — synthesizes into a voice space weather briefing

**Voice:** ElevenLabs. The forecasting briefing format is naturally voice-compatible.

**Vector DB (Pinecone):** Space weather educational content — what each alert type means, historical event comparisons, aurora science basics.

**Evaluation (Ragas):** Score the accuracy of educational content retrieval. Post-event: did the predicted Kp level match actual measurements?

**Data sources:**
- NOAA SWPC (Space Weather Prediction Center) — completely free, excellent API. Solar flux, Kp index, CME forecasts, geomagnetic storm watches.
- NASA DONKI (Space Weather Database of Notifications) — CME catalog, solar event history
- Open-Meteo — cloud cover for viewing conditions
- NOAA POES satellite data — real-time auroral oval position

**Concerns:**
- Peak solar activity is currently high (Solar Cycle 25 maximum around 2025), which makes this timely.
- Aurora chasers are a passionate but relatively niche audience. The broader "space weather affects your GPS and power grid" angle may be more universally compelling.

---

### Option 10: FoodOrigins — Culinary History Intelligence

**Elevator pitch:** Ask where any dish, ingredient, or food tradition comes from → LangGraph agents trace the culinary history, the trade routes that moved ingredients around the world, the cultural transformations, and the regional variations → ElevenLabs narrates the story. Every meal has a history most people have never heard.

**30-second demo:** "Tell me the story of ramen." → voice narrative covering its Chinese origins, the Japanese adaptation in the early 20th century, the role of postwar American wheat donations in popularizing it, and how it became a global phenomenon.

**Emotional hook:** Medium-high. Food is universal and the origin stories are genuinely surprising. Most people don't know that tomatoes are native to the Americas and only entered Italian cuisine in the 16th century, or that chili peppers transformed cuisines worldwide in a matter of decades after the Columbian Exchange. There's a "wait, really?" moment in almost every food origin story.

**LangGraph pipeline:**
- `OriginAgent` — geographic and cultural origin of the dish or ingredient
- `TradeRouteAgent` — how it spread from its origin to other parts of the world
- `CulturalTransformationAgent` — how different cultures adapted it and why
- `RegionalVariationsAgent` — major regional versions and what makes them distinct
- `NarrativeAgent` — weaves into a voice food origin story

**Voice:** ElevenLabs. Culinary storytelling is a podcast/radio format — voice is the natural medium.

**Vector DB (Pinecone):** Culinary history knowledge base indexed from food history books, Wikipedia food articles, academic food history content.

**Evaluation (Ragas):** Factual accuracy of historical claims against indexed culinary history sources.

**Data sources:**
- Wikipedia food history articles (extensive, high quality for RAG ingest)
- The Oxford Companion to Food (public domain excerpts)
- JSTOR open-access culinary history papers
- Flavor pairing research data (optional enrichment)

**Concerns:**
- No real-time API — this is entirely RAG-dependent. Quality is limited by the knowledge base.
- The "wow" moment depends entirely on the question asked. Interesting questions get interesting answers; trivial questions get trivial answers.
- Less technically differentiated than options with live data. But also the simplest to scope.

---

## Decision Rubric

Before deciding, answer these three questions:

1. **Which domain makes you want to open the browser and try it yourself?** That instinct predicts completion.

2. **Do you want live data (weather, events, sports scores) or knowledge retrieval (history, science, culture)?** Live data makes demos more dynamic but adds API complexity. Knowledge retrieval is more reliable but requires good RAG ingest.

3. **How important is voice as a *core* feature vs. a *nice-to-have*?** Options where voice is the natural output format (MuseumGuide's audio tour, AncestorMap's oral narrative, NightSky's observing guide) will demonstrate voice AI more compellingly than options where it's a bolt-on.

---

*Decision document. Last updated: May 1, 2026.*
*Decision pending. New repo to be created once a selection is made.*
