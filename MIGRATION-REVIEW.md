# Bilan de reprise — 13 novembre 2026

## État trouvé

Cinq fichiers suivis modifiés : `App.tsx`, `App.test.tsx`, `app.js`, `package.json`, `package-lock.json`. Sept fichiers non suivis : configuration Firebase, client Firestore, règles, indexes, tests de règles et journal d’émulation. Aucun changement n’a été réinitialisé par Git.

La session précédente avait déjà remplacé les RPC Supabase par des transactions et abonnements Firestore, configuré `ioa-rang`, réduit les données à deux hubs et généré un bundle. Son journal révélait une erreur de règles (`request.path.size()`) refusant les écritures légitimes. La couverture d’interface avait été remplacée par quatre tests de fonctions.

## Corrections réalisées

- Réemploi du modèle `runtime/current` + `events/{requestId}` existant ; pas de redémarrage de la migration.
- Correction de la validation du chemin d’événement ; nombres entiers, bornage de séquence, événement neuf obligatoire, champs stricts et transitions atomiques.
- Extraction de la transaction utilisée réellement par l’application dans `rotation.ts`, afin de la tester avec les règles réelles.
- Réessai borné lors d’un conflit constaté : l’émulateur peut renvoyer `permission-denied` sur un état concurrent avant le réessai automatique du SDK. Une lecture serveur doit constater une séquence plus récente avant une nouvelle tentative. Les règles ne sont pas assouplies.
- Déduplication concurrente et tardive, détection de réutilisation d’un identifiant pour une autre action.
- Réessai de l’interface débloqué après erreur ; verrou immédiat contre les doubles actions ; boutons ordinaires désactivés tant qu’une action attend confirmation ; timer de timeout nettoyé.
- Synchronisation indiquée seulement après réception serveur des trois abonnements ; données optimistes non présentées comme confirmées.
- Suppression de lectures initiales redondantes, gestion de la veille par limites calendaires Paris, compteurs quotidiens par hub restaurés.
- Nom Rangueil, grille à deux colonnes, priorité de rotation et dates/heures rétablies.
- Tests d’interface réintroduits, dépendance de test manquante installée, test statique isolé du réseau ; import explicite `App.tsx` pour éviter la collision Windows avec `app.js`.
- Émulation sur `demo-ioa-rang` uniquement, documentation et initialisation locale sans écrasement.

## Validation locale

| Vérification | Résultat |
|---|---|
| `npm test` | 23 tests réussis : logique/date et interface |
| `npm run test:emulator` | 28 tests réussis avec règles chargées dans Firestore Emulator |
| `npm run typecheck` | Réussi |
| `npm run build` | Réussi ; bundle racine et dist identiques |
| `npm run test:static` | Réussi sur les deux pages ; trafic réseau bloqué |
| Connexions Supabase dans sources actives/bundles | Aucune URL, aucun RPC Supabase restant |

Les tests Firestore couvrent : lectures prévues et chemins interdits, deux hubs, diffusion à un second client, resets 0/1/2 préservant les chronos et l’historique, quatre actions concurrentes, réessai simultané/tardif sans doublon, hub 3, nombres fractionnaires/négatifs, types et champs incorrects, séquence sautée, identifiant incohérent/trop long, horodatage falsifié, écritures isolées, modification/suppression d’événements et initialisation publique interdite.

Les avertissements `PERMISSION_DENIED` des tests négatifs sont attendus. Le CLI a signalé un accès réseau indisponible à son message d’accueil ; cela n’a pas empêché l’émulation ni le succès des tests. Java 21 a été sélectionné explicitement, car Java 8 était en tête du PATH système. Aucun changement système permanent.

Le test statique vérifie le chargement et le DOM, pas une inspection visuelle complète dans un navigateur réel.

## Vérifications distantes en lecture seule

`ioa-rang/(default)` existe : **STANDARD**, **FIRESTORE_NATIVE**, région **eur3**, indicateur **freeTier=true**. Aucun changement de base, de règle ou de facturation.

Une lecture REST publique de `runtime/current` a reçu **HTTP 403**. Elle ne permet pas de conclure à l’existence ou à l’absence de ce document. L’état initial et les règles effectivement publiées ne sont donc pas validés. L’indicateur `freeTier=true` confirme l’éligibilité au quota gratuit de cette base, mais ne prouve pas à lui seul que le compte de facturation du projet est désactivé ; le statut Spark reste à confirmer dans la console avant lancement.

## Audit de sécurité

```json
{
  "score": 2,
  "summary": "Cohérence des écritures validée localement ; accès intentionnellement public, sans contrôle d'identité ni protection complète contre l'épuisement des quotas.",
  "findings": [
    {
      "check": "Field-Level vs. Identity-Level Security",
      "severity": "major",
      "issue": "Toute personne connaissant la configuration peut lire les agrégats et soumettre des entrées ou resets valides.",
      "recommendation": "Faire valider explicitement ce modèle public avant diffusion ; ne pas stocker de données patient. Aucun Auth n'a été ajouté, conformément à la demande."
    },
    {
      "check": "Resource Exhaustion / DoS",
      "severity": "major",
      "issue": "Les tailles et types sont contrôlés mais un tiers peut répéter des opérations valides ; l'historique grandit et les lectures publiques consomment le quota.",
      "recommendation": "Confirmer Spark, dimensionner le nombre de postes et surveiller Usage/stockage. L'accès sans authentification ne permet pas de garantir la disponibilité face aux abus."
    }
  ]
}
```

Les règles constituent un prototype validé sur les cas testés : elles imposent des transitions atomiques et des événements immuables, mais doivent être relues avant une diffusion large. Les cas de propriété, rôles et escalade utilisateur sont sans objet dans ce modèle sans utilisateurs ; les chemins non déclarés sont refusés. Aucun import ou appel Firebase Auth, aucune connexion anonyme. Le paquet npm `firebase` inclut des modules Auth transitifs et des chaînes d’identification communes au SDK ; cela ne constitue pas une authentification de l’application.

## Spark et limites opérationnelles

Aucun service nécessitant Blaze ajouté. Deux écritures par action ; lectures additionnelles pour transactions, règles, abonnements, reconnexions et conflits. Les fenêtres de lecture couvrent uniquement le jour et la veille, mais l’historique demeure stocké. Aucun purgeur/TTL payant configuré. Le respect des quotas dépend du trafic et du nombre de postes : il n’est pas garanti par les seuls tests.

Les chronos et le choix du jour utilisent maintenant `readTime` fourni par Firestore (lecture REST de l'etat courant), puis `performance.now()`. Recalage toutes les cinq minutes et au retour visible, rejet d'un aller-retour superieur a deux secondes, expiration apres dix minutes sans recalage. Sans heure fiable, les nouvelles actions sont bloquees et les temps masques. Prevoir environ 288 lectures supplementaires par jour et par onglet ouvert en continu, plus reprises et tentatives en erreur.

L'action en attente est sauvegardee dans `sessionStorage`, avec une cle separee pour production et emulation, avant tout envoi. Un rechargement conserve son requestId ; le bouton de reessai utilise exactement cet identifiant. Suppression seulement apres confirmation. Le stockage indisponible ou illisible bloque les nouvelles ecritures. Fermer definitivement l'onglet ou effacer son stockage n'est pas couvert. Les refus permanents de regles necessitent correction puis rechargement.


## Avant toute mise en production

1. Confirmer Spark et l’absence d’activation de facturation ; estimer la charge (postes, entrées, rechargements, stockage).
2. Valider le modèle public sans authentification et ses limites de disponibilité/intégrité opérationnelle.
3. Vérifier l’état distant avec les droits d’administration ; déterminer si un historique Rangueil doit être repris. Aucun historique Supabase n’a été importé et aucune donnée Purpan n’a été consultée.
4. Préparer l’état initial uniquement si nécessaire, sans écraser un état existant, et comparer les règles distantes aux règles locales.
5. Après autorisation seulement, publier les règles puis l’application et réaliser une recette contrôlée sur deux postes.

**Aucun déploiement Firebase, aucune publication GitHub Pages, aucun commit ni push. Aucun accès au dépôt ioa-urm ni au projet Supabase Purpan.** Les deux anciens fichiers SQL sont conservés comme référence inactive ; leur suppression n’est pas nécessaire pour supprimer les connexions Supabase.

## Dernière validation de présentation — 13 novembre 2026

Présentation reconstruite depuis le balisage d’origine présent dans l’historique Git de ce seul dépôt. Aucun accès au dépôt Purpan. Les fonctions Firebase, les transactions, les règles, le stockage de session et l’horloge serveur n’ont pas été modifiés pendant cette correction de présentation.

Restauration des classes et de la structure d’origine : bandeau `summary`, compteurs `totals`/`total`, cartes entièrement cliquables avec `card-top`, chronomètres, `card-bottom`, encarts `add`, dates `reset-date`, totaux quotidiens, légende, espacements et modale `overlay`. Annulation clavier et focus initial de la modale rétablis. Nom Rangueil, rotation initiale Hub 1 → Hub 2, légende « En attente » à la place d’un avant-dernier hub inexistant. Le CSS est identique à celui d’origine, sauf `repeat(2, 1fr)` au lieu de trois colonnes ; la présentation mobile à une colonne est conservée.

Résultats après correction :

- `npm test` : **23 tests réussis**.
- `npm run test:emulator -- --config firebase.validation.local` : **28 tests réussis**, projet fictif `demo-ioa-rang`, port 8081 pour ne pas interrompre l’émulateur de développement sur 8080. Arrêt automatique de cet émulateur de validation.
- `npm run typecheck` : réussi.
- `npm run build` : réussi, bundle de production 701,24 ko (212,83 ko gzip).
- `npm run test:static` : réussi sur racine et `dist`, sans réseau. Vérifie aussi les deux titres de hubs, les encarts `.add` et leur padding/bordure arrondie, et le bandeau de compteurs.
- Bundles racine et `dist` identiques ; aucune chaîne Supabase/RPC historique/clé Supabase ; aucun Hub 3 ou champ de Hub 3 ; projet `ioa-rang` présent et projet d’émulation absent du bundle de production.

Ces contrôles de présentation portent sur le balisage, le CSS et le DOM compilé. Aucune nouvelle validation visuelle dans un navigateur réel n’est revendiquée lors de cette correction.

### GitHub Pages

Le remote local et les métadonnées du connecteur GitHub confirment **Mididams/ioa-rg**, dépôt public, branche principale **main**. `base: "./"`, `./app.js` et `./style.css` conviennent au chemin attendu `https://mididams.github.io/ioa-rg/`. Aucun CNAME ou workflow local ne cible un autre dépôt. Le build actualise les fichiers statiques suivis à la racine et la copie `dist`.

La requête de lecture `GET /repos/Mididams/ioa-rg/pages` a renvoyé **404** sans authentification. Cela ne permet pas de confirmer le paramétrage distant de Pages. Le connecteur disponible n’expose pas cette configuration. Avant publication, vérifier dans Settings → Pages du seul dépôt `ioa-rg` la source choisie : pour une publication depuis les fichiers suivis, **main / (root)**. Aucun réglage distant n’a été modifié, aucun workflow de déploiement n’a été ajouté. Le site actuellement en ligne n’a pas été mis à jour ni validé par ces tests locaux.

Aucun commit, push, déploiement Firebase ou GitHub Pages. Aucun changement sur Purpan ou Supabase.
