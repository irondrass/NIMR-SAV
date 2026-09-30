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

## Review sécurité et métier — v23.3.69 (30/09/2026)
- La revue contradictoire a corrigé trois écarts : un appel générique après QC n'est plus une preuve d'information sur la disponibilité ; les opérations atelier bloquées sont maintenant visibles même sans blocage global de l'OR ; une promesse sans ETA est signalée « à sécuriser » comme dans les exceptions métier canoniques.
- Nouveau champ normalisé clientCommitment.readyInformedAt : uniquement horodaté par recordClientCommitment lorsque le dossier est réellement prêt (QC/finalisation canoniques + readyForDeliveryAt valide). L'horodatage enregistré est celui de l'action, pas celui proposé par le navigateur. lastContactAt seul n'a aucune valeur de preuve de disponibilité.
- En cas de reprise après refus QC, une nouvelle validation requiert une nouvelle information explicite du client. Si readyForDeliveryAt manque malgré des flags « prêt », l'interface demande la vérification de la trace QC ; aucun accusé de contact prêt n'est accepté.
- Le formulaire Réception nomme explicitement le contact manuel « véhicule prêt » lorsque le QC horodaté est validé. Cette information ne constitue toujours ni un SMS envoyé ni une notification NOTIFY.
- Blocage pièces : partsStatus ou blockerReason canonique. Blocage opération : lecture seule des bookings/contrôles existants. Les labels d'opération passent par escapeHtml. Aucune action technicien ni table métier parallèle.
- Release v23.3.69 ; empreinte canonique scellée : 142e08f2d7e206403253943a3219a3e6dd40107ad8b9262ebf2fa710cb2217d0. v23.3.68 reste scellée et inchangée.
- Gates : nouveaux tests KHA-45 11/11 PASS dont navigateur réel 1440/1024/768/390 et formulaire complet, régressions KHA-43/44/R1/R2/audit/restitution/workflow 50/50 PASS, empreinte 11/11 PASS, 4/4 suites sécurité/version/PWA PASS (STATIC STARTUP SAFETY 7/7), syntaxe et diff-check PASS.
- Baseline déjà rouge, sans lien KHA-45 : reception_qc_field_usability_v2326.test.mjs (ancien libellé QC) ; users_roles_permissions_reception_quality_sensitive.test.mjs (mock document sans getElementById). Les deux échouent identiquement sur la branche non modifiée antérieure.
- KHA-71 demeure la dépendance d'intégration NOTIFY, en particulier l'événement prêt/100 %, les canaux, l'anti-doublon et la preuve d'envoi. Aucune activation PROD, migration ou déploiement Edge Function.
