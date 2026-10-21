-- First name for the greeting, the HDA contact behind each survey, and the "Missing email" workflow:
-- a team admin can type the right address for a ticket that was skipped for having no valid email, or dismiss it.
ALTER TABLE surveys ADD COLUMN requester_first_name text;
ALTER TABLE surveys ADD COLUMN contact_id text;
ALTER TABLE surveys ADD COLUMN original_email text;       -- what HDA had, when an admin typed a replacement
ALTER TABLE surveys ADD COLUMN email_fixed_by text;
ALTER TABLE surveys ADD COLUMN email_fixed_at timestamptz;
ALTER TABLE surveys ADD COLUMN email_dismissed_by text;
ALTER TABLE surveys ADD COLUMN email_dismissed_at timestamptz;
CREATE INDEX surveys_contact_idx ON surveys(contact_id);
CREATE INDEX surveys_missing_email_idx ON surveys(created_at) WHERE skip_reason = 'No valid requester email';
