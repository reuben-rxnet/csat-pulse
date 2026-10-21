-- Ticket sources are now synced from HDA (entity TicketSource), not only learned from tickets.
-- Sources stay keyed by their description (that is what tickets carry); hda_source_id is HDA's own ID.
ALTER TABLE ticket_sources ADD COLUMN hda_source_id text;
ALTER TABLE ticket_sources ADD COLUMN active_in_hda boolean NOT NULL DEFAULT true;
ALTER TABLE ticket_sources ADD COLUMN synced_at timestamptz;
