# 🚀 GUIDE DÉBUTANT — Mettre l'application en ligne en ~30 minutes

Méthode la plus simple : **tout se fait dans le navigateur**. Rien à installer,
aucune carte bancaire, 0 € tout de suite. (Git = optionnel, voir tout en bas.)

**Ce qu'il vous faut :** le zip décompressé + votre boîte e-mail.

---

## ✅ Avant de commencer (2 min)

1. Clic droit sur `Suivi-visite-medicale-Cloudflare.zip` → **Extraire tout**.
2. Dans le dossier extrait, faites un **clic droit sur `worker.js`** →
   **Ouvrir avec → Bloc-notes**.
3. Dans le Bloc-notes : **Ctrl+A** (tout sélectionner) puis **Ctrl+C** (copier).
   Laissez le Bloc-notes ouvert : le code est prêt à être collé.

---

## Étape 1 — Créer le compte Cloudflare (3 min)

1. Allez sur **[dash.cloudflare.com](https://dash.cloudflare.com)**.
2. **S'inscrire** (Sign up) → votre e-mail + un mot de passe.
3. Un e-mail de vérification arrive → cliquez sur le lien.

## Étape 2 — Créer le Worker et coller le code (5 min)

1. Menu de gauche → **Workers & Pages**.
2. **Créer** → **Créer un Worker**.
3. Nom : `suivi-visites-medicales` → **Déployer**
   (un code d'exemple s'affiche, on va le remplacer).
4. Cliquez **Modifier le code** (Edit code).
5. Dans la zone de code : **Ctrl+A** puis **Suppr** (tout effacer), puis
   **Ctrl+V** (coller le code copié au début).
6. Bouton **Déployer** (en haut à droite).

## Étape 3 — Activer l'adresse du site (2 min)

1. Retour sur la page du Worker → **Paramètres** → **Domaines et routes**.
2. Activez **workers.dev** (si ce n'est pas déjà actif).
3. 📝 **Notez l'URL** affichée, ex. :
   `https://suivi-visites-medicales.votre-nom.workers.dev`
   *(L'appli affiche une erreur pour l'instant : normal, la base manque.)*

## Étape 4 — Créer la base de données et la connecter (5 min)

1. Menu de gauche → **Stockage et bases de données** → **Base de données D1**
   → **Créer**.
2. Nom : `visite-medicale-db` → **Créer**.
   *(Ne créez aucune table : le Worker le fait tout seul.)*
3. Retour sur le Worker → **Paramètres** → **Liaisons** (Bindings) → **Ajouter**.
4. Type **Base de données D1** :
   - Nom de la variable : **`DB`** ← en majuscules, exactement ces 2 lettres
   - Base de données : `visite-medicale-db`
5. **Enregistrer**.

## Étape 5 — Première connexion (2 min)

1. Ouvrez l'URL notée à l'étape 3.
2. Connectez-vous :

   | Utilisateur | Mot de passe par défaut | Rôle |
   |---|---|---|
   | `seravo` | `ton_mot_de_passe_admin` | Admin (tout) |
   | `concentrix` | `mot_de_passe_consultation` | Lecture seule |

3. **Tout de suite** : onglet **⚙️ Paramètres** → « Mot de passe » → mettez
   vos propres mots de passe pour les deux comptes.

## Étape 6 — Charger vos 1 067 collaborateurs (3 min)

1. Onglet **⚙️ Paramètres** → **📥 Importer une sauvegarde (JSON)**.
2. Choisissez `migration/visites_medicales_migration.json`
   (dans le dossier décompressé).
3. Confirmez → quelques secondes → ✅ collaborateurs, planning S34 et suivi
   RTA sont en ligne !

---

## 🎉 C'est fini

L'application est en ligne, accessible de n'importe quel navigateur, protégée
par vos mots de passe. Pensez à exporter une sauvegarde de temps en temps
(⚙️ Paramètres → 📤 Exporter) : c'est le seul exemplaire des données.

## Si ça coince (les 3 pannes classiques)

| Problème | Solution |
|---|---|
| Erreur « D1 » à l'ouverture | Étape 4 incomplète → le nom de variable doit être **`DB`** en majuscules |
| La page de connexion revient sans cesse | Autorisez les cookies pour `workers.dev` |
| « Utilisateur ou mot de passe inconnu » | Comptes par défaut : `seravo` / `concentrix` (attention aux majuscules) |

## Et Git ?

Optionnel, ça peut attendre que l'appli tourne. Le jour où vous voulez
historiser le code sur GitHub et déployer automatiquement à chaque
modification, suivez **`DEPLOY-GIT.md`** (options B ou C).
