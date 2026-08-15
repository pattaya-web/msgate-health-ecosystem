-- Optional seed for Supabase (after 001_initial_schema.sql)
-- Prefer the in-app MockDataProvider for local demo.

insert into public.system_health_rules (key, label, description, penalty, enabled, threshold) values
  ('ibo_no_active_bank', 'IBO without active bank', 'Penalty when an IBO has no active bank account', 15, true, null),
  ('ibo_less_than_recommended_banks', 'IBO below recommended banks', 'Penalty when an IBO has fewer than recommended banks', 8, true, 2),
  ('mid_closed_no_replacement', 'MID closed without replacement', 'Penalty when a MID is closed without replacement', 15, true, null),
  ('mid_underwriting_too_long', 'MID underwriting overdue', 'Penalty when underwriting exceeds max days', 5, true, null),
  ('payout_overdue', 'Payout overdue > 5 days', 'Penalty when payout delay exceeds threshold', 8, true, null),
  ('no_backup_available', 'No backup account available', 'Penalty when no backup bank is available', 10, true, null),
  ('recovery_open_over_48h', 'Recovery open > 48h', 'Penalty when recovery remains open > 48h', 8, true, null),
  ('bank_opening_overdue', 'Bank opening overdue', 'Penalty when bank opening is delayed', 4, true, null)
on conflict (key) do nothing;
