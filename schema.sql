-- ============================================================
-- Suivi des Visites Médicales — schéma D1
-- NOTE : ce schéma est créé AUTOMATIQUEMENT par le Worker au
-- premier appel (fonction ensureSchema). Ce fichier sert de
-- référence, ou d'initialisation manuelle via :
--   wrangler d1 execute visite-medicale-db --file schema.sql
-- ============================================================

CREATE TABLE IF NOT EXISTS users (
  username   TEXT PRIMARY KEY,
  pw_hash    TEXT NOT NULL,          -- pbkdf2$iterations$salt_b64$hash_b64
  role       TEXT NOT NULL DEFAULT 'consultation',  -- 'admin' | 'consultation'
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  username   TEXT NOT NULL,
  role       TEXT NOT NULL,
  expires_at INTEGER NOT NULL       -- epoch ms
);

-- État applicatif (JSON stocké par morceaux < 1 Mo, limite de liaison D1)
-- clefs utilisées : 'medical_list', 'rta_data', 'planning:<semaine>'
CREATE TABLE IF NOT EXISTS state (
  key   TEXT NOT NULL,
  chunk INTEGER NOT NULL,
  data  TEXT,
  PRIMARY KEY (key, chunk)
);

-- Comptes par défaut (mots de passe à changer dès la première connexion !)
-- seravo      / ton_mot_de_passe_admin       (admin)
-- concentrix  / mot_de_passe_consultation    (consultation)
-- Ils sont créés automatiquement par le Worker si la table users est vide.
