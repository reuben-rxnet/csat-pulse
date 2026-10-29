'use strict';
// Loads .env (no dependency) and exposes typed configuration.
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}
loadDotEnv(path.join(ROOT, '.env'));

const env = (k, d) => (process.env[k] !== undefined && process.env[k] !== '' ? process.env[k] : d);
const bool = (k, d) => String(env(k, d)).toLowerCase() === 'true';
const int = (k, d) => parseInt(env(k, d), 10);

function loadMapping() {
  const file = path.resolve(ROOT, env('HDA_MAPPING_FILE', 'config/hda-mapping.json'));
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

const config = {
  root: ROOT,
  port: int('PORT', 3100),
  publicBaseUrl: env('PUBLIC_BASE_URL', 'http://localhost:3100').replace(/\/$/, ''),
  databaseUrl: env('DATABASE_URL', 'postgres://csat:csat@localhost:5433/csat'),
  databaseSsl: bool('DATABASE_SSL', 'false'),

  hda: {
    baseUrl: env('HDA_BASE_URL', 'http://localhost:4010/api').replace(/\/$/, ''),
    authMode: env('HDA_AUTH_MODE', 'apikey'), // apikey | trusted | login
    apiKey: env('HDA_API_KEY', ''),
    username: env('HDA_USERNAME', ''),
    password: env('HDA_PASSWORD', ''),
    trustedUsername: env('HDA_TRUSTED_USERNAME', ''),
    trustedPassword: env('HDA_TRUSTED_PASSWORD', ''),
    sourceApplication: env('HDA_SOURCE_APPLICATION', 'CSAT-Pulse'),
    timeoutMs: int('HDA_TIMEOUT_MS', 30000),
    get mapping() { return loadMapping(); },
  },

  scheduler: {
    enabled: bool('SCHEDULER_ENABLED', 'true'),
    pollMinutes: int('POLL_INTERVAL_MINUTES', 5),
    groupSyncHours: int('GROUP_SYNC_INTERVAL_HOURS', 24),
    initialLookbackHours: int('INITIAL_LOOKBACK_HOURS', 24),
    pollOverlapMinutes: int('POLL_OVERLAP_MINUTES', 10),
  },

  mail: {
    transport: env('MAIL_TRANSPORT', 'file'), // graph | smtp | file
    from: env('MAIL_FROM', 'it-feedback@example.com'),
    fromName: env('MAIL_FROM_NAME', 'EssilorLuxottica IT'),
    replyTo: env('MAIL_REPLY_TO', ''),
    outboxDir: path.resolve(ROOT, env('MAIL_OUTBOX_DIR', 'outbox')),
    smtp: {
      host: env('SMTP_HOST', ''), port: int('SMTP_PORT', 25), secure: bool('SMTP_SECURE', 'false'),
      user: env('SMTP_USER', ''), pass: env('SMTP_PASS', ''),
    },
    graph: {
      tenantId: env('GRAPH_TENANT_ID', ''), clientId: env('GRAPH_CLIENT_ID', ''), clientSecret: env('GRAPH_CLIENT_SECRET', ''),
      senderUpn: env('GRAPH_SENDER_UPN', env('MAIL_FROM', '')),
    },
    actionable: {
      enabled: bool('MAIL_ACTIONABLE', 'false'),
      originator: env('ACTIONABLE_ORIGINATOR_ID', ''),
    },
    alertFallback: env('ALERT_FALLBACK_EMAIL', ''),
    testRecipientOverride: env('MAIL_TEST_RECIPIENT', ''), // when set, every email goes here (pilot / dry run)
  },

  // Named on the Help page and the public "About this survey" page.
  support: {
    name: env('SUPPORT_NAME', "Reuben D'Souza"),
    email: env('SUPPORT_EMAIL', 'reuben.dsouza@essilor.com'),
  },

  // Stakeholder surveys may only be sent to these company domains. "*" is a wildcard and subdomains count:
  // "essilor*" covers essilor.co.th, essilorusa.com, cn.essilor.com, ext.essilorluxottica.id …; empty = any address.
  forms: {
    recipientDomains: env('FORM_RECIPIENT_DOMAINS', 'essilor*,luxottica*,nikonlenswear.com').split(',').map(d => d.trim().toLowerCase().replace(/^@/, '')).filter(Boolean),
  },

  reports: {
    // Reports may only be emailed to these domains (and their subdomains). Empty = any address.
    recipientDomains: env('REPORT_RECIPIENT_DOMAINS', 'essilor*,luxottica*,nikonlenswear.com').split(',').map(d => d.trim().toLowerCase().replace(/^@/, '')).filter(Boolean),
    maxRecipients: int('REPORT_MAX_RECIPIENTS', 50),
  },

  // Company single sign-on (ADMIN_AUTH_MODE=oidc), e.g. Microsoft Entra ID: OIDC_ISSUER=https://login.microsoftonline.com/<tenant-id>/v2.0
  oidc: {
    issuer: env('OIDC_ISSUER', ''),
    clientId: env('OIDC_CLIENT_ID', ''),
    clientSecret: env('OIDC_CLIENT_SECRET', ''),
    redirectPath: env('OIDC_REDIRECT_PATH', '/auth/callback'),
    scopes: env('OIDC_SCOPES', 'openid profile email'),
    adminRole: env('OIDC_ADMIN_ROLE', 'CSAT.GlobalAdmin'), // app role that makes someone a global admin (as well as ADMIN_EMAILS)
    sessionSecret: env('SESSION_SECRET', ''),
    sessionHours: int('SESSION_HOURS', 8),
  },

  admin: {
    authMode: env('ADMIN_AUTH_MODE', 'basic'), // basic | oidc | easyauth
    username: env('ADMIN_USERNAME', 'admin'),
    password: env('ADMIN_PASSWORD', ''),
    allowedEmails: env('ADMIN_EMAILS', '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean),
  },

  brand: {
    company: env('BRAND_COMPANY', 'EssilorLuxottica'),
    unit: env('BRAND_UNIT', 'IT'),
    product: env('BRAND_PRODUCT', 'CSAT Pulse'),
    logoUrl: env('BRAND_LOGO_URL', ''),
  },
};

module.exports = config;
