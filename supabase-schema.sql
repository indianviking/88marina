-- 88 Marina — Supabase Schema
-- Run this entire file in the Supabase SQL Editor

-- Bookings (imported from Airbnb iCal)
create table bookings (
  id uuid primary key default gen_random_uuid(),
  airbnb_uid text unique not null,
  guest_name text,
  checkin date not null,
  checkout date not null,
  nights int generated always as (checkout - checkin) stored,
  status text default 'confirmed',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Invoices (submitted by cleaner, covering multiple cleanings)
-- Created before cleanings because cleanings.invoice_id references invoices
create table invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_number text not null,
  amount_pence int not null,
  file_url text,
  file_name text,
  status text default 'pending',
  submitted_at timestamptz default now(),
  paid_at timestamptz,
  created_at timestamptz default now()
);

-- Cleanings (one per booking, auto-created on sync)
create table cleanings (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid references bookings(id) on delete cascade,
  cleaning_date date not null,
  rate_type text default 'standard',
  rate_amount int,
  status text default 'pending',
  added_to_planner boolean default false,
  planner_added_at timestamptz,
  completed_at timestamptz,
  damage_notes text,
  checklist_data jsonb,
  cancellation_acknowledged boolean default false,
  is_new boolean default true,
  invoice_id uuid references invoices(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Checklist items (editable by owner in admin)
create table checklist_items (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  sort_order int not null default 0,
  active boolean default true,
  created_at timestamptz default now()
);

-- Settings (single row, key-value)
create table settings (
  key text primary key,
  value text not null,
  updated_at timestamptz default now()
);

-- Sync log
create table sync_log (
  id uuid primary key default gen_random_uuid(),
  synced_at timestamptz default now(),
  bookings_added int default 0,
  bookings_cancelled int default 0,
  notes text
);

-- Audit log
create table audit_log (
  id uuid primary key default gen_random_uuid(),
  action text not null,
  cleaning_id uuid references cleanings(id),
  invoice_id uuid references invoices(id),
  detail text,
  created_at timestamptz default now()
);

-- NOTE: cleanings references invoices, so we need to create invoices first
-- Supabase handles this, but if you get an error, run the invoices table first,
-- then re-run this script.

-- Seed default settings
insert into settings (key, value) values
  ('property_name', '88 Marina'),
  ('property_address', '88 Marina Drive, London'),
  ('cleaner_name', 'Maria'),
  ('cleaner_email', 'cleaner@example.com'),
  ('ical_url', ''),
  ('rate_standard', '80'),
  ('rate_weekend', '100'),
  ('rate_bank_holiday', '120'),
  ('min_notice_hours', '48'),
  ('whatsapp_template', 'Hi team, just to confirm the upcoming cleaning dates at {property}: {dates}. Please add these to your planner and confirm. Thanks!'),
  ('email_template_new', 'Hi {cleaner_name}, a new clean has been booked at {property} on {date}. Please add this to your planner and confirm. Thanks!'),
  ('email_template_cancel', 'Hi {cleaner_name}, the booking at {property} on {date} has been cancelled. No clean is needed. Please acknowledge on the dashboard.'),
  ('last_whatsapp_sent', '');

-- Seed default checklist items
insert into checklist_items (label, sort_order) values
  ('Towels — 2 sets per bedroom', 1),
  ('Bedding changed', 2),
  ('Toiletries restocked', 3),
  ('Kitchen — washing up liquid, sponge', 4),
  ('Tea, coffee, sugar topped up', 5),
  ('Bins emptied', 6),
  ('No damage found', 7);

-- RLS Policies
alter table cleanings enable row level security;
create policy "Public read cleanings" on cleanings for select using (true);
create policy "Public update cleanings" on cleanings for update using (true);

alter table invoices enable row level security;
create policy "Public read invoices" on invoices for select using (true);
create policy "Public insert invoices" on invoices for insert with check (true);
create policy "Public update invoices" on invoices for update using (true);

alter table checklist_items enable row level security;
create policy "Public read checklist" on checklist_items for select using (true);

alter table settings enable row level security;
create policy "Public read settings" on settings for select using (true);

alter table bookings enable row level security;
create policy "Public read bookings" on bookings for select using (true);

alter table sync_log enable row level security;
create policy "Public read sync_log" on sync_log for select using (true);

alter table audit_log enable row level security;
create policy "Public read audit_log" on audit_log for select using (true);

-- Storage: create the invoice-uploads bucket manually in Supabase dashboard
-- Then run this policy:
-- create policy "Allow invoice uploads"
--   on storage.objects for insert
--   with check (bucket_id = 'invoice-uploads');
