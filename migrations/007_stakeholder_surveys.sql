-- Stakeholder surveys ("forms"): an admin builds a survey, sends a personal link to each internal stakeholder,
-- and sees every named response. Separate from the ticket CSAT surveys (table surveys).
CREATE TABLE forms (
  id            serial PRIMARY KEY,
  title         text NOT NULL,
  description   text NOT NULL DEFAULT '',
  cover_image   text,                          -- data: URL (PNG/JPEG/WebP, max ~1.5 MB), shown above the questions
  questions     jsonb NOT NULL DEFAULT '[]',   -- see src/forms/model.js (sections, likert grids, choice, text, NPS)
  settings      jsonb NOT NULL DEFAULT '{}',   -- thankYou, allowEdit, reminderDays, maxReminders, invite subject/message
  status        text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'open', 'closed')),
  closes_at     timestamptz,                   -- closes by itself at this time (optional)
  opened_at     timestamptz,
  closed_at     timestamptz,
  owner_login   text NOT NULL,                 -- creator (global: admin name, team: HDA login); team admins see their own
  owner_role    text NOT NULL,
  copied_from   int REFERENCES forms(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    text,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- One row per invited person. token = their personal link (/f/<token>); one response each.
CREATE TABLE form_recipients (
  id               serial PRIMARY KEY,
  form_id          int NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
  email            text NOT NULL,
  name             text,
  first_name       text,
  token            text NOT NULL UNIQUE,
  invite_status    text NOT NULL DEFAULT 'pending' CHECK (invite_status IN ('pending', 'sent', 'failed')),
  invited_at       timestamptz,
  send_error       text,
  reminders_sent   int NOT NULL DEFAULT 0,
  last_reminded_at timestamptz,
  opened_at        timestamptz,                -- first time the link was opened
  is_test          boolean NOT NULL DEFAULT false, -- "Send a test to me": works before opening, left out of all results
  added_by         text,
  added_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (form_id, email, is_test)
);
CREATE INDEX form_recipients_form_idx ON form_recipients(form_id);

-- Answers are saved as the person goes (submitted_at NULL = in progress) and kept by question id.
CREATE TABLE form_responses (
  id             serial PRIMARY KEY,
  form_id        int NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
  recipient_id   int NOT NULL UNIQUE REFERENCES form_recipients(id) ON DELETE CASCADE,
  answers        jsonb NOT NULL DEFAULT '{}',
  started_at     timestamptz NOT NULL DEFAULT now(),
  submitted_at   timestamptz,
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX form_responses_form_idx ON form_responses(form_id) WHERE submitted_at IS NOT NULL;
