'use strict';
// Who is signed in and which owner groups they may manage.
//  global admin: the basic-auth admin account, or an Entra user listed in ADMIN_EMAILS. All groups, global rules.
//  team admin:   any other Entra user – only the owner groups they are assigned to in HDA (Groups/Operators),
//                plus extra groups a global admin added under Admin settings → Team access.
// "View as": a global admin can browse as any HDA user to see exactly what that team admin sees (cookie csat_view_as).
const db = require('../db');
const { adminUser } = require('../web/auth');
const { fetchUserMemberships } = require('../hda/tickets');

const VIEW_AS_COOKIE = 'csat_view_as';
const CACHE_MS = 10 * 60e3; // HDA membership changes are picked up within 10 minutes
const cache = new Map();

async function hdaMemberships(login) {
  const key = login.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  const value = await fetchUserMemberships(login);
  cache.set(key, { at: Date.now(), value });
  return value;
}

async function teamAccess(login) {
  const m = await hdaMemberships(login);
  const keys = [...new Set([login, m.user?.username, m.user?.upn].filter(Boolean).map(s => s.toLowerCase()))];
  const extra = (await db.query('SELECT hda_group_id FROM group_access WHERE login = ANY($1::text[])', [keys])).rows.map(r => r.hda_group_id);
  return {
    role: 'team', login, name: m.user?.fullName || login, hdaUser: m.user,
    groups: new Set([...m.groups.map(g => g.id), ...extra]), hdaGroupCount: m.groups.length, extraGroupCount: extra.length,
  };
}

function cookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

/** @returns {Promise<null | {denied:true,name,reason} | {role:'global'|'team', name, groups?:Set, viewAs?:boolean, realName?:string}>} */
async function resolveAdmin(req) {
  const u = adminUser(req);
  if (!u) return null;
  if (u.global) {
    const viewAs = cookies(req)[VIEW_AS_COOKIE];
    if (viewAs) return { ...(await teamAccess(viewAs)), viewAs: true, realName: u.name };
    return { role: 'global', name: u.displayName || u.name, login: u.name };
  }
  const t = await teamAccess(u.name);
  if (!t.groups.size) return { denied: true, name: u.name, reason: 'is not assigned to any owner group in HDA (Groups/Operators). Ask a CSAT Pulse global admin for access.' };
  return t;
}

const isGlobal = admin => admin.role === 'global';
const canManage = (admin, groupId) => isGlobal(admin) || (!!groupId && admin.groups.has(groupId));
// SQL filter value: null = all groups (global admin), otherwise the list of group IDs the person may see.
const groupScope = admin => (isGlobal(admin) ? null : [...admin.groups]);

const viewAsCookie = login => `${VIEW_AS_COOKIE}=${encodeURIComponent(login)}; Path=/; HttpOnly; SameSite=Strict`;
const clearViewAsCookie = () => `${VIEW_AS_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;

module.exports = { resolveAdmin, teamAccess, isGlobal, canManage, groupScope, viewAsCookie, clearViewAsCookie };
