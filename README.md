# CSAT Pulse for HDA

Sends a short CSAT survey to the requester when an **Incident** or **Request** is closed in HDA (HelpDesk Advanced). Admins choose which **owner groups**, **ticket sources** and **ticket types** get surveys. A dashboard shows the results.

- **Survey email:** ticket number, subject, description, solution, owner group and ticket owner, then a 1–5 rating. Clicking a rating opens the form: the overall question (required), three optional questions (resolution, speed, communication) and a comments box. Outlook users can optionally answer inside the email (Actionable Messages).
- **Admin settings:** switch owner groups (synced from HDA) and ticket sources on or off, set a lead email per group, and set the send rules: delay, one survey per person per N days, reminder, link expiry, low-score alert, closure codes and service accounts to skip.
- **Dashboard:** CSAT %, average score, response rate, surveys sent, low scores with a follow-up queue, and median time to respond, each compared with the previous period. Also a weekly trend against the target, score distribution, question averages, and breakdowns by source, owner group, ticket owner, ticket type, priority and category, plus the latest comments and why tickets were skipped. Filters: owner group, source, type, priority and period.
- **Survey log:** every closed ticket the service checked, with its status (or the reason it was skipped).

Only two dependencies: `pg` and `nodemailer`. Node.js 20 or later.

## How it works

```
HDA ──(every 5 min: /WSC/Projection, closed since last check)──► poller ──► rules ──► surveys table
                                                                                     │
         requester ◄── email (Graph / SMTP) ◄── sender (after delay, + reminder) ◄───┘
             │
             └─► /s/<one-time token> ──► responses table ──► dashboard, low-score alert, optional write-back to HDA
```

A survey is sent only if **all** of these are true:

- the ticket type is enabled
- the owner group is enabled
- the source is enabled
- the requester has a valid email that isn't excluded
- the closure code isn't excluded
- the requester wasn't surveyed in the last N days

Skipped tickets are stored with the reason. New owner groups and sources found in HDA are added **switched off**.

## Quick start on your PC (mock HDA, no real emails)

You need Node.js 20 or later and PostgreSQL, either installed locally or via Docker Desktop.

```powershell
cd D:\Projects\CSAT_HDA
npm install
copy .env.example .env          # then edit DATABASE_URL and ADMIN_PASSWORD
npm run migrate

# terminal 1 – fake HDA that closes a ticket every 2 minutes
npm run mock:hda

# terminal 2 – the app
npm start
```

Open http://localhost:3100/admin and sign in with `admin` and your `ADMIN_PASSWORD`.

1. Go to **Admin settings**, then click **Sync from HDA now**.
2. Switch on some owner groups and sources. Sources appear after the first ticket check, which runs about 5 seconds after start-up.
3. Emails are written to the `outbox\` folder as `.html` files. Open one, click a rating and submit.
4. Run `npm run seed:demo` to fill the dashboard with 12 weeks of sample data. Remove it again with `npm run seed:demo -- --clear`.

To try everything at once with Docker: `docker compose up --build`.

## Connecting to the real HDA

1. **Credentials.** Ask the HDA admin for an API key and an API user. In `.env`, set `HDA_BASE_URL` (the `{{BaseUrl}}` from the Postman collection), `HDA_AUTH_MODE`, `HDA_API_KEY` and `HDA_USERNAME`. Per the HDA docs, sign in once with the API user (web login or `/Authentication/LoginEx`) before using `TokenMode=apikey`.
2. **Discover the field names.**
   ```powershell
   npm run hda:discover
   ```
   This signs in, lists the properties of `Incident`, `ServiceRequest` and `UserGroup`, saves the full metadata to `discover\`, and test-runs the current mapping. It prints the latest closed tickets and flags any empty fields.
3. **Edit `config/hda-mapping.json`** so the right-hand values match your HDA:
   - `tickets.types`: the entity name for each type (`Incident`, and `ServiceRequest` or whatever HDA calls requests) and its **closed status ID(s)**. `S18C` comes from the Postman closure example. Each type can override any column.
   - `columns`: subject, description, solution, **source** (contact type / opening channel), requester email, owner group ID and name, **ticket owner** name and email, priority, category, closure code and closure date. Dotted paths read related objects, e.g. `AssignedUserGroup.Description`.
   - `groups`: the entity and fields for the owner group list.
   - `writeBack`: optionally store the score on the ticket through `/WSC/Set`. You need a custom field in HDA for this.

   Re-run `npm run hda:discover` until every field comes back filled.
4. **Dry run.** Set `MAIL_TEST_RECIPIENT=you@yourdomain` so every survey comes to you, then run `npm run poll:once`. Use `npm run poll:once -- --no-send` to only queue. Check the **Survey log** to see which tickets would be surveyed and why the others were skipped.

> List-type HDA APIs truncate text fields at 500 characters. That's enough for the email, which shortens description and solution anyway.

## Email

| `MAIL_TRANSPORT` | Setup |
|---|---|
| `graph` (recommended) | Entra ID app registration with the **application** permission `Mail.Send`. Limit it to the sender mailbox with an Exchange *Application Access Policy*. Set the `GRAPH_*` variables. |
| `smtp` | Corporate SMTP relay. Set the `SMTP_*` variables. |
| `file` | Writes `.html` and `.json` files to `outbox\`, for testing. |

**Answering inside Outlook (optional):**

1. Register an Actionable Email provider at https://outlook.office.com/connectors/oam/publish with the target URL `PUBLIC_BASE_URL`.
2. Set `MAIL_ACTIONABLE=true` and `ACTIONABLE_ORIGINATOR_ID`.
3. The app checks Microsoft's signed token on every in-Outlook submit. Other mail apps still show the normal email with rating buttons.

## Deploying

- **Host:** any Node host works, e.g. an Azure App Service (Linux, Node 20) and Azure Database for PostgreSQL. Run **one** instance with the scheduler on. Extra instances need `SCHEDULER_ENABLED=false`.
- **Survey links:** `PUBLIC_BASE_URL` must be reachable by end users. Survey pages need no login; each link has a random one-time token that expires.
- **Admin sign-in:** use `ADMIN_AUTH_MODE=easyauth` behind App Service Authentication (Entra ID) and list admins in `ADMIN_EMAILS`. Only use this mode when the app can't be reached except through App Service.
- **Secrets:** keep them in App Service settings or Key Vault, never in the repo. `.env` is git-ignored.
- **Health check:** `GET /health` returns `{ ok, polledAt }`.

## Scripts

| Command | What it does |
|---|---|
| `npm start` | Web app and scheduler |
| `npm run migrate` | Create or upgrade the database tables |
| `npm run hda:discover` | Check HDA access and list field names |
| `npm run poll:once [-- --no-send]` | One sync, ticket check and send |
| `npm run mock:hda` | Local fake HDA API on port 4010 |
| `npm run seed:demo [-- --clear]` | Add or remove dashboard demo data |
| `npm test` | Unit tests (send rules, parsing) |

## Project layout

```
config/hda-mapping.json   HDA field names (edit this for your instance)
migrations/               SQL schema
mock/                     fake HDA API for development
scripts/                  CLI helpers
src/hda/                  HDA client (auth, Projection/List/Set) and ticket mapping
src/services/             poller, rules, sender, responses, metrics, settings
src/mail/                 email templates and transports (Graph / SMTP / file)
src/web/                  router, auth, pages, CSS and dashboard script
test/                     unit tests
```
