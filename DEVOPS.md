# DEVOPS.md — Choix d'architecture Kubernetes

## Choix 1 — Image de base du backend
 
Deux images testées :
 
| Image | Taille (docker images) | CVE CRITICAL | CVE HIGH |
|---|---|---|---|
| `node:18-alpine` | ~210MB | 2 | 5 |
| `node:20-alpine` | 199MB | 0 | 0 |
 
**Image retenue : `node:20-alpine`**
 
node:20-alpine est plus légère et ne présente aucune CVE, confirmé par le scan Trivy sur l'image finale `jayards/taskflow-backend:v1.0.1` (0 vulnérabilité sur alpine 3.23.4 et sur l'ensemble des dépendances npm). La version 20 est la LTS active — node:18 entre en fin de maintenance. L'image alpine réduit drastiquement la surface d'attaque par rapport à une image Debian complète (node:18 complète dépasse 1GB). L'image finale fait 199MB, sous la limite des 200MB fixée.
 
---
 
## Choix 2 — Politique de redémarrage dans Compose
 
**Politique retenue : `unless-stopped`** sur les 3 services (frontend, backend, cache).
 
| Option | Comportement si crash à 3h du matin | Verdict |
|---|---|---|
| `unless-stopped` | Redémarre automatiquement ✅ | Retenu |
| `on-failure` | Redémarre uniquement si exit code != 0 — ne couvre pas tous les crashes | Trop restrictif |
| `always` | Redémarre même après un `docker stop` manuel — impossible d'arrêter proprement | Trop agressif |
 
`unless-stopped` est le bon équilibre : l'app se relève seule en cas de crash sans bloquer les opérations de maintenance volontaires.

---

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

## Trivy — Résultats et gestion
 
Scan effectué sur `jayards/taskflow-backend:v1.0.1` (alpine 3.23.4) via le pipeline CI/CD.
 
| Cible | Type | CVE détectées |
|---|---|---|
| alpine 3.23.4 (OS) | alpine | 0 |
| Dépendances npm (app/) | node-pkg | 0 |
| Dépendances npm (npm interne) | node-pkg | 0 |
 
**Résultat : 0 vulnérabilité détectée** sur l'ensemble de l'image — OS et dépendances applicatives inclus.
 
Le choix de `node:20-alpine` combiné à `npm ci --only=production` (dépendances de prod uniquement dans l'image finale) explique ce résultat propre. Le rapport complet est disponible en artefact dans GitHub Actions.
 
---

## Difficulté rencontrée
 
**Problème :** Les tests échouaient en CI avec l'erreur `Redis error: connect ECONNREFUSED 127.0.0.1:6379`. En local tout fonctionnait car Redis tournait via Docker Compose, mais dans GitHub Actions aucun Redis n'était disponible.
 
**Solution :** Ajout d'un bloc `services` dans le job `test` du pipeline pour démarrer un container `redis:7-alpine` directement dans le runner GitHub Actions, avec un healthcheck `redis-cli ping` pour s'assurer que Redis est prêt avant l'exécution des tests.
