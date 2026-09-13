-- MSGate Health Ecosystem — le setting, saisi à la main par les setters
--
-- Le closing vient d'iClosed, qui tient déjà ses deals. Le setting, lui,
-- n'existe nulle part : un setter décroche un rendez-vous en DM et rien ne
-- l'enregistre. Cette table est donc la source, pas une copie — et elle est
-- partagée, parce que plusieurs setters saisissent depuis leurs machines.
--
-- Les colonnes « lead » ne sont pas du confort : sans identité de prospect, une
-- ligne de setting ne peut jamais être rapprochée du deal qu'iClosed rendra, et
-- la question « qui a set la lead que X a closée » reste sans réponse.

create table if not exists public.setting_appointments (
  id uuid primary key default gen_random_uuid(),

  -- « Date » : le jour où le rendez-vous a été décroché.
  set_date date not null default current_date,

  -- Le setter, nommé et joignable.
  setter_name text not null,
  setter_instagram text,

  -- La lead. C'est par ces champs qu'on retrouvera son deal chez iClosed :
  -- l'e-mail d'abord, l'@ Instagram à défaut.
  lead_name text,
  lead_instagram text,
  lead_email text,

  -- « Date de RDV ».
  appointment_at timestamptz not null,

  notes text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Les deux lectures de la page : par date de RDV, et par setter.
create index if not exists setting_appointments_appointment_at_idx
  on public.setting_appointments (appointment_at desc);
create index if not exists setting_appointments_setter_idx
  on public.setting_appointments (setter_name);

-- Le rapprochement avec iClosed se fait sur ces deux clés : on les indexe en
-- minuscules, parce qu'un @ Instagram se saisit comme il se prononce.
create index if not exists setting_appointments_lead_email_idx
  on public.setting_appointments (lower(lead_email));
create index if not exists setting_appointments_lead_instagram_idx
  on public.setting_appointments (lower(lead_instagram));

alter table public.setting_appointments enable row level security;

-- Même politique de départ que le reste du schéma : lecture authentifiée.
-- Les écritures passent par la clé service, côté serveur uniquement.
do $$ begin
  create policy "authenticated read setting_appointments"
    on public.setting_appointments for select to authenticated using (true);
exception when duplicate_object then null; end $$;

-- `updated_at` tenu par la base : une mise à jour partielle depuis l'API ne
-- doit pas pouvoir l'oublier.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$ begin
  create trigger setting_appointments_touch_updated_at
    before update on public.setting_appointments
    for each row execute function public.touch_updated_at();
exception when duplicate_object then null; end $$;
