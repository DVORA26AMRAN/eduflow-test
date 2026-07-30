-- Institution timezone source of truth for Meeting Calendar.
--
-- Existing institution rows in this deployment are the current Israeli tenant
-- data. Future institutions retain the neutral UTC default until their real
-- timezone is configured.

ALTER TABLE public.institutions
    ADD COLUMN IF NOT EXISTS timezone TEXT;

UPDATE public.institutions
SET timezone = 'Asia/Jerusalem'
WHERE timezone IS NULL;

ALTER TABLE public.institutions
    ALTER COLUMN timezone SET DEFAULT 'UTC',
    ALTER COLUMN timezone SET NOT NULL;

COMMENT ON COLUMN public.institutions.timezone IS
    'IANA timezone used for institution-local scheduling and display.';

-- Only meetings belonging to institutions explicitly marked as Israeli are
-- backfilled. Other timezone values and non-UTC meeting values are preserved.
UPDATE public.meetings AS m
SET institution_timezone = i.timezone
FROM public.institutions AS i
WHERE i.id = m.institution_id
  AND i.timezone = 'Asia/Jerusalem'
  AND m.institution_timezone = 'UTC';
