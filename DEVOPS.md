# DEVOPS.md — Choix d'architecture Kubernetes

## Choix 3 — Stratégie de déploiement Kubernetes

### Choix retenu
- **Staging** : `maxUnavailable: 0 / maxSurge: 1`
- **Production** : `maxUnavailable: 1 / maxSurge: 1`

---

### Justification staging — maxUnavailable: 0 / maxSurge: 1

Staging a **1 seul replica**. Avec `maxUnavailable: 1`, le pod serait supprimé avant que le nouveau soit prêt — coupure garantie. En imposant `maxUnavailable: 0`, Kubernetes est forcé de démarrer le nouveau pod en premier, attendre qu'il passe `Ready`, puis tuer l'ancien.

Contrepartie acceptée : pendant quelques secondes, 2 pods tournent en même temps → consommation doublée temporairement. Sur un env de test, ce surcoût est négligeable.

---

### Justification production — maxUnavailable: 1 / maxSurge: 1

Production a **3 replicas**. On peut se permettre de descendre à 2 pods pendant un update sans impact utilisateur. Ce choix offre un **équilibre vitesse / disponibilité** :

- `maxUnavailable: 1` → 1 pod remplacé à la fois, 2 actifs en permanence
- `maxSurge: 1` → au maximum 4 pods simultanément pendant la transition
- Déploiement plus rapide qu'avec `maxUnavailable: 0` car pas besoin d'attendre un pod supplémentaire avant de commencer

---

### Comparatif des trois options

| Stratégie | Downtime | Vitesse | Ressources extra | Cas d'usage |
|---|---|---|---|---|
| `maxUnavailable: 0 / maxSurge: 1` | Zéro | Lent | Oui (pod en plus) | Staging (1 replica) |
| `maxUnavailable: 1 / maxSurge: 1` | Non (si replicas ≥ 2) | Équilibré | Léger | **Production** |
| `maxUnavailable: 1 / maxSurge: 0` | Possible | Rapide | Non | Ressources très limitées |

---

### Prouver le rolling update à l'oral

```bash
# Lancer un update et surveiller en live
kubectl set image deployment/taskflow-backend \
  backend=ghcr.io/taskflow/backend:1.1.0 \
  -n taskflow-production

kubectl rollout status deployment/taskflow-backend -n taskflow-production
# → Waiting for rollout to finish: 1 out of 3 new replicas have been updated...
# → deployment "taskflow-backend" successfully rolled out
```

---

## Choix 4 — Nombre de replicas : 1 staging / 3 production

### Choix retenu
**1 replica en staging, 3 replicas en production.**

---

### Justification staging (1 replica)

Le staging est un environnement de **validation interne**. Pas d'utilisateurs réels, pas besoin de haute disponibilité. 1 replica suffit, le coût en ressources est minimal et les logs sont clairs (un seul pod à surveiller).

---

### Justification production (3 replicas)

3 replicas permet d'absorber la charge, de survivre au crash d'un pod sans interruption, et de combiner avec le `PodDisruptionBudget` qui garantit qu'au moins 1 pod reste `Running` en toutes circonstances (maintenance, drain de nœud, rolling update).

Le Service Kubernetes répartit automatiquement le trafic entre les 3 replicas en round-robin.

---

### Résumé global des deux choix combinés

| Paramètre | Staging | Production |
|---|---|---|
| `replicas` | 1 | 3 |
| `maxUnavailable` | 0 | 1 |
| `maxSurge` | 1 | 1 |
| Downtime possible | Non | Non |
| PodDisruptionBudget | Non | Oui (minAvailable: 1) |
| HPA | Non | Oui (2 à 6 replicas, CPU > 50%) |
