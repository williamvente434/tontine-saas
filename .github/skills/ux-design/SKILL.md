---
name: ux-design
description: "Aide à améliorer l'expérience utilisateur et le design de l'application, notamment les formulaires, les listes, la clarté et l'accessibilité. Utiliser lorsque le projet nécessite des changements d'interface, de parcours utilisateur, de styles ou de messages d'erreur."
---

# UX & Design

## Objectif

Améliore la qualité de l'expérience utilisateur de l'application tout en conservant une structure simple, cohérente et adaptée à une interface web avec un backend Node.js et PostgreSQL.

## Principes

- Privilégier des parcours simples et explicites : formulaire, validation, confirmation, puis mise à jour de la vue.
- Utiliser des libellés français, compréhensibles et précis.
- Afficher les informations importantes avant les actions secondaires.
- Ne pas utiliser d'éléments de formulaire sans identifiant, équilibre ou comportement accessible.
- Gérer correctement les états de chargement, succès, erreur et liste vide.
- Éviter d'injecter des données non validées dans le HTML avec `innerHTML`.
- Utiliser `textContent` ou des éléments DOM créés pour afficher des données utilisateur.
- Conserver une hiérarchie sémantique avec des balises HTML adaptées : `form`, `input`, `select`, `button`, `ul`, `li`, `article`.
- Respecter les couleurs, la taille et l'espacement des contrôles pour faciliter la lecture et l'utilisation.

## Vérifications UX/UI

- Le formulaire contient tous les champs obligatoires.
- Les champs requis ont un message d'erreur clair.
- Le submit est empêché correctement avec `event.preventDefault()`.
- La réponse API est vérifiée avant d'afficher un résultat.
- Les données de la base sont affichées sans injection HTML.
- La liste est actualisée après l'ajout.
- Les messages de succès et d'erreur sont visibles et compréhensibles.
- Les interactions restent accessibles au clavier et avec une navigation clavier.
- Les styles restent responsives sur mobile, tablette et ordinateur.

## Fichiers concernés

- `public/index.html` : structure de la page et formulaire.
- `public/js/main.js` : interactions et comportement client.
- `public/css/style.css` : identité visuelle et responsive.
- `src/server.js` : messages d'erreur API et comportement des routes.

## Bonnes pratiques pour les modifications

1. Inspecter le code HTML, JavaScript et CSS concernés.
2. Identifier le parcours utilisateur et les états possibles.
3. Modifier le plus petit ensemble de fichiers nécessaire.
4. Vérifier la syntaxe et les diagnostics VS Code.
5. Tester le comportement réel avec le serveur Docker.
6. Vérifier que l'utilisateur peut compléter le parcours sans ambiguïté.
