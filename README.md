# 🏥 Suivi des Visites Médicales — version Cloudflare gratuite

Conversion de l'application Streamlit + MongoDB en une application **Cloudflare Workers + D1**, 100 % hébergée sur l'**offre gratuite Cloudflare** (aucune carte bancaire requise).

> ℹ️ Streamlit (Python) ne peut pas fonctionner sur Cloudflare. L'application a donc été
> réécrite en JavaScript avec **exactement les mêmes fonctionnalités** (les 7 onglets,
> le même algorithme de planification, le même design bleu #003D5B / turquoise #25E2CC).
> Le fichier `suivi_visite.py` d'origine contenait d'ailleurs des blocs dupliqués et des
> erreurs de syntaxe (corruption) : la logique a été reconstruite et corrigée.

---

## 📦 Contenu du dossier

| Fichier / dossier | Rôle |
|---|---|
| **`worker.js`** | ⭐ L'application complète prête à coller dans le tableau de bord Cloudflare |
| **`GUIDE-DEBUTANT.md`** | 🚀 Version la plus simple du déploiement, pas à pas pour débutant |
| **`migration/visites_medicales_migration.json`** | Vos données existantes (`medical_tracking.pkl`) converties : 1 067 collaborateurs, planning S34 (1 076 lignes), suivi RTA |
| `sources/public/` | Code source lisible (interface, styles, logique) |
| `sources/worker.template.js` | Code source du serveur (API, authentification, base D1) |
| `sources/build.py` | Reconstruit `worker.js` après modification des sources (`python3 build.py`) |
| `schema.sql` | Schéma de la base (créé automatiquement — référence seulement) |
| `wrangler.toml` | Configuration de déploiement (liaison D1) — ligne de commande et/ou Git |
| **`DEPLOY-GIT.md`** | 🧑‍💻 Guide pour versionner le projet sur GitHub avant de le déployer |
| `.gitignore` | Exclut les données personnelles (RGPD) et les artefacts de Git |
| `.github/workflows/deploy.yml` | Déploiement automatique GitHub Actions (optionnel) |

---

## 🚀 Déploiement (30 minutes, sans installer de logiciel)

### Étape 1 — Créer le Worker

1. Connectez-vous sur **[dash.cloudflare.com](https://dash.cloudflare.com)** (créez un compte gratuit si besoin).
2. Menu de gauche → **Workers & Pages** (ou « Calculer (Workers) » selon la langue).
3. Bouton **Créer** → **Créer un Worker**.
4. Nom : `suivi-visites-medicales` → **Déployer** (le code d'exemple s'affiche, peu importe).
5. Sur la page du Worker, cliquez **Modifier le code** (ou « Edit code »).
6. Supprimez tout le code présent, ouvrez `worker.js` (fourni) avec un éditeur de texte,
   **copiez tout** (Ctrl+A, Ctrl+C) et **collez-le** à la place.
7. Cliquez **Déployer** (en haut à droite). ← L'interface est déjà en ligne, mais elle
   affichera une erreur tant que la base n'est pas liée (étape 3).

### Étape 2 — Activer l'adresse publique

1. Retournez sur le Worker → onglet **Paramètres** (Settings) → **Domaines et routes**.
2. Activez **workers.dev** si ce n'est pas fait. Notez l'URL affichée, par exemple :
   `https://suivi-visites-medicales.<votre-sous-domaine>.workers.dev`

### Étape 3 — Créer la base de données D1 et la lier

1. Menu de gauche → **Stockage et bases de données** → **Base de données D1** → **Créer**.
2. Nom : `visite-medicale-db` → **Créer**. (Ne touchez pas à la table : le Worker crée
   tout seul les tables au premier lancement.)
3. Retournez sur le Worker → **Paramètres** → **Liaisons** (Bindings) → **Ajouter**.
4. Choisissez **Base de données D1** :
   - Nom de la variable : **`DB`** (exactement ces deux lettres majuscules)
   - Base de données : `visite-medicale-db`
5. Enregistrez. Le déploiement se met à jour automatiquement.

### Étape 4 — Première connexion

Ouvrez l'URL `https://suivi-visites-medicales.<votre-sous-domaine>.workers.dev`

| Utilisateur | Mot de passe (par défaut) | Rôle |
|---|---|---|
| `seravo` | `ton_mot_de_passe_admin` | **Admin** (tout) |
| `concentrix` | `mot_de_passe_consultation` | Consultation (lecture seule + exports) |

> 🔐 **À faire immédiatement** : onglet **⚙️ Paramètres** → « Mot de passe » pour chaque
> utilisateur. Les mots de passe sont hachés (PBKDF2) : personne ne peut les relire.

### Étape 5 — Migrer vos données existantes (une seule fois)

1. Connectez-vous en **admin** → onglet **⚙️ Paramètres**.
2. **📥 Importer une sauvegarde (JSON)** → choisissez
   `migration/visites_medicales_migration.json`.
3. Confirmez. Quelques secondes plus tard : les 1 067 collaborateurs, le planning **S34**
   et le suivi RTA sont en ligne. ✅

Vous pouvez refaire cette opération à tout moment avec n'importe quel fichier de
sauvegarde exporté depuis l'onglet Paramètres (**📤 Exporter une sauvegarde**) :
c'est votre outil de backup/restore.

---

## 🗂️ Utilisation quotidienne (identique à Streamlit)

- Les **3 zones d'import de fichiers** sont dans la barre latérale gauche :
  1. *Fichiers Planning* (plusieurs `.xlsx`/`.xls`/`.xlsb` acceptés — feuilles « Tout (WFO+WFH) » ou « TMM »)
  2. *PLANIFICATION VISITE SYSTEMATIQUE* (liste des collaborateurs)
  3. *Enregistrement visite médicale (RTA)* (feuille « Suivi »)
- **Onglet 1** : nommez la semaine (ex. `S35`) puis « 🚀 Lancer l'import et le regroupement ».
  Si le nom est vide, il est détecté automatiquement depuis une date du fichier.
- **Onglet 3** : réglez les 5 jours (horaires, quotas River/Autres, priorité, statut) puis
  « 🚀 Générer ». Créneaux de 30 min, 4 personnes max/créneau, priorité aux replanifications
  puis à l'ancienneté — même logique que l'original. Le tableau interactif permet de
  corriger Statut / Date / Créneau à la main puis de sauvegarder.
- **Onglet 5** : « 📥 Importer RTA » remplace le suivi ; il alimente Absences (6) et Dashboard (7).
- **Onglet 7** : filtre par projet, 4 indicateurs, 3 graphiques, durée moyenne/jour,
  top 5 des durées, visites effectuées, rapport journalier et export complet.

---

## ☁️ Quotas de l'offre gratuite (très largement suffisants)

| Ressource | Gratuit Cloudflare | Usage de cette appli |
|---|---|---|
| Workers | 100 000 requêtes/jour | ~50 requêtes par utilisateur actif |
| D1 (base SQLite) | 5 Go, 5 M lectures/jour, 100 000 écritures/jour | ~1 000 lignes lues par page affichée |
| Stockage des données | 5 Go | ~2 Mo pour 1 000 collaborateurs + 10 semaines |

💡 **Pensez à exporter une sauvegarde JSON régulièrement** (onglet ⚙️ Paramètres) :
la base D1 est la seule copie de vos données.

---

## 🔧 Mettre l'application à jour / modifier le code

1. Modifiez les sources dans `sources/public/` (interface) ou `sources/worker.template.js` (serveur).
2. Reconstruisez : `python3 sources/build.py` → régénère `worker.js`.
3. Dans le tableau de bord Cloudflare : Worker → **Modifier le code** → collez le nouveau
   `worker.js` → **Déployer**. Les données ne sont pas touchées.

> 🧑‍💻 **Vous avez mis le projet sur GitHub ?** Suivez `DEPLOY-GIT.md` : le déploiement
> peut alors être **automatique à chaque `git push`** (Workers Builds ou GitHub Actions,
> gratuit).

### Variante ligne de commande (optionnelle)

```bash
npm install -g wrangler
wrangler login
# adapter wrangler.toml (database_id réel visible dans le tableau de bord D1)
wrangler d1 create visite-medicale-db
wrangler deploy          # déploie le Worker
```

---

## 🆘 Dépannage

| Symptôme | Cause / solution |
|---|---|
| `Erreur serveur : ... D1 ...` ou erreur 500 au chargement | La liaison D1 est absente ou mal nommée → Étape 3 : variable exactement `DB` |
| Page de connexion qui revient après login | Les cookies sont bloqués → autorisez-les pour `*.workers.dev` |
| Tableaux vides, graphiques absents | Le navigateur doit pouvoir charger les librairies CDN (SheetJS, Plotly) au premier affichage — vérifiez la connexion réseau d'entreprise |
| « Utilisateur ou mot de passe inconnu » | Comptes par défaut = tableau de l'étape 4 (attention aux majuscules) |
| Import planning : « Aucun planning reconnu » | Le fichier doit contenir une feuille `Tout (WFO+WFH)` ou `TMM` (comme l'original) |
| Je n'ai plus accès aux imports | Vous êtes en rôle *Consultation* → demandez à un admin de passer votre compte en *Admin* (Paramètres) |

---

## 🔒 Note de sécurité importante

Le fichier `secrets.toml` d'origine contenait l'URI MongoDB **avec mot de passe en clair**
(`mongodb+srv://concentrix:...`). Ce mot de passe a circulé dans le zip : **changez-le dans
MongoDB Atlas** (Database Access → Edit → Edit Password) si ce cluster est encore utilisé.
La nouvelle version Cloudflare n'utilise plus MongoDB : tout est stocké dans votre base D1.

---

*Developed by TEAM TMM 🦄 — version Cloudflare, 2026*
