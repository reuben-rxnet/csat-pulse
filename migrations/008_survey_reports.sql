-- Stakeholder survey results through Reports: which survey a report run was about, and the last
-- "email the results when the survey closes" send per survey (opt-in in forms.settings.reportOnClose).
ALTER TABLE report_runs ADD COLUMN form_id int REFERENCES forms(id) ON DELETE SET NULL;
ALTER TABLE report_runs ADD COLUMN title text;
ALTER TABLE forms ADD COLUMN report_sent_at timestamptz;
ALTER TABLE forms ADD COLUMN report_error text;
