# CSAT Pulse for HDA – project notes for Claude Code

## What this is
Node.js (>=20) + PostgreSQL app that emails a CSAT survey when an HDA (HelpDesk Advanced, EssilorLuxottica's ITSM)
**Incident or Request** is closed, for **owner groups, ticket sources and ticket types an admin switches on**.
Results go to a KPI dashboard. Branding: EssilorLuxottica IT, navy header, "CSAT Pulse".
Dependencies are only `pg` and `nodemailer`; the web layer is plain `node:http` (src/web/http.js), no framework.

## Agreed requirements (from the product owner, Reuben D'Souza)
- Survey email and survey page show (Reuben, 2026-10-16): **Ticket ID, Date (closed), Subject, Solution, Ticket owner**;
  then the 1–5 rating (required) and a comments box. No description, no owner group, no extra questions – keep it this way.
  (The low-score alert to the group lead still shows description and owner group.)
- HDA can return ProblemHTML/SolutionHTML HTML-encoded twice; stripHtml in src/hda/tickets.js handles it.
- Admin settings: toggles for owner groups (synced from HDA), ticket sources, ticket types (Incident, Request);
  send rules (delay, throttle per requester, reminder, expiry, low-score alert, excluded closure codes / service accounts).
- Roles (built 2026-10-21, src/services/access.js): **global admin** = basic-auth `admin` or Entra user in ADMIN_EMAILS;
  everyone else signing in via Entra is a **team admin** who sees/changes only the owner groups they're assigned to in
  HDA (UserGroupAssignment, cached 10 min) plus extras a global admin grants (table group_access). Team admins can set
  per-group sources, ticket types and timing (table group_settings, merged over global defaults by effectiveSettings);
  master switch, exclusions and CSAT target stay global. Until Entra is registered, global admins use "View as".
- Ticket sources are synced from HDA entity TicketSource (mapping "sources"; ID, Description, Active) together with the
  owner groups (daily + "Sync from HDA now"); new ones arrive switched off, inactive ones are tagged "Not active in HDA".
  QA has 25 sources (15 active). Migration 006 adds hda_source_id / active_in_hda.
- Blank HDA Source → stored as "(No source)" (NO_SOURCE in src/hda/tickets.js), switchable like any source.
- Greeting uses the first name (src/names.js): Contact.CONFNAME, else a first.last email word that is part of the
  name (never the capitalised surname that HDA puts first in Contact.LastName, e.g. "DSOUZA REUBEN"), else "Hello,".
- Missing emails page (built 2026-10-21, src/services/missing.js): surveys skipped with NO_EMAIL_REASON; a team admin
  types an address and sends (that survey only; original kept in original_email) or dismisses. "Contacts to fix" groups
  them by HDA ContactID, with a CSV download for the HDA team. Scoped to the person's owner groups.
- Settings UI (built 2026-10-21): tabs via ?tab= (global: groups, sources, rules, access, history; team: groups,
  history). Plain-language summaries from src/services/summary.js (pure, tested). Change history = audit_log in words
  (src/services/history.js); team admins see entries whose detail.id/detail.group or linked survey is one of their
  groups – so new audit() calls about a group must include `id` or `group`. "Skip tickets owned by" =
  settings.excludeOwnerPatterns (global, e.g. "Eye-T ServiceDesk AI"). Closure-code box hidden while closeCode is unmapped.
  Global "Enable all" removed on purpose (only "Switch all off"); switching a group on asks for confirmation.
- Rule (Reuben, 2026-10-21): no owner group is ever switched on automatically. Only a global or team admin switching
  it on, one at a time, on the website. Sync/poller insert groups switched off and never change csat_enabled; the bulk
  API only switches off; seed-demo inserts its groups switched off and refuses to run unless HDA is the mock.
- PDF reports (built 2026-10-21, Admin → Reports): ad hoc (dates chosen → Download PDF or email now) and scheduled
  (weekly / monthly / quarterly, previous complete period, retried 3× 30 min apart on failure). Recipients are typed
  by the admin; sent direct (MAIL_TEST_RECIPIENT doesn't apply) but only to REPORT_RECIPIENT_DOMAINS. Standard report =
  no agent names; "Custom report" lets you pick sections incl. ticket owners (Reuben's choice). Team admins: own groups
  and own schedules only. PDF is drawn by src/report/pdf.js (no dependency, Helvetica/WinAnsi); layout in
  src/report/layout.js uses getMetrics, so numbers match the dashboard. Pure helpers in src/report/schedule.js (tested).
- Help (built 2026-10-21): /admin/help ("? Help" in the menu opens the section for the current page via layout's `help`
  anchor) and the public /about-survey page, linked from every survey email and survey page. All text is in
  src/web/help.js and uses live settings. **When a feature or button label changes, update help.js and add a line
  to WHATS_NEW.** Contact = SUPPORT_NAME / SUPPORT_EMAIL (default Reuben D'Souza). Global-only tasks are hidden from team admins.
- Design (refreshed 2026-10-21): tokens at the top of src/web/public/app.css (light + dark), navy gradient header,
  rise/fade animations that respect prefers-reduced-motion. Asset URLs carry ?v=<start time> so browsers reload CSS/JS
  after a restart. Dashboard (dashboard.js, no chart library): gauge, KPI sparklines, interactive trend (CSAT/avg/volume),
  donut, auto insights, group leaderboard, breakdown tabs, follow-up queue with inline status; filters kept in the URL.
  Help link uses /admin/help?for=<guide id> (suggestion card, page stays at the top).
  For design checks there is a separate demo database `csat_demo` (seeded with seed-demo, mock HDA) – never seed the real one.
- Dashboard KPIs: CSAT % (4–5 / responses), avg score, response rate, surveys sent, low scores (1–2) + follow-up queue,
  median time to respond; breakdowns by source, owner group, ticket owner, type, priority, category; skipped reasons.
- Company sign-in (built 2026-10-22, src/web/oidc.js): ADMIN_AUTH_MODE=oidc = OpenID Connect auth-code flow + PKCE,
  handled by the app (no deps): discovery + JWKS cached, ID token RS256/iss/aud/exp/nonce checked, session = HMAC-signed
  cookie csat_session (SESSION_SECRET, SESSION_HOURS). login = preferred_username/upn/email → ADMIN_EMAILS or app role
  OIDC_ADMIN_ROLE (CSAT.GlobalAdmin) = global admin, else team admin via HDA. Routes /auth/login, /auth/callback,
  /auth/logout, /auth/signed-out. Fake provider for testing: npm run mock:oidc (:4020). Tests: test/oidc.test.js.
- Email via Microsoft Graph or SMTP (MAIL_TRANSPORT=graph|smtp|file). Optional Outlook Actionable Messages.

## Layout
- config/hda-mapping.json – HDA entity/field names (edit here, not in code). `tickets.types` lists Incident + ServiceRequest.
- src/hda/client.js – HDA REST client (/Authentication/LoginEx|Token, /WSC/Projection, /WSC/List, /WSC/Set, /WSC/GetMetabase)
- src/hda/tickets.js – closed-ticket + group fetch and normalisation
- src/services/ – poller, rules (pure, unit-tested), sender, responses, metrics, settings
- src/mail/ – templates + transports; src/web/ – routes (src/server.js), views, auth, public assets
- mock/hda-mock-server.js – fake HDA on :4010 (LoginEx password `mock-password`, ApiKey `mock-api-key`)
- scripts/hda-discover.js – `npm run hda:discover` signs in to HDA and prints real field names

## HDA facts learned from the HDAConnect repo (D:\Projects\HDAConnect, .NET 8, read-only reference)
- QA base URL: https://helpdeskquality.luxottica.com/HDAPortal
- Sign-in: POST {base}/Authentication/LoginEx with JSON {username, password} → requestToken (use HDA_AUTH_MODE=login)
- Incident fields: Subject, ProblemHTML (description), ContactID, OwnerUserGroupID, TicketStatusID, TicketPriorityID,
  ServiceID, AccountID, LocationID, ObjectTypeID (T10C). Contact has EMail. Group IDs look like G815L. Status S3C = new.
- Filters there use op "is" / "equals"; Postman shows "eq". Configurable via tickets.statusFilterOperator.
- Verified against QA on 2026-10-16 (details in `_fromQA` in config/hda-mapping.json): Incidents and Requests are both
  entity `Incident`, split by ObjectTypeID (Request = 1, T12L, T16L, T29L). Surveys trigger on S5 Closed (ClosureDate set);
  S18C is Solved and has no ClosureDate. Changed 2026-10-21 (Reuben): surveys go out on **Solved** – the poller watches
  S18C + S5 and uses custom field C70C ("solved at", kept when HDA auto-closes ~5 days later). Number = ID, source = TicketSource.Description, owner = AssignedUser.FullName,
  requester name = Contact.LastName, category = Service.Description. No closure-code field found (closeCode null).
- LoginEx returns code 99 "Unknown Error" unless an Accept-Language header is sent (Node fetch defaults to `*`).
  src/hda/client.js sends en-US. Login works with the AD username (e.g. reuben.dsouza), not email or DOMAIN\user.
- Group membership (HDA Groups/Operators page): entity `UserGroupAssignment` (UserID → User, UserGroupID → UserGroup);
  ~16k rows, many users in several groups. Filter by `User.Username` or `UserID`; `User.USERUPN` maps to the Entra UPN.
  UserGroup also has `TeamManagerUserID` and `EMail` (group mailbox). User.PLUS04 holds only one group – don't use it.
- Sign-in token (LoginEx): JWT valid 60 min, expiresIn 3300 s; the client reuses it until 1 min before that, then signs
  in again (refresh token needs an API key, so login mode re-logs in ~26×/day). If HDA rejects the credentials the client
  sets authBlocked and makes no further attempts (AD lockout protection) until "Try again" (/admin/hda/retry) or a
  restart; network errors / the off-VPN 404 don't block. Tested in test/hda-auth.test.js.
- Only reachable on the corporate network/VPN (internal DNS → 10.9.x.x); off VPN the host returns IIS 404s.
- HDAConnect only CREATES incidents; it has no read endpoints. Option for later: add GET closed-tickets and
  GET owner-groups endpoints to HDAConnect and point CSAT Pulse at it.

## Rules
- Never put real credentials in committed files. Secrets live in `.env` (git-ignored); `.env.example` has placeholders.
  HDAConnect uses `dotnet user-secrets` for HDA:Username / HDA:Password; appsettings.json keeps the `*********` placeholder.
- Don't push HDAConnect to the original Azure DevOps repo (its push URL is disabled on purpose; remote is `upstream`).
- Run `npm test` after changing src/services/rules.js or src/hda/tickets.js.
- Use MAIL_TEST_RECIPIENT for any run against real HDA until the pilot is approved.

## Next steps
1. Done 2026-10-16: discovery against QA, mapping fixed. Still to do: get a dedicated HDA API user (currently a personal login).
2. Dry run with MAIL_TEST_RECIPIENT and `npm run poll:once -- --no-send`; check the Survey log page.
3. Choose sender mailbox + Graph app registration; choose hosting (Azure App Service + Azure PostgreSQL suggested).
