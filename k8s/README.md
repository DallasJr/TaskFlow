# Partie 3 — Déploiement Kubernetes

TaskFlow tourne sur deux namespaces distincts : **staging** et **production**.

## Structure

```
k8s/
├── staging/
│   ├── namespace.yml       → namespace taskflow-staging
│   ├── configmap.yml       → variables non sensibles (APP_ENV, PORT, REDIS_URL)
│   ├── secret.yml          → variables sensibles encodées en base64 (APP_NAME, CLE_API)
│   ├── deployment.yml      → backend (1 replica) + frontend (1 replica) + redis
│   ├── service.yml         → exposition des pods (ClusterIP / NodePort)
│   ├── ingress.yml         → routing HTTP : /api → backend, / → frontend
│   └── networkpolicy.yml   → Redis accessible uniquement depuis le backend
│
└── production/
    ├── namespace.yml
    ├── configmap.yml       → APP_ENV=production
    ├── secret.yml
    ├── deployment.yml      → backend (3 replicas) + frontend (3 replicas) + redis + PVC
    ├── service.yml
    ├── ingress.yml         → host: taskflow.prod.local
    ├── networkpolicy.yml
    ├── hpa.yml             → autoscaling 2 à 6 replicas si CPU > 50%
    └── pdb.yml             → garantit min 1 pod backend + frontend pendant maintenance
```

## Prérequis

- Docker Desktop avec **Kubernetes activé** (Settings → Kubernetes → Enable Kubernetes)
- `kubectl` installé

Vérifier que le cluster répond :
```bash
kubectl cluster-info
```

## Builder les images

```bash
docker build -t ghcr.io/taskflow/backend:latest ./backend
docker build -t ghcr.io/taskflow/frontend:latest ./frontend
docker pull redis:7-alpine
```

## Déployer

### Staging
```bash
kubectl apply -f k8s/staging/namespace.yml
kubectl apply -f k8s/staging/
```

### Production
```bash
kubectl apply -f k8s/production/namespace.yml
kubectl apply -f k8s/production/
```

## Commandes utiles

```bash
# Voir les pods
kubectl get pods -n taskflow-staging
kubectl get pods -n taskflow-production

# Voir les services
kubectl get svc -n taskflow-staging

# Accéder au frontend en local
kubectl port-forward svc/frontend-service 8080:80 -n taskflow-staging
# → http://localhost:8080

# Voir les logs d'un pod
kubectl logs <nom-du-pod> -n taskflow-staging

# Décrire un pod (debug)
kubectl describe pod <nom-du-pod> -n taskflow-staging
```

## Démonstrations à l'oral

### Self-healing — Kubernetes recrée automatiquement un pod supprimé
```bash
kubectl delete pod <nom-du-pod> -n taskflow-production
kubectl get pods -n taskflow-production -w
# → le pod repart automatiquement
```

### Rolling update sans interruption
```bash
kubectl set image deployment/taskflow-backend \
  backend=ghcr.io/taskflow/backend:1.1.0 \
  -n taskflow-production

kubectl rollout status deployment/taskflow-backend -n taskflow-production
```

### Rollback en une commande
```bash
kubectl rollout undo deployment/taskflow-backend -n taskflow-production
```

## Différences staging vs production

| | Staging | Production |
|---|---|---|
| Replicas backend/frontend | 1 | 3 |
| Image tag | `latest` (merge main) | `1.0.0` (tag git) |
| Redis storage | emptyDir (éphémère) | PersistentVolumeClaim 1Gi |
| Autoscaling (HPA) | non | 2 à 6 replicas si CPU > 50% |
| PodDisruptionBudget | non | min 1 pod toujours disponible |
| Déclenchement CI/CD | merge sur `main` | push d'un tag git |

## Supprimer les environnements

```bash
kubectl delete namespace taskflow-staging
kubectl delete namespace taskflow-production
```
