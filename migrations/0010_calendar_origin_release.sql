-- Spotlight migration 0010: a theatrical release can have two dates.
--
-- The site is going global, and a foreign film usually opens in its home
-- market well before India — a US wide release often lands weeks or months
-- ahead of its Indian theatrical date. `calendar_entries.release_date` has
-- always held exactly one date, so there was nowhere to record both. The
-- product decision (see README) is: show India's date as the primary one,
-- and note the film's home-market date in parentheses when it differs
-- ("US: 13 Aug").
--
-- These columns are populated only when there IS a second, different date to
-- show. A regional Indian film (Telugu, Tamil, Kannada, Hindi...) releases
-- day-and-date within India — there is no second date, so both stay NULL. A
-- foreign film with no known India date at all also leaves both NULL: the one
-- date we have already goes in `release_date`, and repeating it as an
-- "origin" date would just be visual noise.

ALTER TABLE calendar_entries ADD COLUMN origin_region TEXT;
ALTER TABLE calendar_entries ADD COLUMN origin_release_date DATE;

-- A lone origin_region with no date (or vice versa) is a data bug, not a
-- valid state — the pair is always populated together or not at all.
ALTER TABLE calendar_entries
    ADD CONSTRAINT chk_calendar_origin_pair
    CHECK ((origin_region IS NULL) = (origin_release_date IS NULL));
