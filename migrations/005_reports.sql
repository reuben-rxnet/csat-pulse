-- PDF reports: scheduled reports to stakeholders, and a log of every report sent or downloaded.
-- groups NULL = all owner groups (global admins only; a team admin's reports always list their groups).
-- sections: which parts of the report to include (see SECTIONS in src/services/reports.js); "agents" = ticket owner names.
CREATE TABLE scheduled_reports (
  id            serial PRIMARY KEY,
  name          text NOT NULL,
  recipients    text[] NOT NULL,
  frequency     text NOT NULL CHECK (frequency IN ('weekly', 'monthly', 'quarterly')),
  run_day       int NOT NULL DEFAULT 1,       -- weekly: 1 = Monday … 7 = Sunday; monthly/quarterly: day of the month (1–28)
  send_hour     int NOT NULL DEFAULT 7 CHECK (send_hour BETWEEN 0 AND 23),
  groups        text[],
  sections      text[] NOT NULL,
  enabled       boolean NOT NULL DEFAULT true,
  owner_login   text NOT NULL,                -- who created it (global: admin name, team: HDA login)
  owner_role    text NOT NULL,
  next_run_at   timestamptz,
  retry_anchor  timestamptz,                  -- set while retrying a failed send, so the retry covers the same period
  attempts      int NOT NULL DEFAULT 0,
  last_run_at   timestamptz,
  last_status   text,
  last_error    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    text,
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX scheduled_reports_due_idx ON scheduled_reports(next_run_at) WHERE enabled;

CREATE TABLE report_runs (
  id            serial PRIMARY KEY,
  schedule_id   int REFERENCES scheduled_reports(id) ON DELETE SET NULL,
  kind          text NOT NULL,                -- download | send | scheduled
  actor         text NOT NULL,
  owner_login   text,
  recipients    text[],
  period_from   timestamptz NOT NULL,
  period_to     timestamptz NOT NULL,
  groups        text[],
  sections      text[],
  status        text NOT NULL,                -- ok | failed
  error         text,
  at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX report_runs_at_idx ON report_runs(at DESC);
