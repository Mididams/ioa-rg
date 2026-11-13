# IOA Rangueil — deux hubs

Application React/TypeScript du dépôt `ioa-rg`, connectée exclusivement à Firestore sur `ioa-rang`. Aucun import ni initialisation Firebase Auth, aucune connexion utilisateur ou anonyme, aucune connexion Supabase active.

## Développement et vérification

Prérequis : Node.js >= 22.12, Java 21 pour l’émulateur et Firebase CLI (version testée : 15.36.0).

```powershell
npm ci
npm test
npm run typecheck
npm run test:emulator
npm run build
npm run test:static
```

`npm test` exécute les tests applicatifs. `test:emulator` démarre et arrête Firestore Emulator, charge les règles et exécute les tests de sécurité sur **demo-ioa-rang**, jamais sur la production. La suite de sécurité refuse de fonctionner sans `FIRESTORE_EMULATOR_HOST`. Si Java 8 est sélectionné par Windows, placer le dossier `bin` de Java 21 en tête de `PATH`.

Pour manipuler une base locale :

```powershell
firebase emulators:start --only firestore --project demo-ioa-rang
# Dans un second terminal, une fois seulement :
node scripts/seed-emulator.mjs
$env:VITE_USE_FIREBASE_EMULATOR='true'
npm run dev
```

Le script d’initialisation est limité à 127.0.0.1 et au projet fictif. Il refuse d’écraser un état existant. Les tests de règles effacent uniquement cette base fictive : ne pas les lancer pendant une démonstration locale dont on veut conserver les données.

Sans la variable d’émulation, le navigateur cible **ioa-rang**. Un clic peut donc être une véritable écriture si les règles distantes l’autorisent. Le build produit `dist/` et actualise `app.js` à la racine ; il ne publie rien. Utiliser localhost ou HTTPS, notamment pour `crypto.randomUUID()`.

## Fonctionnement et modèle

- Deux hubs (1 et 2), priorité au hub le moins récemment utilisé ; confirmation hors rotation.
- `runtime/current` : compteurs réinitialisables, séquence, dernier événement et horodatages des deux hubs.
- `events/{requestId}` : événement immuable `{requestId, kind, hub, seq, at}`. Un reset global utilise le hub 0 ; une entrée accepte uniquement 1 ou 2.
- Une transaction écrit ensemble un événement et l’état courant. Les timestamps viennent de Firestore. Les réessais utilisent le même UUID, y compris après expiration de l’attente de l’interface ; une expiration ne signifie pas que la transaction a été annulée.
- En cas de refus lié à une concurrence observée dans l’émulateur, une nouvelle lecture serveur doit prouver que la séquence a avancé avant un réessai borné (cinq tentatives externes maximum). Un refus sur un état inchangé est propagé.
- Les resets conservent chronomètres, ordre de rotation et historique. Les totaux quotidiens, globaux et par hub, sont dérivés des entrées entre 7 h et 7 h à Paris, avec journées de 23/25 h.
- Trois abonnements : état courant, événements du jour, événements de la veille. Pas de polling réseau chaque seconde ; seul le chrono local avance. Pas de double lecture initiale des événements.
- Les horodatages enregistrés sont serveur ; l’affichage des chronos et le choix du jour utilisent `readTime` de Firestore puis une horloge monotone. Sans heure serveur fiable, les nouvelles actions sont désactivées.

## Règles et sécurité

Les règles locales autorisent les lectures publiques des événements et de `runtime/current`. Elles refusent les autres chemins, la création publique de l’état, les suppressions, les modifications d’événements et les transitions incohérentes. Les écritures sont liées par `getAfter()`, avec contrôles des types, champs, identifiants, séquences et dates serveur.

**Sans authentification, toute personne connaissant la configuration publique peut effectuer une entrée ou une remise à zéro valide.** Les règles protègent la structure et la cohérence, pas l’identité des opérateurs ni la disponibilité face aux abus. Ne stocker aucune donnée patient. Les règles restent à relire avant diffusion générale ; les tests ne constituent pas une garantie exhaustive.

## Spark

Aucune Cloud Function, tâche planifiée payante, TTL, sauvegarde payante ou activation de facturation. Firestore Standard offre notamment 50 000 lectures/jour, 20 000 écritures/jour, 1 Gio stocké et 10 Gio de transfert sortant/mois. Les quotas gratuits ne garantissent pas que l’usage réel restera sous les limites.

Chaque action produit deux écritures. Il faut compter les lectures transactionnelles, les lectures de règles, les réessais, les notifications à chaque poste et les relectures du jour/de la veille aux ouvertures et reconnexions. L’historique s’accumule ; aucune purge automatique n’est activée. Surveiller la console Usage et dimensionner selon le nombre de postes et d’entrées avant lancement. Le plafond d’écritures donne au maximum théorique 10 000 actions/jour, mais lectures et stockage peuvent limiter bien avant.

Sources : [quotas Firestore](https://firebase.google.com/docs/firestore/quotas), [comptabilisation des lectures et abonnements](https://firebase.google.com/docs/firestore/pricing).

## État de migration et production

Consulter `MIGRATION-REVIEW.md`. Les anciens `schema.sql` et `update-counters.sql` sont conservés comme références historiques, sans aucun appel ni exécution. Ne jamais les exécuter sur Purpan. Le dépôt `ioa-urm` et son projet Supabase sont hors périmètre.

La base distante doit posséder un `runtime/current` cohérent. Pour une base réellement vide, le modèle initial figure dans `initialRuntime` de `rotation.ts` (compteurs/séquence à 0, dates nulles). Ne pas écraser un document existant. Aucun import d’historique n’a été effectué : si des données Rangueil doivent être reprises, préparer et valider un export explicitement identifié avant initialisation.

Aucun déploiement Firebase, aucune publication GitHub Pages, aucun commit ni push n’est effectué par les commandes de vérification. Toute mise en production reste soumise à l’autorisation de Damien.

## Dernière vérification avant publication

La présentation est adaptée à deux hubs. `npm test` inclut les 23 tests applicatifs et les 11 tests d’initialisation avec réseau simulé ; les 28 tests de règles sont exécutés séparément sur l’émulateur. Les chemins relatifs sont compatibles avec `/ioa-rg/`. Le 13 novembre 2026, l’API GitHub authentifiée a confirmé que Pages sert la branche `main`, dossier racine `/`, du dépôt `Mididams/ioa-rg`.

Le document `runtime/current` a été initialisé et les règles Firestore publiées sur `ioa-rang/(default)`, après autorisations distinctes ; voir `INITIALIZATION.md`. La publication de l’application et tout nouveau commit ou push restent soumis à autorisation. `MIGRATION-REVIEW.md` conserve les bilans des étapes précédentes.

Les actions en attente sont désormais conservées dans `sessionStorage` jusqu’à confirmation, y compris après rechargement du même onglet. L’heure affichée est calée sur `readTime` de Firestore puis avancée avec une horloge monotone ; voir le rapport pour les limites et les lectures supplémentaires.
