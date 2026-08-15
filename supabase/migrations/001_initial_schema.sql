-- MSGate Health Ecosystem — Supabase schema
-- Run in Supabase SQL editor or via supabase db push

create extension if not exists "pgcrypto";

-- Roles enum
do $$ begin
  create type user_role as enum ('admin', 'operator', 'viewer');
exception when duplicate_object then null; end $$;

do $$ begin
  create type entity_status as enum (
    'active', 'opening', 'backup', 'restricted', 'closed',
    'underwriting', 'declined', 'inactive'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type alert_level as enum ('info', 'warning', 'critical');
exception when duplicate_object then null; end $$;

do $$ begin
  create type alert_status as enum ('active', 'acknowledged', 'resolved');
exception when duplicate_object then null; end $$;

do $$ begin
  create type recovery_type as enum ('bank_closure', 'mid_closure');
exception when duplicate_object then null; end $$;

do $$ begin
  create type recovery_status as enum (
    'open', 'in_progress', 'waiting_on_ibo', 'waiting_on_bank',
    'funds_recovered', 'resolved', 'lost_funds'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type recovery_priority as enum ('low', 'medium', 'high', 'critical');
exception when duplicate_object then null; end $$;

do $$ begin
  create type step_status as enum ('pending', 'in_progress', 'done', 'skipped');
exception when duplicate_object then null; end $$;

-- users (extends auth.users)
create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  full_name text not null,
  role user_role not null default 'viewer',
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ibos (
  id uuid primary key default gen_random_uuid(),
  reference_code text not null unique,
  display_name text,
  status entity_status not null default 'active',
  active_banks_count int not null default 0,
  backup_banks_count int not null default 0,
  active_mids_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.isos (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  contact_name text,
  status entity_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.processors (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  status entity_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.crms (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  status entity_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.shops (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  crm_id uuid references public.crms(id) on delete set null,
  status entity_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.bank_pages (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  ibo_id uuid references public.ibos(id) on delete set null,
  status entity_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.banks (
  id uuid primary key default gen_random_uuid(),
  ibo_id uuid not null references public.ibos(id) on delete cascade,
  name text not null,
  status entity_status not null default 'opening',
  is_backup boolean not null default false,
  opened_at timestamptz,
  closed_at timestamptz,
  funds_at_risk numeric(12,2),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.mids (
  id uuid primary key default gen_random_uuid(),
  ibo_id uuid not null references public.ibos(id) on delete cascade,
  bank_id uuid references public.banks(id) on delete set null,
  processor_id uuid references public.processors(id) on delete set null,
  iso_id uuid references public.isos(id) on delete set null,
  crm_id uuid references public.crms(id) on delete set null,
  shop_id uuid references public.shops(id) on delete set null,
  reference_code text not null unique,
  status entity_status not null default 'underwriting',
  underwriting_started_at timestamptz,
  approved_at timestamptz,
  closed_at timestamptz,
  average_volume numeric(12,2),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.alerts (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null,
  level alert_level not null default 'warning',
  category text not null,
  entity_type text,
  entity_id text,
  entity_label text,
  owner text,
  status alert_status not null default 'active',
  recommended_action text,
  recovery_case_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table if not exists public.recovery_cases (
  id uuid primary key default gen_random_uuid(),
  type recovery_type not null,
  title text not null,
  status recovery_status not null default 'open',
  priority recovery_priority not null default 'high',
  ibo_id uuid references public.ibos(id) on delete set null,
  bank_id uuid references public.banks(id) on delete set null,
  mid_id uuid references public.mids(id) on delete set null,
  funds_at_risk numeric(12,2),
  closed_at timestamptz,
  reason text,
  backup_bank_id uuid references public.banks(id) on delete set null,
  replacement_mid_id uuid references public.mids(id) on delete set null,
  comments text,
  documents text[] default '{}',
  estimated_recovery_date date,
  processor_id uuid references public.processors(id) on delete set null,
  iso_id uuid references public.isos(id) on delete set null,
  shop_id uuid references public.shops(id) on delete set null,
  crm_id uuid references public.crms(id) on delete set null,
  average_volume numeric(12,2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.alerts
  drop constraint if exists alerts_recovery_case_id_fkey;
alter table public.alerts
  add constraint alerts_recovery_case_id_fkey
  foreign key (recovery_case_id) references public.recovery_cases(id) on delete set null;

create table if not exists public.recovery_steps (
  id uuid primary key default gen_random_uuid(),
  recovery_case_id uuid not null references public.recovery_cases(id) on delete cascade,
  step_order int not null,
  title text not null,
  status step_status not null default 'pending',
  completed_at timestamptz,
  notes text
);

create table if not exists public.sops (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  category text not null,
  summary text not null,
  objective text not null,
  prerequisites text[] default '{}',
  documents_needed text[] default '{}',
  estimated_time text,
  difficulty text not null default 'medium',
  owner text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.sop_steps (
  id uuid primary key default gen_random_uuid(),
  sop_id uuid not null references public.sops(id) on delete cascade,
  step_order int not null,
  title text not null,
  description text,
  is_checklist_item boolean not null default true
);

create table if not exists public.business_weekly_metrics (
  id uuid primary key default gen_random_uuid(),
  week_start date not null,
  week_end date not null,
  roas_7d numeric(8,2) not null default 0,
  roas_otp_7d numeric(8,2) not null default 0,
  roas_rebill_7d numeric(8,2) not null default 0,
  roas_combined_7d numeric(8,2) not null default 0,
  spend numeric(12,2) not null default 0,
  revenue numeric(12,2) not null default 0,
  active_subscribers int not null default 0,
  new_subscribers int not null default 0,
  lost_subscribers int not null default 0,
  churn_rate numeric(8,2) not null default 0,
  retention_rate numeric(8,2) not null default 0,
  net_growth int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (week_start)
);

create table if not exists public.system_health_rules (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  label text not null,
  description text not null,
  penalty int not null default 0,
  enabled boolean not null default true,
  threshold numeric
);

create table if not exists public.sync_logs (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  status text not null,
  message text not null,
  records_synced int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.app_settings (
  id int primary key default 1 check (id = 1),
  min_active_banks int not null default 12,
  min_active_mids int not null default 10,
  recommended_banks_per_ibo int not null default 2,
  max_underwriting_days int not null default 14,
  max_payout_delay_days int not null default 5,
  churn_threshold numeric(8,2) not null default 15,
  currency text not null default 'USD',
  timezone text not null default 'Europe/Paris',
  sync_frequency_minutes int not null default 30,
  airtable_base_id text,
  airtable_configured boolean not null default false,
  updated_at timestamptz not null default now()
);

-- Indexes
create index if not exists idx_banks_ibo on public.banks(ibo_id);
create index if not exists idx_mids_ibo on public.mids(ibo_id);
create index if not exists idx_mids_status on public.mids(status);
create index if not exists idx_alerts_status on public.alerts(status);
create index if not exists idx_recovery_status on public.recovery_cases(status);

-- RLS
alter table public.users enable row level security;
alter table public.ibos enable row level security;
alter table public.banks enable row level security;
alter table public.mids enable row level security;
alter table public.alerts enable row level security;
alter table public.recovery_cases enable row level security;
alter table public.recovery_steps enable row level security;
alter table public.sops enable row level security;
alter table public.sop_steps enable row level security;
alter table public.business_weekly_metrics enable row level security;
alter table public.system_health_rules enable row level security;
alter table public.sync_logs enable row level security;
alter table public.app_settings enable row level security;
alter table public.isos enable row level security;
alter table public.processors enable row level security;
alter table public.crms enable row level security;
alter table public.shops enable row level security;
alter table public.bank_pages enable row level security;

-- Helper: current user role
create or replace function public.current_user_role()
returns user_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.users where id = auth.uid();
$$;

-- Authenticated read policies (simplified starter)
do $$ begin
  create policy "authenticated read ibos" on public.ibos for select to authenticated using (true);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "authenticated read banks" on public.banks for select to authenticated using (true);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "authenticated read mids" on public.mids for select to authenticated using (true);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "authenticated read alerts" on public.alerts for select to authenticated using (true);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "authenticated read recovery" on public.recovery_cases for select to authenticated using (true);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "operators write alerts" on public.alerts for update to authenticated
    using (public.current_user_role() in ('admin', 'operator'));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "operators write recovery" on public.recovery_cases for all to authenticated
    using (public.current_user_role() in ('admin', 'operator'));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "admin write settings" on public.app_settings for all to authenticated
    using (public.current_user_role() = 'admin');
exception when duplicate_object then null; end $$;

insert into public.app_settings (id) values (1)
on conflict (id) do nothing;

/*
Relations summary:
users 1—n (auth only)
ibos 1—n banks
ibos 1—n mids
banks 1—n mids
processors 1—n mids
isos 1—n mids
crms 1—n mids / shops
shops 1—n mids
recovery_cases 1—n recovery_steps
sops 1—n sop_steps
alerts n—1 recovery_cases (optional)
Chain: IBO → (LLC implied) → Banks → MIDs → CRM → Shop
*/
