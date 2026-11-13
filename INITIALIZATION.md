# Initialisation de IOA Rangueil — procédure et résultat

Cible exclusive : projet `ioa-rang`, base `(default)` Standard, document `runtime/current`.
Le 13 novembre 2026, après autorisation explicite, le document a été créé atomiquement puis relu : ses 14 champs correspondent au modèle ci-dessous. Date de création : `2026-11-13T07:42:07.456039Z`. Le forfait Spark a été confirmé par Damien. Ne pas relancer l’initialisation : le script refuserait le document existant.

Les règles ont ensuite été publiées avec une autorisation distincte, le même jour à `07:48:41Z`. Leur contenu publié correspond exactement au fichier local ayant réussi les 28 tests Emulator. La relecture après publication a confirmé les 14 champs et la date de modification inchangés, ainsi qu’un historique vide. Aucune publication de l’application n’est réalisée par cette procédure.

## Structure exacte

Collection `runtime`, identifiant du document `current`. Les 14 champs ci-dessous doivent tous exister, avec les types indiqués par JSON (les trois zéros sont des entiers Firestore, `null` est une valeur nulle, pas une chaîne).

```json
{
  "seq": 0,
  "lastRequestId": "initial",
  "lastKind": null,
  "lastHub": null,
  "lastAt": null,
  "globalResetAt": null,
  "hub1Count": 0,
  "hub1LastSeq": null,
  "hub1LastAt": null,
  "hub1ResetAt": null,
  "hub2Count": 0,
  "hub2LastSeq": null,
  "hub2LastAt": null,
  "hub2ResetAt": null
}
```

Ce modèle correspond exactement à `initialRuntime` dans `rotation.ts`. Aucun champ `hub3`, aucun tableau de hubs, aucun compteur quotidien stocké. Les totaux quotidiens viennent des événements. Les timestamps restent nuls : il n’y a encore eu ni entrée ni remise à zéro. `lastRequestId: "initial"` est une sentinelle d’état, pas un événement ; la contrainte de longueur des identifiants d’événements ne s’applique donc pas à cette valeur initiale.

Après initialisation : deux compteurs à zéro, Hub 1 prioritaire, puis Hub 2 ; aucun chrono démarré. La collection `events` apparaîtra lors de la première action réelle. Il ne faut pas créer de document factice pour la matérialiser.

## Pourquoi l’application ne doit pas initialiser la base

`recordAction` échoue si `runtime/current` manque. Les règles de `runtime/current` contiennent `allow create: if false` et `allow delete: if false`. Elles autorisent seulement les mises à jour cohérentes avec un événement créé dans la même opération atomique. Il ne faut pas ouvrir temporairement la création publique.

Le script existant `scripts/seed-emulator.mjs` est volontairement limité à `127.0.0.1:8080` et `demo-ioa-rang`. Son jeton `owner` est propre à l’émulateur ; ne pas le transformer en script de production. Les tests de règles initialisent aussi uniquement la base fictive.

## Fichiers préparés

- `scripts/initialize-runtime.mjs` : outil administratif autonome, aucune dépendance npm ajoutée, aucune intégration dans le navigateur ou le build.
- `initialize-runtime.test.mjs` : tests avec transport HTTP entièrement simulé, incluant correspondance avec le modèle applicatif, refus d’écrasement et absence de réessai automatique.
- Ce document : procédure et limites.

Aucun changement des règles, du client Firebase, de la facturation ou de GitHub.

## Commandes

Depuis la racine du dépôt `ioa-rg`.

### 1. Aperçu local, sans accès réseau

```powershell
node scripts/initialize-runtime.mjs
```

Affiche la cible et les 14 valeurs. Ne lit pas de jeton, ne se connecte pas à Firestore et ne crée rien. Ce mode a été exécuté pendant la préparation.

### 2. Prérequis administratifs, après autorisation

Utiliser Node.js 22.12+ et Google Cloud CLI (`gcloud`). Un compte Google administrateur autorisé sur `ioa-rang` doit être connecté à gcloud ; la connexion Firebase CLI seule ne suffit pas pour cette procédure. Vérifier le compte avec `gcloud auth list` et, si nécessaire, effectuer soi-même `gcloud auth login`. Les droits nécessaires comprennent la lecture des métadonnées de base, la lecture des documents/événements et la création de document. Ne pas créer de clé de compte de service ni modifier les droits pour contourner un refus.

Cette identité administrative est distincte de Firebase Auth : aucun utilisateur, même anonyme, n’est créé dans l’application. Le jeton temporaire transite uniquement par l’entrée standard du script, sans fichier ni argument de commande. Ne jamais le copier dans une conversation.

Ne pas utiliser la variable `FIRESTORE_EMULATOR_HOST` pour ces commandes ; le script refusera de poursuivre si elle est définie. La cible et l’URL sont fixes : elles ne dépendent ni du projet gcloud courant ni du `.firebaserc`.

### 3. Contrôle distant en lecture seule, après autorisation

```powershell
gcloud auth print-access-token | node scripts/initialize-runtime.mjs --check
```

Vérifie l’identité et l’édition de `(default)`, l’absence de `runtime/current` et l’absence d’événement dans `events` (lecture limitée à un document). Toute erreur d’autorisation ou de réseau interrompt la procédure. Une base absente n’est pas assimilée à une base vide.

### 4. Création, uniquement après autorisation explicite

```powershell
gcloud auth print-access-token | node scripts/initialize-runtime.mjs --apply --confirm=ioa-rang
```

Le script refait les contrôles, appelle `createDocument` avec `documentId=current`, puis relit le document et compare ses 14 champs. Une seule écriture est prévue, sans mise à jour, suppression, réinitialisation ou création d’événement.

Le refus d’écrasement est atomique côté Firestore : si un autre processus crée le document entre la lecture de contrôle et la création, celle-ci est refusée. Un deuxième lancement refuse également d’écraser le document ; c’est le comportement attendu, pas une invitation à le supprimer.

La vérification d’absence d’historique est un contrôle préalable, pas un verrou global sur toute la base. Faire l’initialisation avant diffusion de l’application et sans autre outil administratif concurrent. Le script ne prétend pas vérifier toutes les collections possibles ; il ne modifie que `runtime/current`.

### 5. Vérification et arrêt

Le message de réussite confirme une création suivie d’une relecture conforme. Vérifier dans la console `ioa-rang` → `(default)` → `runtime/current` les 14 champs. Ne pas cliquer sur les hubs de production simplement pour vérifier la création : cela ajouterait de vrais événements.

En cas de résultat réseau incertain, ne pas supprimer ni réinitialiser le document. Le script ne relance pas automatiquement la création. Inspecter son état dans la console. Une création peut avoir réussi malgré une réponse perdue ; une nouvelle tentative reste non destructive mais sera refusée si le document existe.

L’initialisation administrative ne déploie aucune règle. L’accès de l’application restera dépendant des règles effectivement publiées. Leur éventuel déploiement doit faire l’objet d’une autorisation séparée. Aucun déploiement Firebase ou GitHub Pages n’est inclus ici.

## Références

- [Firestore createDocument](https://firebase.google.com/docs/firestore/reference/rest/v1/projects.databases.documents/createDocument)
- [Authentification REST et erreur ALREADY_EXISTS](https://firebase.google.com/docs/firestore/use-rest-api)
- [Jeton temporaire gcloud](https://docs.cloud.google.com/sdk/gcloud/reference/auth/print-access-token)

## Validation de la préparation

Syntaxe Node vérifiée ; aperçu local exécuté sans réseau ; 11 tests Vitest réussis avec transport simulé, inclus dans `npm test`. Google Cloud CLI a ensuite été installé et authentifié pour l’initialisation autorisée. Aucun événement de test n’a été créé en production.
