-- Migration: 0009_charities
-- Purpose: Conservation charity database for Phase 11 — targeted donation links in alerts.

-- Up

CREATE TABLE IF NOT EXISTS charities (
  id                        UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  name                      TEXT          NOT NULL,
  slug                      VARCHAR(100)  NOT NULL UNIQUE,
  url                       TEXT          NOT NULL,
  donation_url              TEXT          NOT NULL,
  description               TEXT          NOT NULL,
  logo_url                  TEXT,
  charity_navigator_rating  SMALLINT,
  headquarters_country      VARCHAR(3),
  focus_regions             TEXT[]        DEFAULT '{}',
  is_active                 BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at                TIMESTAMPTZ   DEFAULT NOW(),
  updated_at                TIMESTAMPTZ   DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS charity_species_links (
  charity_id   UUID      NOT NULL REFERENCES charities(id) ON DELETE CASCADE,
  species_name TEXT      NOT NULL,
  priority     SMALLINT  NOT NULL DEFAULT 1,
  PRIMARY KEY (charity_id, species_name)
);

CREATE TABLE IF NOT EXISTS charity_event_type_links (
  charity_id  UUID      NOT NULL REFERENCES charities(id) ON DELETE CASCADE,
  event_type  TEXT      NOT NULL,
  priority    SMALLINT  NOT NULL DEFAULT 1,
  PRIMARY KEY (charity_id, event_type)
);

CREATE INDEX IF NOT EXISTS idx_charity_species    ON charity_species_links    (species_name);
CREATE INDEX IF NOT EXISTS idx_charity_event_type ON charity_event_type_links (event_type);
CREATE INDEX IF NOT EXISTS idx_charities_slug     ON charities                (slug);
CREATE INDEX IF NOT EXISTS idx_charities_active   ON charities                (is_active);

-- ============================================================
-- SEED: ~30 vetted conservation organizations
-- ============================================================

INSERT INTO charities (name, slug, url, donation_url, description, charity_navigator_rating, headquarters_country, focus_regions) VALUES

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

('Rainforest Trust', 'rainforest-trust',
 'https://www.rainforesttrust.org', 'https://www.rainforesttrust.org/donate',
 'Protecting tropical forests and their biodiversity through partnerships with local and international conservation groups.',
 4, 'USA', ARRAY['Tropics', 'South America', 'Africa', 'Asia']),

('Rainforest Action Network', 'rainforest-action-network',
 'https://www.ran.org', 'https://www.ran.org/donate',
 'Preserving forests, protecting the climate, and upholding human rights by challenging corporate power and systemic injustice.',
 3, 'USA', ARRAY['Tropics', 'South America', 'Asia']),

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

('Polar Bears International', 'polar-bears-international',
 'https://polarbearsinternational.org', 'https://polarbearsinternational.org/get-involved/donate',
 'The world''s leading polar bear conservation organization, dedicated to saving polar bears and the sea ice they depend on.',
 4, 'USA', ARRAY['Arctic']),

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

('Gorilla Doctors', 'gorilla-doctors',
 'https://www.gorilladoctors.org', 'https://www.gorilladoctors.org/donate',
 'Providing individual medical care to mountain gorillas in the wild and supporting the communities that surround them.',
 4, 'USA', ARRAY['Central Africa']),

('Dian Fossey Gorilla Fund', 'dian-fossey-gorilla-fund',
 'https://gorillafund.org', 'https://gorillafund.org/support/donate',
 'The world''s leading organization protecting and studying gorillas, with decades of research in Rwanda and the Congo.',
 4, 'USA', ARRAY['Central Africa', 'East Africa']),

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

('350.org', '350-org',
 'https://350.org', 'https://350.org/donate',
 'A global movement working to end the age of fossil fuels, fighting climate change as the leading driver of biodiversity loss.',
 NULL, 'USA', ARRAY['Global']),

('TRAFFIC', 'traffic',
 'https://www.traffic.org', 'https://www.traffic.org/take-action/donate',
 'The leading NGO working globally on trade in wild animals and plants, ensuring that trade does not threaten wildlife.',
 NULL, 'GBR', ARRAY['Global']),

('Coral Triangle Initiative', 'coral-triangle-initiative',
 'https://coraltriangleinitiative.org', 'https://coraltriangleinitiative.org/support',
 'A multilateral partnership of six countries protecting the Coral Triangle — the world''s center of marine biodiversity.',
 NULL, 'IDN', ARRAY['Indo-Pacific', 'Southeast Asia'])

ON CONFLICT (slug) DO NOTHING;

-- ============================================================
-- SEED: Species-specific charity links
-- Scientific names must match species_ranges.species_name exactly.
-- Run post-migration verification query to find non-matching names.
-- ============================================================

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

  -- ORANGUTANS
  INSERT INTO charity_species_links (charity_id, species_name, priority) VALUES
    (v_ofi,  'pongo abelii',         1),
    (v_sos,  'pongo abelii',         1),
    (v_wwf,  'pongo abelii',         2),
    (v_bos,  'pongo pygmaeus',       1),
    (v_ofi,  'pongo pygmaeus',       2),
    (v_wwf,  'pongo pygmaeus',       2),
    (v_ofi,  'pongo tapanuliensis',  1),
    (v_sos,  'pongo tapanuliensis',  2)
  ON CONFLICT DO NOTHING;

  -- TIGERS
  INSERT INTO charity_species_links (charity_id, species_name, priority) VALUES
    (v_panthera, 'panthera tigris',                   1),
    (v_wwf,      'panthera tigris',                   2),
    (v_wcs,      'panthera tigris',                   2),
    (v_panthera, 'panthera tigris ssp. sumatrae',     1),
    (v_sos,      'panthera tigris ssp. sumatrae',     2),
    (v_panthera, 'panthera tigris ssp. altaica',      1)
  ON CONFLICT DO NOTHING;

  -- LIONS
  INSERT INTO charity_species_links (charity_id, species_name, priority) VALUES
    (v_panthera,  'panthera leo',  1),
    (v_awf,       'panthera leo',  2),
    (v_born_free, 'panthera leo',  2)
  ON CONFLICT DO NOTHING;

  -- LEOPARDS / BIG CATS
  INSERT INTO charity_species_links (charity_id, species_name, priority) VALUES
    (v_panthera,         'panthera uncia',    1),
    (v_snow_leopard,     'panthera uncia',    1),
    (v_wwf,              'panthera uncia',    2),
    (v_panthera,         'panthera pardus',   1),
    (v_panthera,         'panthera onca',     1),
    (v_rainforest_trust, 'panthera onca',     2),
    (v_panthera,         'neofelis nebulosa', 1),
    (v_wcs,              'neofelis nebulosa', 2)
  ON CONFLICT DO NOTHING;

  -- GORILLAS
  INSERT INTO charity_species_links (charity_id, species_name, priority) VALUES
    (v_gorilla_doctors, 'gorilla beringei',               1),
    (v_fossey,          'gorilla beringei',               1),
    (v_awf,             'gorilla beringei',               2),
    (v_gorilla_doctors, 'gorilla beringei ssp. beringei', 1),
    (v_fossey,          'gorilla beringei ssp. beringei', 1),
    (v_wwf,             'gorilla gorilla',                1),
    (v_wcs,             'gorilla gorilla',                2)
  ON CONFLICT DO NOTHING;

  -- CHIMPANZEES / BONOBOS
  INSERT INTO charity_species_links (charity_id, species_name, priority) VALUES
    (v_wcs, 'pan troglodytes', 1),
    (v_wwf, 'pan troglodytes', 2),
    (v_wcs, 'pan paniscus',    1),
    (v_wwf, 'pan paniscus',    2)
  ON CONFLICT DO NOTHING;

  -- ELEPHANTS
  INSERT INTO charity_species_links (charity_id, species_name, priority) VALUES
    (v_elephant_found, 'loxodonta africana',  1),
    (v_awf,            'loxodonta africana',  2),
    (v_born_free,      'loxodonta africana',  2),
    (v_elephant_found, 'loxodonta cyclotis',  1),
    (v_awf,            'loxodonta cyclotis',  2),
    (v_wwf,            'elephas maximus',     1),
    (v_elephant_found, 'elephas maximus',     2),
    (v_wcs,            'elephas maximus',     2)
  ON CONFLICT DO NOTHING;

  -- RHINOS
  INSERT INTO charity_species_links (charity_id, species_name, priority) VALUES
    (v_save_rhino, 'ceratotherium simum',      1),
    (v_wwf,        'ceratotherium simum',      2),
    (v_save_rhino, 'diceros bicornis',         1),
    (v_awf,        'diceros bicornis',         2),
    (v_save_rhino, 'dicerorhinus sumatrensis', 1),
    (v_wwf,        'dicerorhinus sumatrensis', 2),
    (v_save_rhino, 'rhinoceros sondaicus',     1),
    (v_wcs,        'rhinoceros sondaicus',     2),
    (v_save_rhino, 'rhinoceros unicornis',     1)
  ON CONFLICT DO NOTHING;

  -- POLAR BEARS
  INSERT INTO charity_species_links (charity_id, species_name, priority) VALUES
    (v_polar_bears, 'ursus maritimus', 1),
    (v_wwf,         'ursus maritimus', 2),
    (v_oceana,      'ursus maritimus', 2)
  ON CONFLICT DO NOTHING;

  -- CHEETAHS
  INSERT INTO charity_species_links (charity_id, species_name, priority) VALUES
    (v_cheetah, 'acinonyx jubatus', 1),
    (v_awf,     'acinonyx jubatus', 2)
  ON CONFLICT DO NOTHING;

  -- AFRICAN WILD DOGS
  INSERT INTO charity_species_links (charity_id, species_name, priority) VALUES
    (v_wild_dog, 'lycaon pictus', 1),
    (v_awf,      'lycaon pictus', 2)
  ON CONFLICT DO NOTHING;

  -- MARINE: WHALES & DOLPHINS
  INSERT INTO charity_species_links (charity_id, species_name, priority) VALUES
    (v_wdc,          'tursiops truncatus',    1),
    (v_sea_shepherd, 'tursiops truncatus',    2),
    (v_wdc,          'orcinus orca',          1),
    (v_oceana,       'orcinus orca',          2),
    (v_sea_shepherd, 'balaenoptera musculus', 1),
    (v_wdc,          'balaenoptera musculus', 2),
    (v_sea_shepherd, 'phocoena sinus',        1),
    (v_oceana,       'phocoena sinus',        2),
    (v_wdc,          'platanista gangetica',  1)
  ON CONFLICT DO NOTHING;

  -- MARINE: WHALE SHARK / MANTA
  INSERT INTO charity_species_links (charity_id, species_name, priority) VALUES
    (v_sea_shepherd, 'rhincodon typus', 1),
    (v_oceana,       'rhincodon typus', 2),
    (v_wwf,          'rhincodon typus', 2)
  ON CONFLICT DO NOTHING;

  -- MARINE: DUGONG / SEA TURTLE
  INSERT INTO charity_species_links (charity_id, species_name, priority) VALUES
    (v_wwf,          'dugong dugon',               1),
    (v_sea_shepherd, 'dugong dugon',               2),
    (v_sea_shepherd, 'chelonia mydas',             1),
    (v_oceana,       'chelonia mydas',             2),
    (v_sea_shepherd, 'eretmochelys imbricata',     1),
    (v_sea_shepherd, 'dermochelys coriacea',       1)
  ON CONFLICT DO NOTHING;

  -- CORAL
  INSERT INTO charity_species_links (charity_id, species_name, priority) VALUES
    (v_coral_rest, 'acropora cervicornis', 1),
    (v_reef_check, 'acropora cervicornis', 2),
    (v_coral_rest, 'acropora palmata',     1),
    (v_reef_check, 'acropora palmata',     2),
    (v_coral_rest, 'orbicella annularis',  1)
  ON CONFLICT DO NOTHING;

  -- SUMATRAN SPECIES
  INSERT INTO charity_species_links (charity_id, species_name, priority) VALUES
    (v_sos, 'elephas maximus sumatranus', 1),
    (v_wwf, 'tapirus indicus',            1),
    (v_wcs, 'helarctos malayanus',        1)
  ON CONFLICT DO NOTHING;

  -- AMAZON / SOUTH AMERICAN SPECIES
  INSERT INTO charity_species_links (charity_id, species_name, priority) VALUES
    (v_wwf,            'pteronura brasiliensis', 1),
    (v_rainforest_trust,'pteronura brasiliensis',2),
    (v_wcs,            'inia geoffrensis',       1),
    (v_rainforest_trust,'tapirus terrestris',    1)
  ON CONFLICT DO NOTHING;

END $$;

-- ============================================================
-- SEED: Event-type charity links (fallback tier)
-- ============================================================

INSERT INTO charity_event_type_links (charity_id, event_type, priority)
SELECT c.id, links.event_type, links.priority
FROM (VALUES
  ('rainforest-trust',            'wildfire', 1),
  ('rainforest-action-network',   'wildfire', 1),
  ('wwf',                         'wildfire', 2),
  ('conservation-international',  'wildfire', 2),
  ('wcs',                         'wildfire', 3),

  ('wwf',  'tropical_storm', 1),
  ('wcs',  'tropical_storm', 1),
  ('ifaw', 'tropical_storm', 2),

  ('wcs',                         'flood', 1),
  ('wwf',                         'flood', 1),
  ('ifaw',                        'flood', 2),
  ('conservation-international',  'flood', 2),

  ('african-wildlife-foundation', 'drought', 1),
  ('cheetah-conservation-fund',   'drought', 2),
  ('wwf',                         'drought', 2),
  ('conservation-international',  'drought', 3),

  ('coral-restoration-foundation','coral_bleaching', 1),
  ('reef-check',                  'coral_bleaching', 1),
  ('oceana',                      'coral_bleaching', 2),
  ('wwf',                         'coral_bleaching', 2),

  ('wcs', 'earthquake', 1),
  ('wwf', 'earthquake', 2),
  ('conservation-international', 'earthquake', 2),

  ('wcs', 'volcanic_eruption', 1),
  ('wwf', 'volcanic_eruption', 2),
  ('conservation-international', 'volcanic_eruption', 2),

  ('rainforest-trust',             'deforestation', 1),
  ('rainforest-action-network',    'deforestation', 1),
  ('orangutan-foundation-international','deforestation', 2),
  ('bos-foundation',               'deforestation', 2),
  ('conservation-international',   'deforestation', 3),

  ('polar-bears-international', 'sea_ice_loss', 1),
  ('oceana',                    'sea_ice_loss', 2),
  ('wwf',                       'sea_ice_loss', 2),
  ('350-org',                   'sea_ice_loss', 3),

  ('wwf',                         'climate_anomaly', 1),
  ('conservation-international',  'climate_anomaly', 1),
  ('nature-conservancy',          'climate_anomaly', 2),
  ('350-org',                     'climate_anomaly', 2),
  ('rainforest-trust',            'climate_anomaly', 3),

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
