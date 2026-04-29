# Phase 11 — Conservation Charity Integration

**Goal:** At the exact moment a real-time disaster alert fires, surface targeted, pre-vetted charity donation links so users can take immediate action to help the species being threatened right now.

**Status:** 🚧 IN PROGRESS — Backend complete; frontend in progress (2026-04-29).
**Depends on:** Phase 10 complete (all expansions shipped 2026-04-16). System live on Railway + Vercel.
**No new env vars required.** Fully internal to the existing stack.

### Completed ✅
- Migration 0009 applied: `charities` (30 rows), `charity_species_links` (90 rows), `charity_event_type_links` (44 rows)
- `shared/types.d.ts` — `Charity` + `CharitySummary` types
- `server/src/db/charityQueries.ts` — three-tier priority cascade query functions
- `server/src/routes/charities.ts` — `GET /charities`, `GET /charities/:slug`
- `server/src/app.ts` — `charitiesRouter` registered
- `server/src/agents/SynthesisAgent.ts` — `💛 How You Can Help` embed field
- `server/src/discord/bot.ts` — `/donate` slash command + autocomplete
- `server/src/discord/helpContent.ts` — `/donate` listed
- 28 server-side tests (charityQueries, routes/charities, SynthesisAgent, donateCommand)

### Remaining 🔲
- Frontend: `client/lib/api.ts`, `CharityCard.tsx`, `/charities` page, alert detail section, species detail section, nav link
- Species name verification query
- Railway + Vercel deploy
- Discord `/donate` command registration on guild

---

## The Core Idea

The TV commercials that raised billions for animal welfare work because they reach people at a moment of emotional connection. Wildlife Sentinel has something those commercials can't have: **it's happening right now.** A wildfire is burning Sumatran orangutan habitat *at this moment*. A real-time alert creates a window of emotional engagement that no ad campaign can replicate. Phase 11 puts a "Donate Now" path directly inside that window — in the Discord embed, on the alert detail page, and on every species profile.

---

## Design Decisions

### 1. Curated DB over charity API

All charities are manually vetted and seeded into a `charities` DB table. No runtime dependency on Charity Navigator, Every.org, or any external charity API.

**Why:** Charity APIs add a runtime dependency, introduce latency on every alert, and can surface fraudulent or low-quality organizations. A curated list is pre-vetted, instantly available, and never breaks because an API is down.

**Future enhancement (not Phase 11):** Charity Navigator API for live rating enrichment and periodic re-verification.

### 2. Links inside the Discord embed — not buttons, not a separate message

Charity links appear as a `💛 How You Can Help` field inside the existing embed, using Discord markdown hyperlinks (`[Name](url)` format). The embed is already built in `SynthesisAgent.processAlert()` and flows through the pipeline unchanged — no modifications needed to `publisher.ts` or `hitl.ts`.

**Why buttons aren't used:** ActionRow buttons with LinkStyle require the `components` array on `channel.send()`, which would require plumbing changes through `DiscordQueueItem`, `publishItem()`, `postCriticalForReview()`, and the HITL approval path. Embed field hyperlinks achieve the same outcome with zero pipeline changes and work reliably in every Discord client.

### 3. Max 3 charities per alert, selected by priority

Priority cascade:
1. **Species-specific** — charities that specifically work to protect one or more of the at-risk species (from `charity_species_links`)
2. **Event-type** — charities that work on the disaster category (wildfire response, coral restoration, etc.) from `charity_event_type_links`
3. **Global fallbacks** — WWF, WCS, Conservation International — always present when no specific match fills the list

This means an alert for Sumatran Orangutans + wildfire surfaces Orangutan Foundation International *first*, before generic wildfire-habitat charities.

### 4. Alert detail page + species profile page + directory

Web users who click through from Discord get the same charity information on the `/alerts/[id]` detail page as a "How You Can Help" section. Species profile pages (`/species/[slug]`) get a "Conservation Organizations" section. A new `/charities` directory lists all charities for users who want to explore.

### 5. New `/donate` Discord slash command

`/donate <species>` gives any Discord user instant access to charities for a specific species — even outside of an active alert. Autocomplete from `species_ranges`, same pattern as `/species`.

---

## Database — Migration 0009

File: `server/src/db/migrations/0009_charities.sql`

### Schema

```sql
-- Migration: 0009_charities
-- Purpose: Conservation charity database for Phase 11 — targeted donation links in alerts.

-- Up

CREATE TABLE IF NOT EXISTS charities (
  id                        UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  name                      TEXT          NOT NULL,
  slug                      VARCHAR(100)  NOT NULL UNIQUE,
  url                       TEXT          NOT NULL,
  donation_url              TEXT          NOT NULL,  -- direct link to give/donate page
  description               TEXT          NOT NULL,  -- 1-2 sentences shown in UI
  logo_url                  TEXT,                    -- optional, externally hosted
  charity_navigator_rating  SMALLINT,                -- 1-4 stars (NULL if unrated)
  headquarters_country      VARCHAR(3),              -- ISO 3166-1 alpha-3
  focus_regions             TEXT[]        DEFAULT '{}',
  is_active                 BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at                TIMESTAMPTZ   DEFAULT NOW(),
  updated_at                TIMESTAMPTZ   DEFAULT NOW()
);

-- Maps charities to specific species they protect (scientific name, matches species_ranges.species_name)
CREATE TABLE IF NOT EXISTS charity_species_links (
  charity_id   UUID      NOT NULL REFERENCES charities(id) ON DELETE CASCADE,
  species_name TEXT      NOT NULL,  -- GBIF scientific name, lowercase
  priority     SMALLINT  NOT NULL DEFAULT 1,  -- 1=primary focus, 2=secondary
  PRIMARY KEY (charity_id, species_name)
);

-- Maps charities to disaster event types (fallback when no species match fills the list)
CREATE TABLE IF NOT EXISTS charity_event_type_links (
  charity_id  UUID      NOT NULL REFERENCES charities(id) ON DELETE CASCADE,
  event_type  TEXT      NOT NULL,  -- matches EventType values
  priority    SMALLINT  NOT NULL DEFAULT 1,
  PRIMARY KEY (charity_id, event_type)
);

CREATE INDEX IF NOT EXISTS idx_charity_species    ON charity_species_links    (species_name);
CREATE INDEX IF NOT EXISTS idx_charity_event_type ON charity_event_type_links (event_type);
CREATE INDEX IF NOT EXISTS idx_charities_slug     ON charities                (slug);
CREATE INDEX IF NOT EXISTS idx_charities_active   ON charities                (is_active);
```

### Seed Data — Charities (~30 vetted organizations)

```sql
-- ============================================================
-- SEED: Initial charity list (30 vetted organizations)
-- NOTE: species_name values in charity_species_links use GBIF
-- scientific names. Verify against actual species_ranges.species_name
-- values in the DB before relying on species-specific matching.
-- Event-type fallbacks cover all other cases.
-- ============================================================

INSERT INTO charities (name, slug, url, donation_url, description, charity_navigator_rating, headquarters_country, focus_regions) VALUES

-- Global / Multi-Species
('World Wildlife Fund', 'wwf',
 'https://www.worldwildlife.org', 'https://www.worldwildlife.org/donate',
 'The world''s leading conservation organization, working across 100 countries to conserve nature and reduce the most pressing threats to biodiversity.',
 4, 'USA', ARRAY['Global']),

('Wildlife Conservation Society', 'wcs',
 'https://www.wcs.org', 'https://www.wcs.org/support-wcs/donate',
 'WCS saves wildlife and wild places worldwide by understanding critical issues, crafting science-based solutions, and taking conservation action.',
 4, 'USA', ARRAY['Global']),

('Conservation International', 'conservation-international',
 'https://www.conservation.org', 'https://donate.conservation.org',
 'Protecting nature and biodiversity for the long-term benefit of humanity, working in over 30 countries.',
 4, 'USA', ARRAY['Global']),

('International Fund for Animal Welfare', 'ifaw',
 'https://www.ifaw.org', 'https://www.ifaw.org/donate',
 'IFAW rescues and protects animals around the world, providing hands-on help in crises and addressing long-term threats.',
 3, 'USA', ARRAY['Global']),

('Born Free Foundation', 'born-free',
 'https://www.bornfree.org.uk', 'https://www.bornfree.org.uk/support-us/donate',
 'Born Free exists to ensure that all wild animals, whether living in captivity or in the wild, are treated with compassion and respect.',
 NULL, 'GBR', ARRAY['Africa', 'Asia']),

('The Nature Conservancy', 'nature-conservancy',
 'https://www.nature.org', 'https://www.nature.org/en-us/donate',
 'A global conservation organization working to protect the lands and waters on which all life depends.',
 4, 'USA', ARRAY['Global']),

-- Habitat / Deforestation
('Rainforest Trust', 'rainforest-trust',
 'https://www.rainforesttrust.org', 'https://www.rainforesttrust.org/donate',
 'Protecting tropical forests and their biodiversity through partnerships with local and international conservation groups.',
 4, 'USA', ARRAY['Tropics', 'South America', 'Africa', 'Asia']),

('Rainforest Action Network', 'rainforest-action-network',
 'https://www.ran.org', 'https://www.ran.org/donate',
 'Preserving forests, protecting the climate, and upholding human rights by challenging corporate power and systemic injustice.',
 3, 'USA', ARRAY['Tropics', 'South America', 'Asia']),

-- Marine / Ocean
('Sea Shepherd Conservation Society', 'sea-shepherd',
 'https://www.seashepherd.org', 'https://www.seashepherd.org/donate',
 'A direct-action marine conservation organization that defends, conserves, and protects our oceans and marine wildlife.',
 3, 'USA', ARRAY['Global Oceans']),

('Oceana', 'oceana',
 'https://oceana.org', 'https://oceana.org/donate',
 'The largest international organization focused solely on ocean conservation, winning policy victories that protect ocean life.',
 4, 'USA', ARRAY['Global Oceans']),

('Coral Restoration Foundation', 'coral-restoration-foundation',
 'https://www.coralrestoration.org', 'https://www.coralrestoration.org/donate',
 'The world''s largest open-ocean coral restoration program, growing and planting corals on Florida''s Coral Reef.',
 4, 'USA', ARRAY['Caribbean', 'Atlantic']),

('Reef Check Foundation', 'reef-check',
 'https://www.reefcheck.org', 'https://www.reefcheck.org/donate',
 'A global nonprofit dedicated to scientifically monitoring, protecting, and restoring the world''s coral reefs.',
 3, 'USA', ARRAY['Indo-Pacific', 'Caribbean', 'Global Oceans']),

('Whale and Dolphin Conservation', 'wdc',
 'https://us.whales.org', 'https://us.whales.org/donate',
 'Dedicated to the conservation and protection of whales, dolphins and porpoises through campaigns, advice, and field projects.',
 NULL, 'GBR', ARRAY['Global Oceans']),

('Pacific Whale Foundation', 'pacific-whale-foundation',
 'https://www.pacificwhale.org', 'https://www.pacificwhale.org/donate',
 'A science-based nonprofit protecting whales, dolphins, and ocean ecosystems through research, education, and global outreach.',
 NULL, 'USA', ARRAY['Pacific Ocean', 'Indo-Pacific']),

-- Polar
('Polar Bears International', 'polar-bears-international',
 'https://polarbearsinternational.org', 'https://polarbearsinternational.org/get-involved/donate',
 'The world''s leading polar bear conservation organization, dedicated to saving polar bears and the sea ice they depend on.',
 4, 'USA', ARRAY['Arctic']),

-- Big Cats
('Panthera', 'panthera',
 'https://www.panthera.org', 'https://www.panthera.org/donate',
 'The only organization in the world devoted exclusively to the conservation of wild cats and their ecosystems.',
 4, 'USA', ARRAY['Global']),

('Snow Leopard Trust', 'snow-leopard-trust',
 'https://www.snowleopard.org', 'https://www.snowleopard.org/donate',
 'Working since 1981 to protect the endangered snow leopard and benefit the communities that share its mountain habitat.',
 4, 'USA', ARRAY['Central Asia', 'South Asia']),

('Cheetah Conservation Fund', 'cheetah-conservation-fund',
 'https://www.cheetah.org', 'https://www.cheetah.org/donate',
 'The global leader in research and conservation of the cheetah and its ecosystem, working in Africa and worldwide.',
 4, 'USA', ARRAY['Africa']),

-- African Wildlife
('African Wildlife Foundation', 'african-wildlife-foundation',
 'https://www.awf.org', 'https://www.awf.org/donate',
 'AWF is the most experienced international conservation organization focused exclusively on Africa''s wildlife and wild lands.',
 4, 'USA', ARRAY['Africa']),

('Save the Rhino International', 'save-the-rhino',
 'https://www.savetherhino.org', 'https://www.savetherhino.org/how-you-can-help/donate',
 'Working to conserve rhinos in Africa and Asia by providing conservation support to rangers and anti-poaching programs.',
 4, 'GBR', ARRAY['Africa', 'Asia']),

('International Elephant Foundation', 'international-elephant-foundation',
 'https://www.elephantconservation.org', 'https://www.elephantconservation.org/donate',
 'Supporting elephant conservation, education, and scientific research worldwide in partnership with zoos and field programs.',
 4, 'USA', ARRAY['Africa', 'Asia']),

('African Wild Dog Conservation', 'african-wild-dog-conservation',
 'https://www.africanwilddogconservation.org', 'https://www.africanwilddogconservation.org/support',
 'Dedicated exclusively to the conservation of Africa''s most endangered large carnivore, the African wild dog.',
 NULL, 'ZWE', ARRAY['Africa']),

-- Gorillas / Primates
('Gorilla Doctors', 'gorilla-doctors',
 'https://www.gorilladoctors.org', 'https://www.gorilladoctors.org/donate',
 'Providing individual medical care to mountain gorillas in the wild and supporting the communities that surround them.',
 4, 'USA', ARRAY['Central Africa']),

('Dian Fossey Gorilla Fund', 'dian-fossey-gorilla-fund',
 'https://gorillafund.org', 'https://gorillafund.org/support/donate',
 'The world''s leading organization protecting and studying gorillas, with decades of research in Rwanda and the Congo.',
 4, 'USA', ARRAY['Central Africa', 'East Africa']),

-- Orangutans
('Orangutan Foundation International', 'orangutan-foundation-international',
 'https://orangutan.org', 'https://orangutan.org/donate-2',
 'Founded by Dr. Biruté Mary Galdikas, OFI works to protect orangutans and their rainforest habitat in Borneo.',
 3, 'USA', ARRAY['Borneo', 'Sumatra']),

('Sumatran Orangutan Society', 'sumatran-orangutan-society',
 'https://www.orangutans-sos.org', 'https://www.orangutans-sos.org/donate',
 'Working to protect orangutans and their rainforest habitat in Sumatra through conservation, education, and advocacy.',
 NULL, 'GBR', ARRAY['Sumatra']),

('Bornean Orangutan Survival Foundation', 'bos-foundation',
 'https://orangutanfoundation.org', 'https://www.borneorangutansurvival.org/bos-foundation/donation',
 'The world''s largest orangutan rescue and conservation organisation, protecting Bornean orangutans through rehabilitation.',
 NULL, 'IDN', ARRAY['Borneo']),

-- Climate / Sea Ice
('350.org', '350-org',
 'https://350.org', 'https://350.org/donate',
 'A global movement working to end the age of fossil fuels, fighting climate change as the leading driver of biodiversity loss.',
 NULL, 'USA', ARRAY['Global']),

-- Anti-Poaching / Trade
('TRAFFIC', 'traffic',
 'https://www.traffic.org', 'https://www.traffic.org/take-action/donate',
 'The leading NGO working globally on trade in wild animals and plants, ensuring that trade does not threaten wildlife.',
 NULL, 'GBR', ARRAY['Global']),

-- Coral (second organization for coral events)
('Coral Triangle Initiative', 'coral-triangle-initiative',
 'https://coraltriangleinitiative.org', 'https://coraltriangleinitiative.org/support',
 'A multilateral partnership of six countries protecting the Coral Triangle — the world''s center of marine biodiversity.',
 NULL, 'IDN', ARRAY['Indo-Pacific', 'Southeast Asia']);
```

### Species-Charity Links (Priority Seed)

```sql
-- ============================================================
-- SEED: Species-specific charity links
-- Scientific names must match species_ranges.species_name exactly.
-- Verify against: SELECT DISTINCT species_name FROM species_ranges LIMIT 100;
-- These are best-guess GBIF names — verify and correct in production.
-- ============================================================

-- Helper: get charity IDs
DO $$
DECLARE
  v_wwf                UUID := (SELECT id FROM charities WHERE slug = 'wwf');
  v_wcs                UUID := (SELECT id FROM charities WHERE slug = 'wcs');
  v_awf                UUID := (SELECT id FROM charities WHERE slug = 'african-wildlife-foundation');
  v_ifaw               UUID := (SELECT id FROM charities WHERE slug = 'ifaw');
  v_born_free          UUID := (SELECT id FROM charities WHERE slug = 'born-free');
  v_rainforest_trust   UUID := (SELECT id FROM charities WHERE slug = 'rainforest-trust');
  v_sea_shepherd       UUID := (SELECT id FROM charities WHERE slug = 'sea-shepherd');
  v_oceana             UUID := (SELECT id FROM charities WHERE slug = 'oceana');
  v_coral_rest         UUID := (SELECT id FROM charities WHERE slug = 'coral-restoration-foundation');
  v_reef_check         UUID := (SELECT id FROM charities WHERE slug = 'reef-check');
  v_polar_bears        UUID := (SELECT id FROM charities WHERE slug = 'polar-bears-international');
  v_panthera           UUID := (SELECT id FROM charities WHERE slug = 'panthera');
  v_snow_leopard       UUID := (SELECT id FROM charities WHERE slug = 'snow-leopard-trust');
  v_save_rhino         UUID := (SELECT id FROM charities WHERE slug = 'save-the-rhino');
  v_gorilla_doctors    UUID := (SELECT id FROM charities WHERE slug = 'gorilla-doctors');
  v_fossey             UUID := (SELECT id FROM charities WHERE slug = 'dian-fossey-gorilla-fund');
  v_ofi                UUID := (SELECT id FROM charities WHERE slug = 'orangutan-foundation-international');
  v_sos                UUID := (SELECT id FROM charities WHERE slug = 'sumatran-orangutan-society');
  v_bos                UUID := (SELECT id FROM charities WHERE slug = 'bos-foundation');
  v_cheetah            UUID := (SELECT id FROM charities WHERE slug = 'cheetah-conservation-fund');
  v_wild_dog           UUID := (SELECT id FROM charities WHERE slug = 'african-wild-dog-conservation');
  v_elephant_found     UUID := (SELECT id FROM charities WHERE slug = 'international-elephant-foundation');
  v_wdc                UUID := (SELECT id FROM charities WHERE slug = 'wdc');
  v_ran                UUID := (SELECT id FROM charities WHERE slug = 'rainforest-action-network');
BEGIN

  -- ---- ORANGUTANS ----
  INSERT INTO charity_species_links (charity_id, species_name, priority) VALUES
    (v_ofi,  'pongo abelii',         1),  -- Sumatran Orangutan
    (v_sos,  'pongo abelii',         1),
    (v_wwf,  'pongo abelii',         2),
    (v_bos,  'pongo pygmaeus',       1),  -- Bornean Orangutan
    (v_ofi,  'pongo pygmaeus',       2),
    (v_wwf,  'pongo pygmaeus',       2),
    (v_ofi,  'pongo tapanuliensis',  1),  -- Tapanuli Orangutan
    (v_sos,  'pongo tapanuliensis',  2)
  ON CONFLICT DO NOTHING;

  -- ---- TIGERS ----
  INSERT INTO charity_species_links (charity_id, species_name, priority) VALUES
    (v_panthera, 'panthera tigris',                   1),  -- Tiger (all subspecies)
    (v_wwf,      'panthera tigris',                   2),
    (v_wcs,      'panthera tigris',                   2),
    (v_panthera, 'panthera tigris ssp. sumatrae',     1),  -- Sumatran Tiger
    (v_sos,      'panthera tigris ssp. sumatrae',     2),
    (v_panthera, 'panthera tigris ssp. altaica',      1)   -- Amur Tiger
  ON CONFLICT DO NOTHING;

  -- ---- LIONS ----
  INSERT INTO charity_species_links (charity_id, species_name, priority) VALUES
    (v_panthera,  'panthera leo',  1),
    (v_awf,       'panthera leo',  2),
    (v_born_free, 'panthera leo',  2)
  ON CONFLICT DO NOTHING;

  -- ---- LEOPARDS / BIG CATS ----
  INSERT INTO charity_species_links (charity_id, species_name, priority) VALUES
    (v_panthera,     'panthera uncia',      1),  -- Snow Leopard
    (v_snow_leopard, 'panthera uncia',      1),
    (v_wwf,          'panthera uncia',      2),
    (v_panthera,     'panthera pardus',     1),  -- Leopard
    (v_panthera,     'panthera onca',       1),  -- Jaguar
    (v_rainforest_trust, 'panthera onca',   2),
    (v_panthera,     'neofelis nebulosa',   1),  -- Clouded Leopard
    (v_wcs,          'neofelis nebulosa',   2)
  ON CONFLICT DO NOTHING;

  -- ---- GORILLAS ----
  INSERT INTO charity_species_links (charity_id, species_name, priority) VALUES
    (v_gorilla_doctors, 'gorilla beringei',              1),  -- Eastern Gorilla
    (v_fossey,          'gorilla beringei',              1),
    (v_awf,             'gorilla beringei',              2),
    (v_gorilla_doctors, 'gorilla beringei ssp. beringei',1),  -- Mountain Gorilla
    (v_fossey,          'gorilla beringei ssp. beringei',1),
    (v_wwf,             'gorilla gorilla',               1),  -- Western Gorilla
    (v_wcs,             'gorilla gorilla',               2)
  ON CONFLICT DO NOTHING;

  -- ---- CHIMPANZEES / BONOBOS ----
  INSERT INTO charity_species_links (charity_id, species_name, priority) VALUES
    (v_wcs,  'pan troglodytes',  1),  -- Chimpanzee
    (v_wwf,  'pan troglodytes',  2),
    (v_wcs,  'pan paniscus',     1),  -- Bonobo
    (v_wwf,  'pan paniscus',     2)
  ON CONFLICT DO NOTHING;

  -- ---- ELEPHANTS ----
  INSERT INTO charity_species_links (charity_id, species_name, priority) VALUES
    (v_elephant_found, 'loxodonta africana',     1),  -- African Bush Elephant
    (v_awf,            'loxodonta africana',     2),
    (v_born_free,      'loxodonta africana',     2),
    (v_elephant_found, 'loxodonta cyclotis',     1),  -- African Forest Elephant
    (v_awf,            'loxodonta cyclotis',     2),
    (v_wwf,            'elephas maximus',        1),  -- Asian Elephant
    (v_elephant_found, 'elephas maximus',        2),
    (v_wcs,            'elephas maximus',        2)
  ON CONFLICT DO NOTHING;

  -- ---- RHINOS ----
  INSERT INTO charity_species_links (charity_id, species_name, priority) VALUES
    (v_save_rhino, 'ceratotherium simum',     1),  -- White Rhino
    (v_wwf,        'ceratotherium simum',     2),
    (v_save_rhino, 'diceros bicornis',        1),  -- Black Rhino
    (v_awf,        'diceros bicornis',        2),
    (v_save_rhino, 'dicerorhinus sumatrensis',1),  -- Sumatran Rhino
    (v_wwf,        'dicerorhinus sumatrensis',2),
    (v_save_rhino, 'rhinoceros sondaicus',    1),  -- Javan Rhino
    (v_wcs,        'rhinoceros sondaicus',    2),
    (v_save_rhino, 'rhinoceros unicornis',    1)   -- Indian Rhino
  ON CONFLICT DO NOTHING;

  -- ---- POLAR BEARS / ARCTIC ----
  INSERT INTO charity_species_links (charity_id, species_name, priority) VALUES
    (v_polar_bears, 'ursus maritimus',  1),  -- Polar Bear
    (v_wwf,         'ursus maritimus',  2),
    (v_oceana,      'ursus maritimus',  2)
  ON CONFLICT DO NOTHING;

  -- ---- CHEETAHS ----
  INSERT INTO charity_species_links (charity_id, species_name, priority) VALUES
    (v_cheetah, 'acinonyx jubatus',  1),
    (v_awf,     'acinonyx jubatus',  2)
  ON CONFLICT DO NOTHING;

  -- ---- AFRICAN WILD DOGS ----
  INSERT INTO charity_species_links (charity_id, species_name, priority) VALUES
    (v_wild_dog, 'lycaon pictus',  1),
    (v_awf,      'lycaon pictus',  2)
  ON CONFLICT DO NOTHING;

  -- ---- MARINE: WHALES & DOLPHINS ----
  INSERT INTO charity_species_links (charity_id, species_name, priority) VALUES
    (v_wdc,            'tursiops truncatus',   1),  -- Bottlenose Dolphin
    (v_sea_shepherd,   'tursiops truncatus',   2),
    (v_wdc,            'orcinus orca',         1),  -- Orca
    (v_oceana,         'orcinus orca',         2),
    (v_sea_shepherd,   'balaenoptera musculus',1),  -- Blue Whale
    (v_wdc,            'balaenoptera musculus',2),
    (v_sea_shepherd,   'phocoena sinus',       1),  -- Vaquita
    (v_oceana,         'phocoena sinus',       2),
    (v_wdc,            'platanista gangetica', 1)   -- Ganges River Dolphin
  ON CONFLICT DO NOTHING;

  -- ---- MARINE: WHALE SHARK / MANTA ----
  INSERT INTO charity_species_links (charity_id, species_name, priority) VALUES
    (v_sea_shepherd, 'rhincodon typus',  1),  -- Whale Shark
    (v_oceana,       'rhincodon typus',  2),
    (v_wwf,          'rhincodon typus',  2)
  ON CONFLICT DO NOTHING;

  -- ---- MARINE: DUGONG / SEA TURTLE ----
  INSERT INTO charity_species_links (charity_id, species_name, priority) VALUES
    (v_wwf,          'dugong dugon',                 1),  -- Dugong
    (v_sea_shepherd, 'dugong dugon',                 2),
    (v_sea_shepherd, 'chelonia mydas',               1),  -- Green Sea Turtle
    (v_oceana,       'chelonia mydas',               2),
    (v_sea_shepherd, 'eretmochelys imbricata',       1),  -- Hawksbill Sea Turtle
    (v_sea_shepherd, 'dermochelys coriacea',         1)   -- Leatherback Sea Turtle
  ON CONFLICT DO NOTHING;

  -- ---- CORAL ----
  INSERT INTO charity_species_links (charity_id, species_name, priority) VALUES
    (v_coral_rest, 'acropora cervicornis',   1),  -- Staghorn Coral
    (v_reef_check, 'acropora cervicornis',   2),
    (v_coral_rest, 'acropora palmata',       1),  -- Elkhorn Coral
    (v_reef_check, 'acropora palmata',       2),
    (v_coral_rest, 'orbicella annularis',    1)   -- Boulder Star Coral
  ON CONFLICT DO NOTHING;

  -- ---- SUMATRAN SPECIES (wildfire / deforestation) ----
  INSERT INTO charity_species_links (charity_id, species_name, priority) VALUES
    (v_sos,   'elephas maximus sumatranus',   1),  -- Sumatran Elephant (if distinct in DB)
    (v_wwf,   'tapirus indicus',              1),  -- Malayan Tapir
    (v_wcs,   'helarctos malayanus',          1)   -- Sun Bear
  ON CONFLICT DO NOTHING;

  -- ---- AMAZON / SOUTH AMERICAN SPECIES ----
  INSERT INTO charity_species_links (charity_id, species_name, priority) VALUES
    (v_wwf,            'pteronura brasiliensis',  1),  -- Giant River Otter
    (v_rainforest_trust,'pteronura brasiliensis', 2),
    (v_wcs,            'inia geoffrensis',        1),  -- Amazon River Dolphin (boto)
    (v_rainforest_trust,'tapirus terrestris',     1)   -- South American Tapir
  ON CONFLICT DO NOTHING;

END $$;
```

### Event-Type Charity Links

```sql
-- ============================================================
-- SEED: Event-type charity links (fallback when species-specific
-- charities don't fill the max-3 limit)
-- ============================================================

INSERT INTO charity_event_type_links (charity_id, event_type, priority)
SELECT c.id, links.event_type, links.priority
FROM (VALUES
  -- WILDFIRE: habitat charities first, then broad conservation
  ('rainforest-trust',          'wildfire', 1),
  ('rainforest-action-network', 'wildfire', 1),
  ('wwf',                       'wildfire', 2),
  ('conservation-international','wildfire', 2),
  ('wcs',                       'wildfire', 3),

  -- TROPICAL STORM
  ('wwf',  'tropical_storm', 1),
  ('wcs',  'tropical_storm', 1),
  ('ifaw', 'tropical_storm', 2),

  -- FLOOD
  ('wcs',                        'flood', 1),
  ('wwf',                        'flood', 1),
  ('ifaw',                       'flood', 2),
  ('conservation-international', 'flood', 2),

  -- DROUGHT
  ('african-wildlife-foundation','drought', 1),
  ('cheetah-conservation-fund',  'drought', 2),
  ('wwf',                        'drought', 2),
  ('conservation-international', 'drought', 3),

  -- CORAL BLEACHING
  ('coral-restoration-foundation','coral_bleaching', 1),
  ('reef-check',                  'coral_bleaching', 1),
  ('oceana',                      'coral_bleaching', 2),
  ('wwf',                         'coral_bleaching', 2),

  -- EARTHQUAKE (habitat disruption)
  ('wcs', 'earthquake', 1),
  ('wwf', 'earthquake', 2),
  ('conservation-international', 'earthquake', 2),

  -- VOLCANIC ERUPTION
  ('wcs', 'volcanic_eruption', 1),
  ('wwf', 'volcanic_eruption', 2),
  ('conservation-international', 'volcanic_eruption', 2),

  -- DEFORESTATION
  ('rainforest-trust',            'deforestation', 1),
  ('rainforest-action-network',   'deforestation', 1),
  ('orangutan-foundation-international','deforestation', 2),
  ('bos-foundation',              'deforestation', 2),
  ('conservation-international',  'deforestation', 3),

  -- SEA ICE LOSS
  ('polar-bears-international', 'sea_ice_loss', 1),
  ('oceana',                    'sea_ice_loss', 2),
  ('wwf',                       'sea_ice_loss', 2),
  ('350-org',                   'sea_ice_loss', 3),

  -- CLIMATE ANOMALY (ENSO)
  ('wwf',                        'climate_anomaly', 1),
  ('conservation-international', 'climate_anomaly', 1),
  ('nature-conservancy',         'climate_anomaly', 2),
  ('350-org',                    'climate_anomaly', 2),
  ('rainforest-trust',           'climate_anomaly', 3),

  -- ILLEGAL FISHING
  ('sea-shepherd', 'illegal_fishing', 1),
  ('oceana',       'illegal_fishing', 1),
  ('wwf',          'illegal_fishing', 2),
  ('traffic',      'illegal_fishing', 2)

) AS links (slug, event_type, priority)
JOIN charities c ON c.slug = links.slug
ON CONFLICT DO NOTHING;

-- Down
-- DROP TABLE IF EXISTS charity_event_type_links;
-- DROP TABLE IF EXISTS charity_species_links;
-- DROP TABLE IF EXISTS charities;
```

---

## Shared Types

Add to `shared/types.d.ts`:

```typescript
// Phase 11 — Conservation charities

export interface Charity {
  id: string;
  name: string;
  slug: string;
  url: string;
  donation_url: string;
  description: string;
  logo_url: string | null;
  charity_navigator_rating: number | null;  // 1-4 stars, null if unrated
  headquarters_country: string | null;
  focus_regions: string[];
  is_active: boolean;
  created_at: string;
}

// Minimal form used in Discord embed field — avoids bloating DiscordQueueItem
export interface CharitySummary {
  name: string;
  donation_url: string;
  slug: string;
}
```

---

## Backend Implementation

### `server/src/db/charityQueries.ts` (new)

```typescript
import { sql } from './client.js';
import type { Charity } from '../../../shared/types.js';

const GLOBAL_FALLBACK_SLUGS = ['wwf', 'wcs', 'conservation-international'];

export async function getCharitiesForAlert(
  speciesNames: string[],
  eventType: string,
  limit = 3
): Promise<Charity[]> {
  const found: Charity[] = [];
  const seenIds = new Set<string>();

  // Step 1: Species-specific matches (highest priority)
  if (speciesNames.length > 0) {
    const speciesMatches = await sql<Charity[]>`
      SELECT DISTINCT ON (c.id)
        c.id, c.name, c.slug, c.url, c.donation_url, c.description,
        c.logo_url, c.charity_navigator_rating, c.headquarters_country,
        c.focus_regions, c.is_active, c.created_at
      FROM charities c
      JOIN charity_species_links csl ON c.id = csl.charity_id
      WHERE LOWER(csl.species_name) = ANY(${speciesNames.map(s => s.toLowerCase())})
        AND c.is_active = TRUE
      ORDER BY c.id, csl.priority ASC
      LIMIT ${limit}
    `;
    for (const row of speciesMatches) {
      if (!seenIds.has(row.id) && found.length < limit) {
        found.push(row);
        seenIds.add(row.id);
      }
    }
  }

  // Step 2: Event-type fallback (fill remaining slots)
  if (found.length < limit) {
    const eventMatches = await sql<Charity[]>`
      SELECT DISTINCT ON (c.id)
        c.id, c.name, c.slug, c.url, c.donation_url, c.description,
        c.logo_url, c.charity_navigator_rating, c.headquarters_country,
        c.focus_regions, c.is_active, c.created_at
      FROM charities c
      JOIN charity_event_type_links cel ON c.id = cel.charity_id
      WHERE cel.event_type = ${eventType}
        AND c.is_active = TRUE
      ORDER BY c.id, cel.priority ASC
      LIMIT ${limit}
    `;
    for (const row of eventMatches) {
      if (!seenIds.has(row.id) && found.length < limit) {
        found.push(row);
        seenIds.add(row.id);
      }
    }
  }

  // Step 3: Global fallbacks — WWF, WCS, Conservation International
  if (found.length < limit) {
    const fallbacks = await sql<Charity[]>`
      SELECT id, name, slug, url, donation_url, description,
             logo_url, charity_navigator_rating, headquarters_country,
             focus_regions, is_active, created_at
      FROM charities
      WHERE slug = ANY(${GLOBAL_FALLBACK_SLUGS})
        AND is_active = TRUE
      LIMIT ${limit}
    `;
    for (const row of fallbacks) {
      if (!seenIds.has(row.id) && found.length < limit) {
        found.push(row);
        seenIds.add(row.id);
      }
    }
  }

  return found;
}

export async function getAllCharities(): Promise<Charity[]> {
  return sql<Charity[]>`
    SELECT id, name, slug, url, donation_url, description,
           logo_url, charity_navigator_rating, headquarters_country,
           focus_regions, is_active, created_at
    FROM charities
    WHERE is_active = TRUE
    ORDER BY name ASC
  `;
}

export async function getCharityBySlug(slug: string): Promise<Charity | null> {
  const rows = await sql<Charity[]>`
    SELECT id, name, slug, url, donation_url, description,
           logo_url, charity_navigator_rating, headquarters_country,
           focus_regions, is_active, created_at
    FROM charities
    WHERE slug = ${slug} AND is_active = TRUE
    LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function getCharitiesForSpecies(speciesName: string, limit = 5): Promise<Charity[]> {
  return getCharitiesForAlert([speciesName], '', limit);
}
```

### `server/src/routes/charities.ts` (new)

```typescript
import { Router } from 'express';
import { getAllCharities, getCharityBySlug, getCharitiesForAlert } from '../db/charityQueries.js';
import { NotFoundError, ValidationError } from '../errors.js';

export const charitiesRouter = Router();

// GET /charities?species=X,Y&event_type=wildfire&limit=3
// GET /charities  (list all)
charitiesRouter.get('/', async (req, res) => {
  const speciesParam = req.query['species'];
  const eventType    = typeof req.query['event_type'] === 'string' ? req.query['event_type'] : '';
  const limitParam   = parseInt(String(req.query['limit'] ?? '3'), 10);
  const limit        = Math.min(Math.max(isNaN(limitParam) ? 3 : limitParam, 1), 10);

  if (speciesParam !== undefined || eventType) {
    // Filtered mode: return charities for a specific alert context
    const speciesNames = typeof speciesParam === 'string'
      ? speciesParam.split(',').map(s => s.trim()).filter(Boolean)
      : [];
    const charities = await getCharitiesForAlert(speciesNames, eventType, limit);
    res.json(charities);
  } else {
    // List mode: return all active charities
    const charities = await getAllCharities();
    res.json(charities);
  }
});

// GET /charities/:slug
charitiesRouter.get('/:slug', async (req, res) => {
  const { slug } = req.params;
  if (!slug || !/^[a-z0-9-]+$/.test(slug)) throw new ValidationError('Invalid charity slug');
  const charity = await getCharityBySlug(slug);
  if (!charity) throw new NotFoundError('Charity not found');
  res.json(charity);
});
```

### `server/src/app.ts` — Register router

Add alongside existing routers:
```typescript
import { charitiesRouter } from './routes/charities.js';
// ...
app.use('/charities', charitiesRouter);
```

### `server/src/agents/SynthesisAgent.ts` — Charity embed field

In `processAlert()`, after the RAG retrieval block and before `modelRouter.complete()`:

```typescript
import { getCharitiesForAlert } from '../db/charityQueries.js';

// --- existing RAG block ---

// Query charities for this alert (species-specific → event-type → global fallback)
const alertCharities = await getCharitiesForAlert(
  assessed.species_at_risk,
  assessed.event_type,
  3
);
```

Then after the embed is built and before `embed.setFooter()`:
```typescript
if (alertCharities.length > 0) {
  const donateLinks = alertCharities
    .map(c => `[${c.name}](${c.donation_url})`)
    .join(' · ');
  embed.addFields({
    name: '💛 How You Can Help',
    value: donateLinks,
    inline: false,
  });
}
```

**No changes to `publisher.ts` or `hitl.ts`** — the charity links live inside the embed and flow through the existing pipeline unchanged.

### Discord `/donate` slash command

#### `server/src/discord/bot.ts` — Handler

```typescript
// In commands registration:
new SlashCommandBuilder()
  .setName('donate')
  .setDescription('Find conservation charities for a species or disaster type')
  .addStringOption(opt =>
    opt.setName('species')
       .setDescription('Species name (e.g. "Sumatran Orangutan") — autocomplete supported')
       .setRequired(false)
       .setAutocomplete(true)
  )
  .addStringOption(opt =>
    opt.setName('event_type')
       .setDescription('Disaster type')
       .setRequired(false)
       .addChoices(
         { name: 'Wildfire', value: 'wildfire' },
         { name: 'Deforestation', value: 'deforestation' },
         { name: 'Coral Bleaching', value: 'coral_bleaching' },
         { name: 'Flood', value: 'flood' },
         { name: 'Drought', value: 'drought' },
         { name: 'Tropical Storm', value: 'tropical_storm' },
         { name: 'Sea Ice Loss', value: 'sea_ice_loss' },
         { name: 'Illegal Fishing', value: 'illegal_fishing' },
         { name: 'Earthquake', value: 'earthquake' },
         { name: 'Climate Anomaly', value: 'climate_anomaly' },
       )
  )
```

#### Handler function

```typescript
async function handleDonateCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();
  const speciesInput = interaction.options.getString('species');
  const eventType = interaction.options.getString('event_type') ?? '';

  const speciesNames = speciesInput ? [speciesInput] : [];
  const charities = await getCharitiesForAlert(speciesNames, eventType, 5);

  if (charities.length === 0) {
    await interaction.editReply('No conservation charities found for that combination. Try `/donate` without filters for general recommendations.');
    return;
  }

  const label = speciesInput
    ? `Supporting **${speciesInput}**`
    : eventType
      ? `Responding to **${eventType.replace(/_/g, ' ')}** threats`
      : 'Supporting Wildlife Conservation';

  const embed = new EmbedBuilder()
    .setColor(0x16a34a)
    .setTitle('💛 Conservation Organizations')
    .setDescription(
      `${label} — here are vetted organizations where your donation makes a real difference.`
    );

  for (const charity of charities) {
    const stars = charity.charity_navigator_rating
      ? '⭐'.repeat(charity.charity_navigator_rating) + ` (${charity.charity_navigator_rating}/4 Charity Navigator)`
      : '';
    embed.addFields({
      name: charity.name,
      value: `${charity.description}${stars ? '\n' + stars : ''}\n[Donate →](${charity.donation_url})`,
      inline: false,
    });
  }

  embed.setFooter({ text: 'Wildlife Sentinel · Conservation Action · All charities are vetted' });

  if (config.frontendUrl) {
    embed.addFields({
      name: '🌐 Browse All Partners',
      value: `[${config.frontendUrl}/charities](${config.frontendUrl}/charities)`,
      inline: false,
    });
  }

  await interaction.editReply({ embeds: [embed] });
}
```

#### Autocomplete

Reuse `autocompleteSpecies()` from `speciesQueries.ts` — same pattern as `/species`.

### `server/src/discord/helpContent.ts` — Add `/donate`

```typescript
{ name: '/donate [species] [event_type]', description: 'Find vetted conservation charities for a species or disaster type.' },
```

---

## Frontend Implementation

### `client/components/CharityCard.tsx` (new)

```typescript
import type { Charity } from '@wildlife-sentinel/shared/types';

interface CharityCardProps {
  charity: Charity;
  compact?: boolean;  // compact mode for alert detail page (no description)
}

export default function CharityCard({ charity, compact = false }: CharityCardProps) {
  const stars = charity.charity_navigator_rating;

  return (
    <div className="bg-zinc-900 dark:bg-zinc-900 border border-zinc-800 rounded-lg p-4 flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <a
          href={charity.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm font-semibold text-white hover:text-green-400 transition-colors"
        >
          {charity.name}
        </a>
        {stars && (
          <span className="text-[10px] text-yellow-400 shrink-0">
            {'★'.repeat(stars)}{'☆'.repeat(4 - stars)}
          </span>
        )}
      </div>

      {!compact && (
        <p className="text-[11px] text-zinc-400 leading-relaxed">{charity.description}</p>
      )}

      <a
        href={charity.donation_url}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-auto inline-block text-center text-xs font-semibold
          bg-green-700 hover:bg-green-600 text-white rounded px-3 py-1.5
          transition-colors"
      >
        Donate Now →
      </a>
    </div>
  );
}
```

### `client/lib/api.ts` — New API calls

```typescript
getCharitiesForAlert: (species: string[], eventType: string, limit = 3): Promise<Charity[]> => {
  const params = new URLSearchParams();
  if (species.length > 0) params.set('species', species.join(','));
  if (eventType) params.set('event_type', eventType);
  params.set('limit', String(limit));
  return fetch(`${BASE}/charities?${params}`).then(r => r.json());
},

getCharitiesForSpecies: (speciesName: string, limit = 5): Promise<Charity[]> => {
  const params = new URLSearchParams({ species: speciesName, limit: String(limit) });
  return fetch(`${BASE}/charities?${params}`).then(r => r.json());
},

getAllCharities: (): Promise<Charity[]> =>
  fetch(`${BASE}/charities`).then(r => r.json()),

getCharity: (slug: string): Promise<Charity> =>
  fetch(`${BASE}/charities/${slug}`).then(r => {
    if (!r.ok) throw new Error('Not found');
    return r.json();
  }),
```

### `client/app/alerts/[id]/page.tsx` — "How You Can Help" section

After the Refiner History section, add a charity section. The species and event_type are available from the loaded `AlertDetail`:

```typescript
// In the component, after existing data loads:
const [charities, setCharities] = useState<Charity[]>([]);

useEffect(() => {
  if (!alert) return;
  const species = alert.enrichment_data?.species_at_risk ?? [];
  api.getCharitiesForAlert(species, alert.event_type, 3)
    .then(setCharities)
    .catch(() => setCharities([]));
}, [alert]);

// In JSX, after refiner scores section:
{charities.length > 0 && (
  <section className="space-y-3">
    <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
      💛 How You Can Help
    </h2>
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      {charities.map(c => (
        <CharityCard key={c.id} charity={c} compact />
      ))}
    </div>
    <p className="text-[10px] text-zinc-600">
      All organizations are vetted conservation nonprofits.{' '}
      <Link href="/charities" className="text-zinc-500 hover:text-zinc-400">
        Browse all conservation partners →
      </Link>
    </p>
  </section>
)}
```

### `client/app/species/[slug]/page.tsx` — "Conservation Organizations" section

After the recent alerts list, add:

```typescript
const [charities, setCharities] = useState<Charity[]>([]);

useEffect(() => {
  if (!species) return;
  api.getCharitiesForSpecies(species.species_name, 3)
    .then(setCharities)
    .catch(() => setCharities([]));
}, [species]);

// In JSX:
{charities.length > 0 && (
  <section className="space-y-3">
    <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
      Conservation Organizations
    </h2>
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      {charities.map(c => (
        <CharityCard key={c.id} charity={c} />
      ))}
    </div>
  </section>
)}
```

### `client/app/charities/page.tsx` (new)

A full directory of all vetted conservation organizations:

```typescript
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import CharityCard from '@/components/CharityCard';
import { api } from '@/lib/api';
import type { Charity } from '@wildlife-sentinel/shared/types';

export default function CharitiesPage() {
  const [charities, setCharities] = useState<Charity[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getAllCharities().then(data => {
      setCharities(data);
      setLoading(false);
    });
  }, []);

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100 p-4 md:p-8">
      <div className="max-w-5xl mx-auto space-y-6">
        <div>
          <Link href="/" className="text-[11px] text-zinc-500 hover:text-zinc-400">
            ← Wildlife Sentinel
          </Link>
          <h1 className="text-xl font-bold mt-2">Conservation Partners</h1>
          <p className="text-sm text-zinc-400 mt-1">
            Vetted organizations working to protect endangered species and their habitats.
            When an alert fires, we surface the most relevant charities for the species
            being threatened.
          </p>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 9 }).map((_, i) => (
              <div key={i} className="bg-zinc-900 rounded-lg h-32 animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {charities.map(c => (
              <CharityCard key={c.id} charity={c} />
            ))}
          </div>
        )}

        <p className="text-[10px] text-zinc-600 text-center pt-4">
          Charity Navigator ratings shown where available. Wildlife Sentinel is not affiliated
          with any listed organization and receives no compensation from donations.
        </p>
      </div>
    </main>
  );
}
```

### `client/app/page.tsx` — Add "Charities" to nav

Alongside existing "Alerts" and "Species" nav links, add:
```tsx
<Link href="/charities" className="text-[11px] text-zinc-400 hover:text-zinc-200">
  Charities
</Link>
```

---

## Tests

### `server/tests/db/charityQueries.test.ts` (new, ~8 tests)

| Test | What it checks |
|---|---|
| Returns species-specific charities when species match found | Species in `charity_species_links` returns correct charities first |
| Falls back to event-type when no species match | Empty species list → event-type charities returned |
| Falls back to global charities when no species or event-type match | Unknown event type + empty species → WWF/WCS/CI returned |
| Deduplicates charities across priority tiers | Same charity in species + event-type links appears only once |
| Respects `limit` parameter | `limit=1` returns max 1 charity |
| Returns empty array when nothing configured | No links, no fallbacks matched → `[]` |
| `getAllCharities` returns only active charities | `is_active = false` charities excluded |
| `getCharityBySlug` returns null for unknown slug | Unknown slug → `null` |

### `server/tests/routes/charities.test.ts` (new, ~6 tests)

| Test | What it checks |
|---|---|
| `GET /charities` returns array | All active charities returned |
| `GET /charities?species=X&event_type=Y` passes params to query | Query function called with correct args |
| `GET /charities?limit=2` respects limit | Limit capped at 2 |
| `GET /charities/:slug` returns single charity | Known slug → correct shape |
| `GET /charities/unknown` → 404 | Not found error |
| `GET /charities/bad!slug` → 400 | Validation error |

### `server/tests/agents/SynthesisAgent.test.ts` — Updates (~2 new tests)

Add to mock setup:
```typescript
vi.mock('../src/db/charityQueries.js', () => ({
  getCharitiesForAlert: vi.fn().mockResolvedValue([
    { name: 'WWF', donation_url: 'https://wwf.org/donate', slug: 'wwf' }
  ]),
}));
```

New tests:
- "Embed includes 'How You Can Help' field when charities returned" — field present in embed fields
- "Embed omits charity field when getCharitiesForAlert returns empty array" — no How You Can Help field

### `server/tests/discord/donateCommand.test.ts` (new, ~5 tests)

| Test | What it checks |
|---|---|
| `/donate` with species returns charity embed | Embed has charity name + donate link |
| `/donate` with event_type returns charity embed | Event-type fallback charities returned |
| `/donate` with no args returns general recommendations | Global fallbacks in embed |
| `/donate` with unknown species + no event type → error reply | "No charities found" message |
| Autocomplete delegates to `autocompleteSpecies()` | Same as `/species` autocomplete test |

---

## File Change Matrix

| File | Change | New / Modified |
|---|---|---|
| `server/src/db/migrations/0009_charities.sql` | New migration: schema + seed data | New |
| `shared/types.d.ts` | Add `Charity`, `CharitySummary` types | Modified |
| `server/src/db/charityQueries.ts` | New module: query functions | New |
| `server/src/routes/charities.ts` | New router: REST endpoints | New |
| `server/src/app.ts` | Register `charitiesRouter` at `/charities` | Modified |
| `server/src/agents/SynthesisAgent.ts` | Import charityQueries; add charity field to embed | Modified |
| `server/src/discord/bot.ts` | Add `/donate` command + handler + autocomplete | Modified |
| `server/src/discord/helpContent.ts` | Add `/donate` to `SLASH_COMMANDS` | Modified |
| `server/tests/db/charityQueries.test.ts` | New: ~8 tests | New |
| `server/tests/routes/charities.test.ts` | New: ~6 tests | New |
| `server/tests/agents/SynthesisAgent.test.ts` | Add charity mock + 2 tests | Modified |
| `server/tests/discord/donateCommand.test.ts` | New: ~5 tests | New |
| `client/lib/api.ts` | Add 4 charity API call functions | Modified |
| `client/components/CharityCard.tsx` | New: charity card component | New |
| `client/app/alerts/[id]/page.tsx` | Add "How You Can Help" section | Modified |
| `client/app/species/[slug]/page.tsx` | Add "Conservation Organizations" section | Modified |
| `client/app/charities/page.tsx` | New: full charity directory page | New |
| `client/app/page.tsx` | Add "Charities" nav link | Modified |

---

## Rollout Checklist

Before deploying Phase 11:

- [ ] Run `npm run migrate:prod` — applies migration 0009 (schema + seed data)
- [ ] Verify seed: `SELECT COUNT(*) FROM charities;` → should return ~30
- [ ] Verify seed: `SELECT COUNT(*) FROM charity_species_links;` → should return ~60+
- [ ] Verify seed: `SELECT COUNT(*) FROM charity_event_type_links;` → should return ~40+
- [ ] Spot-check species names: `SELECT species_name FROM charity_species_links LIMIT 10;` — confirm they match real rows in `species_ranges`
- [ ] `npm test` — all tests pass (target: ~465+ Vitest, 43 Playwright)
- [ ] `npm run typecheck` — zero errors (server)
- [ ] `cd client && npm run typecheck` — zero errors
- [ ] `npm run lint` — zero errors
- [ ] Deploy Railway (server)
- [ ] Deploy Vercel (client)
- [ ] Register `/donate` slash command on Discord guild (same pattern as existing slash commands)
- [ ] Test: real Discord alert embed shows "💛 How You Can Help" field
- [ ] Test: `/donate Sumatran Orangutan` in Discord returns charity embed
- [ ] Test: `/charities` page loads in browser, all cards show "Donate Now" buttons
- [ ] Test: alert detail page `/alerts/[id]` shows "How You Can Help" charity cards
- [ ] Test: species profile `/species/sumatran-orangutan` shows "Conservation Organizations"

---

## Species Name Verification (Important)

The charity_species_links seed data uses best-guess GBIF scientific names. After migration, verify that the names actually match rows in `species_ranges`:

```sql
-- Find charity links whose species name doesn't exist in the DB
SELECT DISTINCT csl.species_name
FROM charity_species_links csl
WHERE NOT EXISTS (
  SELECT 1 FROM species_ranges sr
  WHERE LOWER(sr.species_name) = csl.species_name
);
```

For any non-matching names, update the `charity_species_links` table to use the correct GBIF name from `species_ranges`. The feature degrades gracefully — non-matching species links are simply ignored, and the event-type fallback covers the alert instead.

```sql
-- Quick way to find the right name in species_ranges:
SELECT DISTINCT species_name, common_name FROM species_ranges
WHERE species_name ILIKE '%orangutan%' OR common_name ILIKE '%orangutan%';
```

---

## Future Enhancements (Phase 11+)

- **Charity Navigator API** — periodic verification of ratings; flag charities with declining scores for review
- **Every.org embedded widget** — in-page donation without leaving the site (Every.org provides a hosted iframe)
- **Click tracking** — count charity link clicks per alert to learn which charities users engage with
- **Admin endpoint** — `POST /admin/charities` to add/update charities without writing SQL
- **Campaign-specific URLs** — WWF and Panthera have species-specific campaign pages with higher conversion rates than generic donate pages
- **Charity match programs** — surface corporate matching programs during peak disaster events
- **Geographic charity prioritization** — prefer local/regional charities for alerts in their operating region (e.g., show Gorilla Doctors only for Central African alerts, not for orangutan alerts in Borneo)

---

*Phase 11 adds no new env vars, no new data source dependencies, and no external API runtime calls. It is entirely self-contained within the existing stack.*
