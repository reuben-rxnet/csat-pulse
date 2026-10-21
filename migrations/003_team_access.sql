-- Team admins: per-group send rules/sources, and extra group access granted by a global admin.
-- Group membership itself comes live from HDA (UserGroupAssignment), so it is not stored here.

-- Per owner group overrides. rules: any of ticketTypes, sendDelayMinutes, throttleDays, reminderDays, expiryDays,
-- alertThreshold (missing key = use the global default). sources: NULL = use the global source switches.
CREATE TABLE group_settings (
  hda_group_id  text PRIMARY KEY,
  rules         jsonb NOT NULL DEFAULT '{}'::jsonb,
  sources       text[],
  updated_by    text,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Extra groups for a person who isn't in the group in HDA (e.g. a team lead). login = HDA username or email, lower case.
CREATE TABLE group_access (
  login         text NOT NULL,
  hda_group_id  text NOT NULL,
  added_by      text,
  added_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (login, hda_group_id)
);

-- Tickets whose Source field is empty in HDA are filed under this source, so they can be switched on.
INSERT INTO ticket_sources(source) VALUES ('(No source)') ON CONFLICT DO NOTHING;
