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

## Démo live — Script complet

### 0. Vérifier que tout tourne avant de commencer
```bash
kubectl get pods -n taskflow-staging
kubectl get pods -n taskflow-production
# → tous les pods doivent être en STATUS "Running"
```

---

### 1. Montrer les deux namespaces et les pods
```bash
kubectl get namespaces | grep taskflow
kubectl get pods -n taskflow-staging
kubectl get pods -n taskflow-production
```

---

### 2. Montrer les services et l'accès à l'app
```bash
kubectl get svc -n taskflow-staging
kubectl port-forward svc/frontend-service 8080:80 -n taskflow-staging
# → ouvrir http://localhost:8080 dans le navigateur
# Ctrl+C pour arrêter le port-forward
```

---

### 3. Self-healing — tuer un pod en live

```bash
# Récupérer le nom exact du pod backend
kubectl get pods -n taskflow-production

# Supprimer le pod (remplacer <nom-du-pod> par le vrai nom)
kubectl delete pod <nom-du-pod> -n taskflow-production

# Surveiller la recréation automatique
kubectl get pods -n taskflow-production -w
# → le pod repasse à Running en quelques secondes tout seul
# Ctrl+C pour arrêter le watch
```

---

### 4. Rolling update sans interruption

```bash
# Changer la version de l'image du backend
kubectl set image deployment/taskflow-backend \
  backend=ghcr.io/taskflow/backend:1.1.0 \
  -n taskflow-production

# Surveiller le déploiement progressif
kubectl rollout status deployment/taskflow-backend -n taskflow-production
# → "Waiting for rollout to finish: 1 out of 3 new replicas have been updated..."
# → "deployment successfully rolled out"
```

---

### 5. Rollback en une commande

```bash
kubectl rollout undo deployment/taskflow-backend -n taskflow-production

# Vérifier que l'ancienne version est revenue
kubectl rollout status deployment/taskflow-backend -n taskflow-production
kubectl describe deployment taskflow-backend -n taskflow-production | Select-String "Image"
```

## Supprimer les environnements

```bash
kubectl delete namespace taskflow-staging
kubectl delete namespace taskflow-production
```
