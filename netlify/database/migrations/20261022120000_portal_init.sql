-- FCV Client & Lender Portal: initial schema
-- Money is stored as integer cents (exact). Dates are plain DATEs. Nothing here is secret.

CREATE TABLE portal_users (
  email         text PRIMARY KEY CHECK (email = lower(email)),
  role          text NOT NULL DEFAULT 'member' CHECK (role IN ('admin','member')),
  status        text NOT NULL DEFAULT 'invited' CHECK (status IN ('invited','active','disabled')),
  display_name  text NOT NULL DEFAULT '',
  identity_id   text,
  invited_by    text,
  invited_at    timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE projects (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                text NOT NULL UNIQUE CHECK (length(code) BETWEEN 3 AND 40),
  title               text NOT NULL,
  client_name         text NOT NULL,
  address             text NOT NULL DEFAULT '',
  contractor          text NOT NULL DEFAULT 'FCV Restoration & Construction',
  phase_label         text NOT NULL DEFAULT '',
  lender_status       text NOT NULL DEFAULT 'Preliminary / not lender-approved',
  estimate_source     text NOT NULL DEFAULT '',
  stage               text NOT NULL DEFAULT 'new'
                      CHECK (stage IN ('new','contacted','site_visit','quote_sent','accepted','work_in_progress','completed','declined')),
  tracker_visible     boolean NOT NULL DEFAULT false,
  base_estimate_cents bigint CHECK (base_estimate_cents >= 0),
  work_start_date     date,
  client_message      text NOT NULL DEFAULT '',
  notes               jsonb NOT NULL DEFAULT '[]'::jsonb,
  request_ref         text,
  request_snapshot    jsonb,
  created_by          text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX projects_request_ref_uq ON projects (request_ref) WHERE request_ref IS NOT NULL;

-- A member only ever sees projects listed here. Assignment is explicit and admin-only.
CREATE TABLE project_members (
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  email      text NOT NULL CHECK (email = lower(email)),
  added_by   text,
  added_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, email)
);
CREATE INDEX project_members_email_idx ON project_members (email);

-- Phase 1 Budget  (extended amount = quantity x unit price x (1 + waste%), computed by the database)
CREATE TABLE budget_lines (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  code             text NOT NULL DEFAULT '',
  category         text NOT NULL,
  quantity         numeric(14,3) NOT NULL CHECK (quantity >= 0),
  unit             text NOT NULL DEFAULT '',
  unit_price_cents bigint NOT NULL CHECK (unit_price_cents >= 0),
  waste_percent    numeric(6,2) NOT NULL DEFAULT 0 CHECK (waste_percent BETWEEN 0 AND 100),
  basis            text NOT NULL DEFAULT '',
  sort_order       integer NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX budget_lines_project_idx ON budget_lines (project_id, sort_order);

-- Expense Log: only entries actually recorded by the admin
CREATE TABLE expenses (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  expense_ref     text NOT NULL,
  purchased_on    date NOT NULL,
  vendor          text NOT NULL,
  budget_category text NOT NULL DEFAULT '',
  description     text NOT NULL,
  receipt_ref     text NOT NULL DEFAULT '',
  amount_cents    bigint NOT NULL CHECK (amount_cents > 0),
  notes           text NOT NULL DEFAULT '',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, expense_ref)
);

-- Supplements & Change Orders: only status = Approved changes the budget
CREATE TABLE supplements (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  supplement_ref    text NOT NULL,
  requested_on      date,
  scope             text NOT NULL,
  vendor_trade      text NOT NULL DEFAULT '',
  support_ref       text NOT NULL DEFAULT '',
  amount_cents      bigint NOT NULL CHECK (amount_cents >= 0),
  status            text NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft','Submitted','Approved','Rejected','Withdrawn')),
  approved_on       date,
  approval_evidence text NOT NULL DEFAULT '',
  notes             text NOT NULL DEFAULT '',
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, supplement_ref),
  CONSTRAINT supplements_approval_needs_evidence
    CHECK (status <> 'Approved' OR length(btrim(approval_evidence)) > 0)
);

-- Draw Requests: requested, approved and disbursed are separate facts
CREATE TABLE draws (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id             uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  draw_ref               text NOT NULL,
  requested_on           date,
  purpose                text NOT NULL,
  amount_requested_cents bigint NOT NULL CHECK (amount_requested_cents >= 0),
  amount_approved_cents  bigint CHECK (amount_approved_cents >= 0),
  amount_disbursed_cents bigint CHECK (amount_disbursed_cents >= 0),
  status                 text NOT NULL DEFAULT 'Proposed - not submitted'
                         CHECK (status IN ('Proposed - not submitted','Submitted','Approved','Partially funded','Funded','Rejected')),
  notes                  text NOT NULL DEFAULT '',
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, draw_ref),
  CONSTRAINT draws_amount_rules CHECK (
       (status IN ('Proposed - not submitted','Submitted','Rejected') AND amount_approved_cents IS NULL AND amount_disbursed_cents IS NULL)
    OR (status = 'Approved' AND amount_approved_cents IS NOT NULL AND amount_disbursed_cents IS NULL)
    OR (status IN ('Partially funded','Funded') AND amount_approved_cents IS NOT NULL
        AND amount_disbursed_cents IS NOT NULL AND amount_disbursed_cents <= amount_approved_cents)
  )
);

-- Contract Overview: breakdown of the remaining base amount by trade
CREATE TABLE remaining_items (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  category     text NOT NULL,
  amount_cents bigint NOT NULL CHECK (amount_cents >= 0),
  note         text NOT NULL DEFAULT '',
  sort_order   integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- Receipts and supporting documents. File bytes live in private Netlify Blobs, never in the database.
CREATE TABLE documents (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind         text NOT NULL CHECK (kind IN ('receipt','supporting','contract','other')),
  title        text NOT NULL,
  file_name    text NOT NULL,
  content_type text NOT NULL,
  size_bytes   integer NOT NULL CHECK (size_bytes > 0),
  sha256       text NOT NULL,
  blob_key     text NOT NULL UNIQUE,
  linked_type  text CHECK (linked_type IN ('expense','supplement','draw')),
  linked_id    uuid,
  uploaded_by  text NOT NULL,
  uploaded_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT documents_link_pair CHECK ((linked_type IS NULL) = (linked_id IS NULL))
);
CREATE INDEX documents_project_idx ON documents (project_id);

-- Audit history. Append-only: the triggers below refuse every UPDATE, DELETE and TRUNCATE.
CREATE TABLE audit_log (
  id          bigserial PRIMARY KEY,
  at          timestamptz NOT NULL DEFAULT now(),
  actor_email text NOT NULL,
  actor_role  text NOT NULL,
  action      text NOT NULL,
  entity_type text NOT NULL DEFAULT '',
  entity_id   text NOT NULL DEFAULT '',
  project_id  uuid,
  summary     text NOT NULL DEFAULT '',
  before      jsonb,
  after       jsonb,
  ip          text NOT NULL DEFAULT ''
);
CREATE INDEX audit_log_project_idx ON audit_log (project_id, id DESC);
CREATE INDEX audit_log_at_idx ON audit_log (id DESC);

CREATE FUNCTION audit_log_is_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log FOR EACH ROW EXECUTE FUNCTION audit_log_is_append_only();
CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log FOR EACH ROW EXECUTE FUNCTION audit_log_is_append_only();
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON audit_log FOR EACH STATEMENT EXECUTE FUNCTION audit_log_is_append_only();
