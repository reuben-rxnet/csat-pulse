-- Test surveys sent from Admin → Test survey. Their links work like real ones, but they are kept out of
-- the dashboard, the per-requester throttle and the "already surveyed" check, so a test never blocks a real survey.
ALTER TABLE surveys ADD COLUMN is_test boolean NOT NULL DEFAULT false;
DROP INDEX surveys_ticket_uq;
CREATE UNIQUE INDEX surveys_ticket_uq ON surveys(entity, ticket_id) WHERE NOT is_test;
