/**
 * ============================================================
 *  SUIVI DES VISITES MÉDICALES — Cloudflare Workers + D1
 *  Version 100% offre gratuite Cloudflare (remplace Streamlit + MongoDB)
 *
 *  - Sert l'application (SPA) et l'API depuis un seul Worker
 *  - Stocke l'état (plannings, liste collaborateurs, suivi RTA) dans D1
 *  - Authentification 2 rôles : admin / consultation (comptes en base)
 *
 *  Binding requis : D1 nommé `DB` (voir README, section Déploiement)
 * ============================================================
 */

const CHUNK_SIZE = 700000;        // morceaux < 1 Mo (limite de liaison D1)
const SESSION_DAYS = 30;          // durée d'une session (jours)
const PBKDF2_ITERATIONS = 25000;  // hachage du mot de passe
const COOKIE_NAME = 'vm_session';

/* ---------- HTML embarqué (généré par build.py) ---------- */
const INDEX_HTML = /*__INDEX_HTML__*/'<!DOCTYPE html><html><body>Build manquant : lancez build.py</body></html>';

/* ============================================================
 *  Utilitaires cryptographiques
 * ============================================================ */
function b64(bytes) {
  let s = '';
  const arr = new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
  return btoa(s);
}
function ub64(s) {
  const bin = atob(s);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a[i] ^ b[i];
  return r === 0;
}
async function hashPassword(password, saltBytes) {
  saltBytes = saltBytes || crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: saltBytes, iterations: PBKDF2_ITERATIONS },
    key, 256
  );
  return `pbkdf2$${PBKDF2_ITERATIONS}$${b64(saltBytes)}$${b64(new Uint8Array(bits))}`;
}
async function verifyPassword(password, stored) {
  try {
    const parts = String(stored).split('$');
    if (parts[0] !== 'pbkdf2') return false;
    const iterations = parseInt(parts[1], 10);
    const salt = ub64(parts[2]);
    const expected = ub64(parts[3]);
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
      key, 256
    );
    return timingSafeEqual(new Uint8Array(bits), expected);
  } catch (e) {
    return false;
  }
}

/* ============================================================
 *  Schéma D1 (créé automatiquement au premier appel)
 * ============================================================ */
let schemaReady = null;

async function ensureSchema(env) {
  if (!schemaReady) {
    schemaReady = (async () => {
      await env.DB.batch([
        env.DB.prepare(`CREATE TABLE IF NOT EXISTS users (
          username TEXT PRIMARY KEY,
          pw_hash  TEXT NOT NULL,
          role     TEXT NOT NULL DEFAULT 'consultation',
          created_at TEXT DEFAULT (datetime('now'))
        )`),
        env.DB.prepare(`CREATE TABLE IF NOT EXISTS sessions (
          token      TEXT PRIMARY KEY,
          username   TEXT NOT NULL,
          role       TEXT NOT NULL,
          expires_at INTEGER NOT NULL
        )`),
        env.DB.prepare(`CREATE TABLE IF NOT EXISTS state (
          key   TEXT NOT NULL,
          chunk INTEGER NOT NULL,
          data  TEXT,
          PRIMARY KEY (key, chunk)
        )`)
      ]);
      // Comptes par défaut (à modifier dans l'onglet Paramètres !)
      const cnt = await env.DB.prepare(`SELECT COUNT(*) AS c FROM users`).first();
      if (!cnt || cnt.c === 0) {
        await env.DB.batch([
          env.DB.prepare(`INSERT INTO users (username, pw_hash, role) VALUES (?,?,?)`)
            .bind('seravo', await hashPassword('ton_mot_de_passe_admin'), 'admin'),
          env.DB.prepare(`INSERT INTO users (username, pw_hash, role) VALUES (?,?,?)`)
            .bind('concentrix', await hashPassword('mot_de_passe_consultation'), 'consultation')
        ]);
      }
    })().catch((e) => { schemaReady = null; throw e; });
  }
  return schemaReady;
}

/* ============================================================
 *  Sessions / authentification
 * ============================================================ */
function getCookie(request, name) {
  const header = request.headers.get('Cookie') || '';
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return null;
}

async function getAuth(request, env) {
  let token = getCookie(request, COOKIE_NAME);
  const authHeader = request.headers.get('Authorization') || '';
  if (!token && authHeader.startsWith('Bearer ')) token = authHeader.slice(7);
  if (!token) return null;
  const row = await env.DB.prepare(`SELECT username, role, expires_at FROM sessions WHERE token = ?`)
    .bind(token).first();
  if (!row) return null;
  if (row.expires_at < Date.now()) {
    await env.DB.prepare(`DELETE FROM sessions WHERE token = ?`).bind(token).run();
    return null;
  }
  return { username: row.username, role: row.role, token };
}

function sessionCookie(token, maxAge) {
  return `${COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

/* ============================================================
 *  Stockage d'état par morceaux (D1)
 * ============================================================ */
async function stateGet(env, key) {
  const res = await env.DB.prepare(`SELECT data FROM state WHERE key = ? ORDER BY chunk`).bind(key).all();
  if (!res.results || res.results.length === 0) return null;
  return res.results.map((r) => r.data || '').join('');
}

async function statePut(env, key, value) {
  const chunks = [];
  for (let i = 0; i < value.length; i += CHUNK_SIZE) chunks.push(value.slice(i, i + CHUNK_SIZE));
  const stmts = [env.DB.prepare(`DELETE FROM state WHERE key = ?`).bind(key)];
  for (let i = 0; i < chunks.length; i++) {
    stmts.push(env.DB.prepare(`INSERT INTO state (key, chunk, data) VALUES (?,?,?)`).bind(key, i, chunks[i]));
  }
  await env.DB.batch(stmts);
}

async function stateDelete(env, key) {
  await env.DB.prepare(`DELETE FROM state WHERE key = ?`).bind(key).run();
}

/* ============================================================
 *  Réponses JSON
 * ============================================================ */
function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extraHeaders }
  });
}
function jsonRaw(text, status = 200) {
  return new Response(text, {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

/* ============================================================
 *  API
 * ============================================================ */
async function handleApi(request, env, url) {
  const path = url.pathname;
  const method = request.method;

  // ---------- public : connexion ----------
  if (path === '/api/login' && method === 'POST') {
    let body;
    try { body = await request.json(); } catch (e) { return json({ error: 'Requête invalide' }, 400); }
    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    if (!username || !password) return json({ error: 'Nom d\u2019utilisateur et mot de passe requis' }, 400);
    const row = await env.DB.prepare(`SELECT username, pw_hash, role FROM users WHERE username = ?`).bind(username).first();
    if (!row || !(await verifyPassword(password, row.pw_hash))) {
      return json({ error: 'Utilisateur ou mot de passe inconnu' }, 401);
    }
    const token = crypto.randomUUID() + crypto.randomUUID().replace(/-/g, '');
    const now = Date.now();
    const expires = now + SESSION_DAYS * 86400000;
    await env.DB.prepare(`INSERT INTO sessions (token, username, role, expires_at) VALUES (?,?,?,?)`)
      .bind(token, row.username, row.role, expires).run();
    await env.DB.prepare(`DELETE FROM sessions WHERE expires_at < ?`).bind(now).run();
    return json({ token, username: row.username, role: row.role }, 200, {
      'Set-Cookie': sessionCookie(token, SESSION_DAYS * 86400)
    });
  }

  // ---------- authentifié ----------
  const auth = await getAuth(request, env);

  if (path === '/api/logout' && method === 'POST') {
    if (auth) await env.DB.prepare(`DELETE FROM sessions WHERE token = ?`).bind(auth.token).run();
    return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie('', 0) });
  }

  if (!auth) return json({ error: 'Non authentifié' }, 401);
  const isAdmin = auth.role === 'admin';

  if (path === '/api/me' && method === 'GET') {
    return json({ username: auth.username, role: auth.role });
  }

  // ---------- gestion des utilisateurs (admin) ----------
  if (path === '/api/users' && method === 'GET') {
    if (!isAdmin) return json({ error: 'Réservé aux administrateurs' }, 403);
    const res = await env.DB.prepare(`SELECT username, role, created_at FROM users ORDER BY username`).all();
    return json({ users: res.results });
  }
  if (path === '/api/users' && method === 'POST') {
    if (!isAdmin) return json({ error: 'Réservé aux administrateurs' }, 403);
    let body;
    try { body = await request.json(); } catch (e) { return json({ error: 'Requête invalide' }, 400); }
    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    const role = body.role === 'admin' ? 'admin' : 'consultation';
    if (!username || !password) return json({ error: 'Nom d\u2019utilisateur et mot de passe requis' }, 400);
    if (username.length > 60) return json({ error: 'Nom d\u2019utilisateur trop long' }, 400);
    const exists = await env.DB.prepare(`SELECT username FROM users WHERE username = ?`).bind(username).first();
    if (exists) return json({ error: 'Cet utilisateur existe déjà' }, 409);
    await env.DB.prepare(`INSERT INTO users (username, pw_hash, role) VALUES (?,?,?)`)
      .bind(username, await hashPassword(password), role).run();
    return json({ ok: true });
  }
  let m = path.match(/^\/api\/users\/([^/]+)$/);
  if (m) {
    if (!isAdmin) return json({ error: 'Réservé aux administrateurs' }, 403);
    const target = decodeURIComponent(m[1]);
    if (method === 'PUT') {
      let body;
      try { body = await request.json(); } catch (e) { return json({ error: 'Requête invalide' }, 400); }
      const row = await env.DB.prepare(`SELECT username FROM users WHERE username = ?`).bind(target).first();
      if (!row) return json({ error: 'Utilisateur introuvable' }, 404);
      if (body.password) {
        await env.DB.prepare(`UPDATE users SET pw_hash = ? WHERE username = ?`)
          .bind(await hashPassword(String(body.password)), target).run();
      }
      if (body.role) {
        if (body.role !== 'admin' && body.role !== 'consultation') return json({ error: 'Rôle invalide' }, 400);
        if (target === auth.username && body.role !== 'admin') {
          return json({ error: 'Vous ne pouvez pas retirer votre propre rôle admin' }, 400);
        }
        await env.DB.prepare(`UPDATE users SET role = ? WHERE username = ?`).bind(body.role, target).run();
      }
      return json({ ok: true });
    }
    if (method === 'DELETE') {
      if (target === auth.username) return json({ error: 'Impossible de supprimer votre propre compte' }, 400);
      const admins = await env.DB.prepare(`SELECT COUNT(*) AS c FROM users WHERE role = 'admin'`).first();
      const targetRow = await env.DB.prepare(`SELECT role FROM users WHERE username = ?`).bind(target).first();
      if (!targetRow) return json({ error: 'Utilisateur introuvable' }, 404);
      if (targetRow.role === 'admin' && admins && admins.c <= 1) {
        return json({ error: 'Il doit rester au moins un administrateur' }, 400);
      }
      await env.DB.prepare(`DELETE FROM users WHERE username = ?`).bind(target).run();
      return json({ ok: true });
    }
  }

  // ---------- état de l'application ----------
  if (path === '/api/state' && method === 'GET') {
    const res = await env.DB.prepare(`SELECT DISTINCT key FROM state`).all();
    const keys = (res.results || []).map((r) => r.key);
    const weeks = keys.filter((k) => k.startsWith('planning:')).map((k) => k.slice('planning:'.length)).sort();
    return json({ weeks, hasMedical: keys.includes('medical_list'), hasRta: keys.includes('rta_data') });
  }

  if (path === '/api/state/medical' && method === 'GET') {
    const data = await stateGet(env, 'medical_list');
    return data === null ? json('null') : jsonRaw(data);
  }
  if (path === '/api/state/medical' && method === 'PUT') {
    if (!isAdmin) return json({ error: 'Réservé aux administrateurs' }, 403);
    const text = await request.text();
    try { JSON.parse(text); } catch (e) { return json({ error: 'JSON invalide' }, 400); }
    await statePut(env, 'medical_list', text);
    return json({ ok: true });
  }
  if (path === '/api/state/medical' && method === 'DELETE') {
    if (!isAdmin) return json({ error: 'Réservé aux administrateurs' }, 403);
    await stateDelete(env, 'medical_list');
    return json({ ok: true });
  }

  if (path === '/api/state/rta' && method === 'GET') {
    const data = await stateGet(env, 'rta_data');
    return data === null ? json('null') : jsonRaw(data);
  }
  if (path === '/api/state/rta' && method === 'PUT') {
    if (!isAdmin) return json({ error: 'Réservé aux administrateurs' }, 403);
    const text = await request.text();
    try { JSON.parse(text); } catch (e) { return json({ error: 'JSON invalide' }, 400); }
    await statePut(env, 'rta_data', text);
    return json({ ok: true });
  }
  if (path === '/api/state/rta' && method === 'DELETE') {
    if (!isAdmin) return json({ error: 'Réservé aux administrateurs' }, 403);
    await stateDelete(env, 'rta_data');
    return json({ ok: true });
  }

  m = path.match(/^\/api\/state\/planning\/([^/]+)$/);
  if (m) {
    let week;
    try { week = decodeURIComponent(m[1]); } catch (e) { return json({ error: 'Semaine invalide' }, 400); }
    if (!/^[\w\- .]{1,40}$/.test(week)) return json({ error: 'Nom de semaine invalide' }, 400);
    const key = 'planning:' + week;
    if (method === 'GET') {
      const data = await stateGet(env, key);
      return data === null ? json('null') : jsonRaw(data);
    }
    if (method === 'PUT') {
      if (!isAdmin) return json({ error: 'Réservé aux administrateurs' }, 403);
      const text = await request.text();
      try { JSON.parse(text); } catch (e) { return json({ error: 'JSON invalide' }, 400); }
      await statePut(env, key, text);
      return json({ ok: true });
    }
    if (method === 'DELETE') {
      if (!isAdmin) return json({ error: 'Réservé aux administrateurs' }, 403);
      await stateDelete(env, key);
      return json({ ok: true });
    }
  }

  // ---------- sauvegarde complète (admin) ----------
  // Renvoie les chaînes JSON brutes (le navigateur les assemble) : aucun
  // JSON.parse côté Worker => aucune consommation du quota CPU gratuit.
  if (path === '/api/export' && method === 'GET') {
    if (!isAdmin) return json({ error: 'Réservé aux administrateurs' }, 403);
    const medical = await stateGet(env, 'medical_list');
    const rta = await stateGet(env, 'rta_data');
    const res = await env.DB.prepare(`SELECT DISTINCT key FROM state`).all();
    const weeks = (res.results || []).map((r) => r.key)
      .filter((k) => k.startsWith('planning:')).map((k) => k.slice('planning:'.length)).sort();
    const plannings = {};
    for (const w of weeks) {
      const d = await stateGet(env, 'planning:' + w);
      if (d !== null) plannings[w] = d;
    }
    return json({
      app: 'suivi-visites-medicales', version: 1,
      exported_at: new Date().toISOString(),
      medical_list_raw: medical,
      rta_raw: rta,
      plannings_raw: plannings
    });
  }

  return json({ error: 'Route inconnue' }, 404);
}

/* ============================================================
 *  Point d'entrée
 * ============================================================ */
export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      if (url.pathname.startsWith('/api/')) {
        await ensureSchema(env);
        return await handleApi(request, env, url);
      }
      if (url.pathname === '/' || url.pathname === '/index.html') {
        return new Response(INDEX_HTML, {
          headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }
        });
      }
      if (url.pathname === '/favicon.ico') {
        return new Response(null, { status: 204 });
      }
      return Response.redirect(url.origin + '/', 302);
    } catch (err) {
      return json({ error: 'Erreur serveur : ' + (err && err.message ? err.message : String(err)) }, 500);
    }
  }
};
