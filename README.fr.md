# AgendApp

*[English version](README.md)*

**Un générateur d'agenda pour les plannings qui se répètent.** Tu décris une fois tes créneaux, tes
types d'événements et ce qui change d'une fois à l'autre (personnes, lieu, tâche…). Ensuite, chaque
événement se crée en quelques touches, au lieu de retaper les mêmes horaires dans ton agenda.

Sans compte, sans serveur : tes données restent sur ton appareil. Disponible en français et en anglais.

<p align="center">
  <img src="docs/screens/fr/patrol/01-calendar.png" width="200" alt="Calendrier du mois">
  <img src="docs/screens/fr/patrol/03-new-event.png" width="200" alt="Saisie d'un événement">
  <img src="docs/screens/fr/patrol/05-export.png" width="200" alt="Export vers un agenda">
  <img src="docs/screens/fr/patrol/01-calendar-dark.png" width="200" alt="Thème sombre">
</p>

> Projet personnel, conçu par un non-développeur avec une IA (voir [Comment ce projet est né](#comment-ce-projet-est-né)).
> Utilisable au quotidien, fourni sans garantie : fais des sauvegardes.

## L'idée

| Tu définis une fois… | …et à chaque événement tu ne choisis que |
|---|---|
| **Créneaux** : Matin 6h–14h, Nuit 22h–6h (le lendemain est géré) | le jour |
| **Types** : Service, Garde 24 h, Repos, Formation… avec leur couleur, leurs champs, leur titre | le type (et le créneau s'il y en a plusieurs) |
| **Champs** : chef d'équipe, équipiers, lieu, heure de relève… | les valeurs qui changent, avec suggestions |
| **Règles** : « une nuit est suivie d'un repos », « l'équipe de nuit = l'équipe du soir » | rien : c'est proposé ou prérempli |

Exemples d'usages : soignants en 12 h, équipes postées, sapeurs-pompiers, patrouilles de sécurité ou
de police, armée, conducteurs de bus ou de tram, astreintes, bénévoles, garde alternée… Des
[profils d'exemple fictifs](examples/fr/) permettent d'essayer sans rien saisir.

## Trois façons de s'en servir

1. **Une machine à fabriquer des agendas** : on saisit vite, puis on exporte des fichiers `.ics` à
   importer dans Google Agenda, Outlook, Apple Calendrier…
2. **Un pont vers l'agenda du téléphone** (Android) : envoi direct ; en option, un événement
   supprimé d'un côté l'est aussi de l'autre.
3. **Un agenda à part entière** : calendrier, planning, bilan des heures, widgets, montre.

L'installation, la compilation, l'organisation du code et la contribution sont décrites dans le
[README anglais](README.md).

## Comment ce projet est né

AgendApp a d'abord été un fichier HTML écrit pour un besoin personnel : saisir vite des plannings
répétitifs et les envoyer dans un agenda. Il est ensuite devenu une application Android, puis une
app montre.

**L'auteur n'est pas développeur.** Tout le code a été écrit en dialogue avec
[Claude Code](https://www.anthropic.com/claude-code), l'assistant de programmation d'Anthropic :
l'auteur a décrit ses besoins, testé sur ses appareils et fait les choix ; l'IA a conçu et écrit le
code. Le code n'a pas (encore) été relu par un développeur humain : les relectures, signalements et
contributions sont particulièrement bienvenus.

## Licence

[GPL-3.0-or-later](LICENSE).
