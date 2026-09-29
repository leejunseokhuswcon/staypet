-- StayPet backend foundation: identity-preserving character generation PoC
-- Apply through the Supabase migration workflow. The API uses the service role;
-- frontend clients do not receive direct table or private-bucket access.

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create table public.pets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  name text not null check (char_length(name) between 1 and 80),
  species text not null check (species in ('dog', 'cat')),
  appearance_metadata jsonb not null default '{}'::jsonb,
  deleted_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);
create index pets_owner_id_idx on public.pets(owner_id) where deleted_at is null;

create table public.pet_source_images (
  id uuid primary key default gen_random_uuid(),
  pet_id uuid not null references public.pets(id) on delete cascade,
  storage_bucket text not null,
  storage_path text not null unique,
  media_type text not null,
  byte_size integer not null check (byte_size > 0),
  sha256 text not null check (char_length(sha256) = 64),
  width integer not null check (width > 0),
  height integer not null check (height > 0),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (pet_id, sha256)
);
create index pet_source_images_pet_id_idx on public.pet_source_images(pet_id);

create table public.generation_jobs (
  id uuid primary key default gen_random_uuid(),
  pet_id uuid not null references public.pets(id) on delete cascade,
  canonical_character_id uuid,
  job_type text not null check (job_type in ('candidate_generation', 'asset_pack_generation')),
  status text not null default 'queued' check (status in ('queued', 'processing', 'succeeded', 'failed')),
  provider text not null,
  provider_model text not null,
  prompt_version text not null,
  style_version text not null,
  config_version text not null,
  idempotency_key text not null,
  input_snapshot jsonb not null default '{}'::jsonb,
  output_summary jsonb not null default '{}'::jsonb,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 3 check (max_attempts > 0),
  next_attempt_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  last_error_code text,
  last_error_message text,
  last_error_retriable boolean,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (pet_id, job_type, idempotency_key)
);
create index generation_jobs_pet_id_idx on public.generation_jobs(pet_id);
create index generation_jobs_claim_idx on public.generation_jobs(status, next_attempt_at, created_at);

create table public.character_candidates (
  id uuid primary key default gen_random_uuid(),
  pet_id uuid not null references public.pets(id) on delete cascade,
  generation_job_id uuid not null references public.generation_jobs(id) on delete cascade,
  candidate_index integer not null check (candidate_index >= 0),
  storage_bucket text not null,
  storage_path text not null unique,
  media_type text not null,
  width integer not null check (width > 0),
  height integer not null check (height > 0),
  sha256 text not null check (char_length(sha256) = 64),
  provider_asset_id text,
  generation_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (generation_job_id, candidate_index)
);
create index character_candidates_pet_id_idx on public.character_candidates(pet_id);
create index character_candidates_job_id_idx on public.character_candidates(generation_job_id);

create table public.canonical_characters (
  id uuid primary key default gen_random_uuid(),
  pet_id uuid not null references public.pets(id) on delete cascade,
  version integer not null check (version > 0),
  selected_candidate_id uuid not null references public.character_candidates(id) on delete restrict,
  selection_fingerprint text not null check (char_length(selection_fingerprint) = 64),
  source_image_ids jsonb not null,
  species text not null check (species in ('dog', 'cat')),
  appearance_metadata jsonb not null default '{}'::jsonb,
  style_version text not null,
  provider text not null,
  provider_model text not null,
  prompt_version text not null,
  config_version text not null,
  correction_history jsonb not null default '[]'::jsonb,
  storage_bucket text not null,
  storage_path text not null unique,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (pet_id, version),
  unique (pet_id, selection_fingerprint)
);
create index canonical_characters_pet_id_idx on public.canonical_characters(pet_id, version desc);

alter table public.generation_jobs
  add constraint generation_jobs_canonical_character_fk
  foreign key (canonical_character_id) references public.canonical_characters(id) on delete cascade;
create index generation_jobs_canonical_character_idx on public.generation_jobs(canonical_character_id);

create table public.character_asset_packs (
  id uuid primary key default gen_random_uuid(),
  canonical_character_id uuid not null references public.canonical_characters(id) on delete cascade,
  generation_job_id uuid not null unique references public.generation_jobs(id) on delete cascade,
  version integer not null check (version > 0),
  status text not null default 'queued' check (status in ('queued', 'processing', 'succeeded', 'failed')),
  manifest_version text not null default '1.0',
  required_states jsonb not null default '[]'::jsonb,
  manifest jsonb not null default '{}'::jsonb,
  storage_bucket text,
  manifest_storage_path text unique,
  validation_errors jsonb not null default '[]'::jsonb,
  completed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (canonical_character_id, version)
);
create index character_asset_packs_canonical_idx
  on public.character_asset_packs(canonical_character_id, version desc);

create table public.character_assets (
  id uuid primary key default gen_random_uuid(),
  asset_pack_id uuid not null references public.character_asset_packs(id) on delete cascade,
  canonical_character_id uuid not null references public.canonical_characters(id) on delete cascade,
  generation_job_id uuid not null references public.generation_jobs(id) on delete cascade,
  behavior text not null,
  orientation text not null,
  media_type text not null,
  storage_bucket text not null,
  storage_path text not null unique,
  width integer not null check (width > 0),
  height integer not null check (height > 0),
  has_transparency boolean not null,
  floor_anchor jsonb not null,
  visual_bounds jsonb not null,
  sha256 text not null check (char_length(sha256) = 64),
  provider_asset_id text,
  generation_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (asset_pack_id, behavior, orientation)
);
create index character_assets_pack_idx on public.character_assets(asset_pack_id);
create index character_assets_canonical_idx on public.character_assets(canonical_character_id);
create index character_assets_job_idx on public.character_assets(generation_job_id);

create trigger pets_set_updated_at before update on public.pets
for each row execute function public.set_updated_at();
create trigger pet_source_images_set_updated_at before update on public.pet_source_images
for each row execute function public.set_updated_at();
create trigger generation_jobs_set_updated_at before update on public.generation_jobs
for each row execute function public.set_updated_at();
create trigger character_candidates_set_updated_at before update on public.character_candidates
for each row execute function public.set_updated_at();
create trigger canonical_characters_set_updated_at before update on public.canonical_characters
for each row execute function public.set_updated_at();
create trigger character_asset_packs_set_updated_at before update on public.character_asset_packs
for each row execute function public.set_updated_at();
create trigger character_assets_set_updated_at before update on public.character_assets
for each row execute function public.set_updated_at();

-- Backend-only database access for this PoC. No frontend RLS policies are added.
alter table public.pets enable row level security;
alter table public.pet_source_images enable row level security;
alter table public.generation_jobs enable row level security;
alter table public.character_candidates enable row level security;
alter table public.canonical_characters enable row level security;
alter table public.character_asset_packs enable row level security;
alter table public.character_assets enable row level security;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'staypet-assets',
  'staypet-assets',
  false,
  20971520,
  array['image/png', 'image/jpeg', 'image/webp', 'application/json']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Intentionally no storage.objects policies: only the backend service role may
-- upload, read, sign, or delete objects in the private PoC bucket.
