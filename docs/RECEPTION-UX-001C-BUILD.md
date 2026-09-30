# KHA-45 — RECEPTION-UX-001C : Suivi client & restitution

## Périmètre livré dans ce build
- Cockpit Aujourd'hui : conserve les quatre compteurs KHA-43 et ajoute un filtre dédié « Suivi en cours ».
- Inclut les véhicules réceptionnés les jours précédents jusqu'à restitution physique (même si facturés/clôturés administrativement).
- Carte et fenêtre OR : promesse, ETA atelier, opération actuelle, avancement, blocage pièces/atelier, QC, derniers/prochains contacts, écart estimé, prêt/non retiré et action suivante.
- États dérivés des sources OR/planning/QC existantes ; aucune seconde table de dossiers, aucun nouveau rôle ni contrôle technicien pour la Réception.
- Le statut « Prêt à livrer » exige la phase canonique ready (travaux terminés, QC et finalisation). Les dossiers archivés sans preuve de remise affichent une demande de vérification Direction.
- Distinction explicite entre contact client tracé après QC et notification SMS/push réellement envoyée.

## Frontière NOTIFY / activation
- Aucun SMS/push n'est émis par ce build. Aucun transport de notification client prêt et aucune règle 100 % validée exploitable n'ont été identifiés.
- Intégration automatique « prêt à livrer / 100 % » à implémenter sur événement canonique lors du lot NOTIFY (lié à KHA-71), avec anti-doublon, consentement/canal, preuve d'envoi et ouverture du dossier.
- Ne pas déduire « SMS envoyé » de clientCommitment.lastContactAt ; c'est uniquement l'horodatage d'un contact enregistré manuellement.
- Pas de migration, secret, déploiement Edge Function ou activation production.

## Tests build
- Nouveaux tests KHA-45 : 6/6 PASS (suivi multi-jours, facturé mais non remis, QC, contact, pièces/retard, échappement HTML).
- Suite combinée KHA-43/44/R2/audit/restitution : 43/43 PASS, dont navigateurs 1440/1024/768/390.
- Release v23.3.68 : 11/11 empreinte, 28 runtime files incluant ui-reception.js ; identités historiques v23.3.67 et précédentes inchangées.
- Quatre suites de sécurité/version/PWA PASS ; STATIC STARTUP SAFETY 7/7 ; syntaxe et git diff --check PASS.
- Test hérité reception_guided_workflow_v231c (libellé « Import devis PDF atelier ») FAIL identiquement sur main non modifié : non-régression.
