# 🧑‍💻 Mettre le projet sur Git avant de le déployer sur Cloudflare

Bonne pratique 👍 : Git vous garde un historique du code, permet de revenir en
arrière et peut déclencher le déploiement automatiquement à chaque `push`.

**Important à comprendre avant de commencer :**

| Ce qui est dans Git | Ce qui n'est PAS dans Git |
|---|---|
| Le **code** (`worker.js`, `sources/`, `wrangler.toml`…) | Les **données** (collaborateurs, plannings, RTA) |
| La configuration de déploiement | Elles vivent dans la base **D1** sur Cloudflare |

→ La base D1 se sauvegarde depuis l'application (onglet **⚙️ Paramètres** →
📤 Exporter une sauvegarde), pas via Git.

> ⚠️ **RGPD — fichier `migration/visites_medicales_migration.json`** : il contient
> 1 067 collaborateurs (noms, matricules, suivi de visites médicales). Le
> `.gitignore` fourni **l'exclut du dépôt**. Ne le poussez que sur un dépôt
> **privé** (voir § 4). Ce fichier ne sert qu'une fois (import via l'application),
> il n'est pas nécessaire au déploiement.

---

## 1. Mettre le code sur GitHub (une seule fois)

1. Créez un dépôt sur [github.com](https://github.com) → **New repository** :
   nom `suivi-visites-medicales`, visibilité **Private** (recommandé, voir § 4).
   Ne cochez aucune option d'initialisation (pas de README auto).
2. Dans le dossier du projet (celui qui contient `worker.js`) :

```bash
git init
git add .
git status                          # vérifier : migration/*.json ne doit PAS apparaître
git commit -m "Suivi visites médicales — version Cloudflare"
git branch -M main
git remote add origin https://github.com/VOTRE-COMPTE/suivi-visites-medicales.git
git push -u origin main
```

Sur GitLab c'est identique (remplacez l'URL par `gitlab.com/...`) ; pour
l'Option C, le workflow est fourni pour GitHub (adaptation mineure sur GitLab).

### 1 bis. Variante débutant — sans installer Git, via le site GitHub

1. Sur [github.com](https://github.com) : **New repository** → nom
   `Suivi-visite-medicale` → **Private** → **Create repository**.
   *(GitHub n'accepte pas les accents dans les noms : « médicale » devient
   « medicale » — ce n'est pas grave, le nom exact est libre.)*
2. Sur la page du dépôt vide, cliquez le lien **uploading an existing file**
   (ou **Add file → Upload files**).
3. Ouvrez le dossier `suivi-visites-medicales-cloudflare` et sélectionnez son
   **contenu** — ⚠️ les fichiers et dossiers qui sont DEDANS (worker.js,
   wrangler.toml, sources/, .gitignore…), **pas le dossier lui-même ni le
   zip** : `wrangler.toml` doit se retrouver **à la racine** du dépôt.
4. Glissez-déposez dans la page GitHub → **Commit changes**. C'est tout :
   votre code est sur GitHub.

> ⚠️ **Deux pièges de l'upload par glisser-déposer :**
> 1. Le `.gitignore` n'est **pas** appliqué par l'upload web : **ne glissez
>    pas** le dossier `migration/` (1 067 collaborateurs, données RGPD — cf.
>    § 4). Ce fichier reste sur votre ordinateur : c'est depuis votre
>    ordinateur que vous le choisirez pour l'import final (⚙️ Paramètres),
>    il n'a jamais besoin d'être sur GitHub.
> 2. Si après déploiement Cloudflare dit « wrangler.toml introuvable » ou que
>    la liaison D1 manque, c'est que vous avez uploadé le dossier entier au
>    lieu de son contenu : déplacez les fichiers à la racine du dépôt
>    (Add file → Create new file / ou « Move » via un petit commit).

---

## 2. Trois façons de déployer — choisissez LA VÔTRE

### Option A — Git sert uniquement à versionner (la plus simple)

Vous gardez le déploiement « copier-coller » du README (Étapes 1 à 5) et Git
vous sert d'historique. À chaque modification : `git add . && git commit -m "…"
&& git push`, puis vous recollez `worker.js` dans le tableau de bord Cloudflare.

👉 Rien d'autre à faire. Les sections suivantes sont optionnelles.

### Option B — GitHub ⇄ Cloudflare « Workers Builds » (recommandée)

Cloudflare surveille votre dépôt GitHub : **chaque push redéploie tout seul**
l'application. Disponible sur l'offre gratuite, sans carte bancaire.

1. Créez la base D1 et notez son ID (si pas déjà fait) :
   tableau de bord → **Stockage et bases de données** → **D1** → créer
   `visite-medicale-db` → ouvrez-la → copiez **l'ID de la base**.
2. Ouvrez `wrangler.toml` à la racine du projet et remplacez
   `COLLEZ_ICI_L_ID_DE_VOTRE_BASE_D1` par cet ID, puis envoyez la modification
   sur GitHub : en ligne de commande (`git commit` + `git push`), ou sur
   github.com (ouvrez `wrangler.toml` → icône crayon ✏️ → corrigez la ligne →
   **Commit changes**). En variante « 1 bis », vous pouvez aussi faire cette
   modification **avant** l'upload : ouvrez `wrangler.toml` avec le Bloc-notes,
   collez l'ID, enregistrez, puis glissez-déposez.
   → avec le déploiement par Git, **c'est `wrangler.toml` qui déclare la
   liaison D1** (variable `DB`) : pas besoin de la créer dans l'onglet
   Liaisons du tableau de bord.
3. Tableau de bord Cloudflare → **Workers & Pages** → **Créer** → onglet
   **Importer un dépôt** (ou « Connect to Git ») → connectez votre compte
   GitHub → choisissez votre dépôt (ex. `Suivi-visite-medicale`).
4. Configuration proposée : commande de build = *(vide)*, commande de
   déploiement = `npx wrangler deploy` (valeurs par défaut, gardez-les) →
   **Créer et déployer**.
5. L'URL `https://suivi-visites-medicales.<votre-sous-domaine>.workers.dev`
   est active. Reprise à l'Étape 4 du README (première connexion + import des
   données).

Ensuite : modifiez le code → `git push` → redéploiement automatique en ~1 min.

### Option C — GitHub Actions (CI/CD avec jeton d'API)

Si vous préférez passer par GitHub Actions plutôt que l'intégration native
(ou pour GitLab après adaptation) : le fichier
**`.github/workflows/deploy.yml`** est déjà fourni, il reconstruit `worker.js`
depuis les sources puis lance `wrangler deploy` à chaque push sur `main`.

1. Sur Cloudflare : **Mon profil** (icône en haut à droite) → **Jetons d'API**
   → **Créer un jeton** → modèle **« Modifier les Workers Cloudflare »**
   (Edit Cloudflare Workers) → ajoutez la permission **Account · D1 · Edit** →
   créez et **copiez le jeton** (il ne sera plus affiché).
2. Sur la page d'accueil du tableau de bord, copiez **l'ID de compte**
   (Account ID, encadré de droite).
3. Sur GitHub : dépôt → **Settings** → **Secrets and variables** → **Actions**
   → **New repository secret** :
   - `CLOUDFLARE_API_TOKEN` → le jeton de l'étape 1
   - `CLOUDFLARE_ACCOUNT_ID` → l'ID de l'étape 2
4. Poussez le code (`git push`). Onglet **Actions** du dépôt : le workflow
   « Deploy vers Cloudflare Workers » s'exécute et met l'application en ligne.
5. Ne pas oublier l'ID D1 dans `wrangler.toml` (cf. Option B, point 2).

> 🔄 Option B ou C ? Les deux donnent le même résultat (déploiement à chaque
> push). L'Option B est plus simple (2 clics, aucun secret à gérer) ;
> l'Option C donne plus de contrôle (historique des exécutions, tests avant
> déploiement…). **Prenez la B sauf besoin particulier.**

---

## 3. Workflow quotidien (Options B ou C)

```bash
# 1. Modifier l'interface ou le serveur
nano sources/public/app.js        # ou sources/worker.template.js

# 2. Reconstruire worker.js et tester en local (optionnel mais conseillé)
python3 sources/build.py
cp dist/worker.js worker.js
npx wrangler dev                  # http://localhost:8787 (D1 locale simulée)

# 3. Publier
git add . && git commit -m "Description de la modification" && git push
# → Cloudflare redéploie automatiquement (Options B et C)
```

Les données ne sont jamais touchées par un déploiement : la base D1 persiste.

---

## 4. Pourquoi dépôt privé ? (rappel RGPD)

L'application gère des données de santé au travail (dates de visites médicales,
absences). Même si le fichier de migration est exclu par `.gitignore`, les
sources peuvent révéler des noms de comptes ou la logique métier de votre
organisation : **créez le dépôt en Private** — l'offre gratuite de GitHub et
GitLab les autorise sans limite.

Si votre dépôt est privé et que vous tenez à versionner le fichier de
migration : supprimez la ligne `migration/visites_medicales_migration.json`
du `.gitignore`, puis `git add -f migration/*.json && git commit && git push`.

---

## 5. Récapitulatif des fichiers ajoutés pour Git

| Fichier | Rôle |
|---|---|
| `.gitignore` | Exclut le fichier de migration (RGPD), `dist/`, `.wrangler/`, `node_modules/` |
| `.github/workflows/deploy.yml` | Option C : déploiement GitHub Actions à chaque push |
| `wrangler.toml` | Configuration de déploiement (liaison D1 `DB`) — utilisé par les Options B et C |
| `DEPLOY-GIT.md` | Ce guide |
