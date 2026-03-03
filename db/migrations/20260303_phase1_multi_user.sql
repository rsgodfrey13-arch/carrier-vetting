-- Phase 1 (backend-first): multi-user foundation + company-scoped business data

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(255) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  plan varchar(100),
  carrier_limit bigint,
  stripe_customer_id text,
  stripe_subscription_id text,
  subscription_status text,
  current_period_end timestamp,
  cancel_at_period_end boolean DEFAULT false
);
CREATE INDEX IF NOT EXISTS companies_name_idx ON public.companies(name);
CREATE UNIQUE INDEX IF NOT EXISTS companies_stripe_customer_id_uidx
  ON public.companies (stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.company_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id int4 NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  role varchar(20) NOT NULL CHECK (role IN ('OWNER', 'ADMIN', 'MEMBER')),
  status varchar(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INVITED', 'DISABLED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, user_id)
);
CREATE INDEX IF NOT EXISTS company_members_company_id_idx ON public.company_members(company_id);
CREATE INDEX IF NOT EXISTS company_members_user_id_idx ON public.company_members(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS company_members_one_owner_uidx
  ON public.company_members(company_id)
  WHERE role = 'OWNER' AND status = 'ACTIVE';

CREATE TABLE IF NOT EXISTS public.company_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  invited_email text NOT NULL,
  role varchar(20) NOT NULL CHECK (role IN ('ADMIN', 'MEMBER')),
  invited_by_user_id int4 NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  status varchar(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','ACCEPTED','EXPIRED','REVOKED')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz
);
CREATE INDEX IF NOT EXISTS company_invites_company_id_idx ON public.company_invites(company_id);
CREATE INDEX IF NOT EXISTS company_invites_invited_email_idx ON public.company_invites(lower(invited_email));

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS default_company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS users_default_company_id_idx ON public.users(default_company_id);

-- one-company-per-existing-user backfill
WITH seed_users AS (
  SELECT
    u.id AS user_id,
    gen_random_uuid() AS company_id,
    COALESCE(NULLIF(TRIM(u.company), ''), split_part(u.email, '@', 1) || ' Company') AS company_name,
    u.plan,
    u.carrier_limit,
    u.stripe_customer_id,
    u.stripe_subscription_id,
    u.subscription_status,
    u.current_period_end,
    COALESCE(u.cancel_at_period_end, false) AS cancel_at_period_end
  FROM public.users u
  LEFT JOIN public.company_members cm ON cm.user_id = u.id
  WHERE cm.id IS NULL
), inserted_companies AS (
  INSERT INTO public.companies (
    id,
    name,
    plan,
    carrier_limit,
    stripe_customer_id,
    stripe_subscription_id,
    subscription_status,
    current_period_end,
    cancel_at_period_end
  )
  SELECT
    su.company_id,
    su.company_name,
    su.plan,
    su.carrier_limit,
    su.stripe_customer_id,
    su.stripe_subscription_id,
    su.subscription_status,
    su.current_period_end,
    su.cancel_at_period_end
  FROM seed_users su
  ON CONFLICT (id) DO NOTHING
)
INSERT INTO public.company_members (company_id, user_id, role, status)
SELECT su.company_id, su.user_id, 'OWNER', 'ACTIVE'
FROM seed_users su
ON CONFLICT (company_id, user_id) DO NOTHING;

UPDATE public.users u
SET default_company_id = cm.company_id
FROM public.company_members cm
WHERE cm.user_id = u.id
  AND cm.role = 'OWNER'
  AND cm.status = 'ACTIVE'
  AND u.default_company_id IS NULL;

ALTER TABLE public.user_carriers ADD COLUMN IF NOT EXISTS company_id uuid;
UPDATE public.user_carriers uc
SET company_id = u.default_company_id
FROM public.users u
WHERE uc.user_id = u.id
  AND uc.company_id IS NULL;
ALTER TABLE public.user_carriers ALTER COLUMN company_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS user_carriers_company_id_idx ON public.user_carriers(company_id);
CREATE UNIQUE INDEX IF NOT EXISTS user_carriers_company_dot_uidx ON public.user_carriers(company_id, carrier_dot);

ALTER TABLE public.user_carrier_alert_recipients ADD COLUMN IF NOT EXISTS company_id uuid;
UPDATE public.user_carrier_alert_recipients ucar
SET company_id = u.default_company_id
FROM public.users u
WHERE ucar.user_id = u.id
  AND ucar.company_id IS NULL;
ALTER TABLE public.user_carrier_alert_recipients ALTER COLUMN company_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS ucar_company_dot_idx ON public.user_carrier_alert_recipients(company_id, carrier_dot);

ALTER TABLE public.user_contracts ADD COLUMN IF NOT EXISTS company_id uuid;
UPDATE public.user_contracts uc
SET company_id = u.default_company_id
FROM public.users u
WHERE uc.user_id = u.id
  AND uc.company_id IS NULL;
ALTER TABLE public.user_contracts ALTER COLUMN company_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS user_contracts_company_id_idx ON public.user_contracts(company_id);

ALTER TABLE public.contracts ADD COLUMN IF NOT EXISTS company_id uuid;
UPDATE public.contracts c
SET company_id = u.default_company_id
FROM public.users u
WHERE c.user_id = u.id
  AND c.company_id IS NULL;
ALTER TABLE public.contracts ALTER COLUMN company_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS contracts_company_dot_idx ON public.contracts(company_id, dotnumber, sent_at DESC);

COMMIT;
