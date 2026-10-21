-- Owner groups synced from HDA. Admin decides which ones get surveys.
CREATE TABLE owner_groups (
  hda_group_id   text PRIMARY KEY,
  name           text NOT NULL,
  csat_enabled   boolean NOT NULL DEFAULT false,
  lead_email     text,
  active_in_hda  boolean NOT NULL DEFAULT true,
  synced_at      timestamptz NOT NULL DEFAULT now(),
  updated_by     text,
  updated_at     timestamptz
);

-- Ticket sources (HDA contact type / opening channel). New values are added as they are seen, disabled by default.
CREATE TABLE ticket_sources (
  source        text PRIMARY KEY,
  csat_enabled  boolean NOT NULL DEFAULT false,
  first_seen    timestamptz NOT NULL DEFAULT now(),
  updated_by    text,
  updated_at    timestamptz
);

CREATE TABLE settings (
  key    text PRIMARY KEY,
  value  jsonb NOT NULL
);

CREATE TABLE poll_state (
  key    text PRIMARY KEY,
  value  text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- One row per closed ticket evaluated. Skipped tickets are kept with a reason so admins can answer
-- "why didn't this user get a survey?".
CREATE TABLE surveys (
  id                bigserial PRIMARY KEY,
  ticket_id         text NOT NULL,
  ticket_number     text,
  entity            text NOT NULL DEFAULT 'Incident',
  subject           text,
  description       text,
  solution          text,
  source            text,
  requester_email   text,
  requester_name    text,
  owner_group_id    text,
  owner_group_name  text,
  ticket_owner      text,
  ticket_owner_email text,
  ticket_type       text,   -- Incident / Request (label from the mapping file)
  priority          text,
  category          text,
  closed_at         timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  send_after        timestamptz,
  sent_at           timestamptz,
  reminder_sent_at  timestamptz,
  expires_at        timestamptz,
  token_hash        text UNIQUE,
  status            text NOT NULL CHECK (status IN ('pending','sent','answered','expired','skipped','failed')),
  skip_reason       text,
  send_error        text,
  attempts          integer NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX surveys_ticket_uq ON surveys(entity, ticket_id);
CREATE INDEX surveys_status_idx ON surveys(status, send_after);
CREATE INDEX surveys_requester_idx ON surveys(lower(requester_email), created_at);
CREATE INDEX surveys_closed_idx ON surveys(closed_at);

CREATE TABLE responses (
  survey_id        bigint PRIMARY KEY REFERENCES surveys(id) ON DELETE CASCADE,
  overall          smallint NOT NULL CHECK (overall BETWEEN 1 AND 5),
  resolution       smallint CHECK (resolution BETWEEN 1 AND 5),
  speed            smallint CHECK (speed BETWEEN 1 AND 5),
  communication    smallint CHECK (communication BETWEEN 1 AND 5),
  comment          text,
  channel          text NOT NULL DEFAULT 'web',
  submitted_at     timestamptz NOT NULL DEFAULT now(),
  followup_status  text CHECK (followup_status IN ('open','contacted','resolved')),
  followup_owner   text,
  followup_note    text,
  followup_at      timestamptz
);
CREATE INDEX responses_submitted_idx ON responses(submitted_at);

CREATE TABLE audit_log (
  id      bigserial PRIMARY KEY,
  at      timestamptz NOT NULL DEFAULT now(),
  actor   text,
  action  text NOT NULL,
  detail  jsonb
);
