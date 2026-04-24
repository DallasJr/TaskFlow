# DEVOPS.md — Choix d'architecture Kubernetes

## Choix 4 — Nombre de replicas : 1 staging / 3 production

### Choix retenu
**1 replica en staging, 3 replicas en production.**

---

### Justification staging (1 replica)

Le staging est un environnement de **validation** — son but est de tester que le code fonctionne avant de partir en production. Une interruption de quelques secondes pendant un déploiement est acceptable car :

- Personne ne travaille en production sur staging (usage interne uniquement)
- Le coût des ressources reste faible sur une machine locale ou un petit cluster
- Cela simplifie le debug : un seul pod, des logs clairs, sans ambiguïté sur quel pod répond

**Risque accepté en staging** : coupure brève lors d'un rolling update si le seul pod est remplacé. Ce risque est délibéré et documenté.

---

### Justification production (3 replicas)

La production sert de vrais utilisateurs. 3 replicas garantissent :

- **Haute disponibilité** : si un pod crash ou est mis à jour, 2 autres continuent de répondre
- **Rolling update sans interruption** : avec `maxUnavailable: 1` et `maxSurge: 1`, Kubernetes monte le 4e pod avant de descendre le 1er — il y a toujours au moins 2 pods actifs
- **Charge répartie** : le Service Kubernetes load-balance les requêtes entre les 3 replicas

---

### Rolling update avec 1 replica — ça fonctionne ?

**Oui, à condition que `maxUnavailable: 0`** (valeur utilisée en staging).

| Config | Comportement |
|---|---|
| `maxUnavailable: 1`, `maxSurge: 1`, 1 replica | Kubernetes descend le pod existant **avant** de monter le nouveau → coupure brève |
| `maxUnavailable: 0`, `maxSurge: 1`, 1 replica | Kubernetes monte le nouveau pod **d'abord**, puis descend l'ancien → zéro coupure |

En staging on utilise `maxUnavailable: 0` — le rolling update ne coupe pas le service, mais il faut temporairement 2x les ressources (l'ancien + le nouveau pod coexistent le temps de la transition).

---

### Résumé des valeurs dans les deployments

| Paramètre | Staging | Production |
|---|---|---|
| `replicas` | 1 | 3 |
| `maxUnavailable` | 0 | 1 |
| `maxSurge` | 1 | 1 |
| Coupure possible | Non (maxUnavailable: 0) | Non (2 pods restent actifs) |
| Ressources doublées pendant update | Oui (temporaire) | Non |
