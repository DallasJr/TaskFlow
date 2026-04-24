# Partie 3 — Déploiement Kubernetes + Bonus

TaskFlow tourne sur deux namespaces distincts : **staging** et **production**, avec monitoring Prometheus/Grafana et Ingress nginx.

## Structure complète

```
k8s/
├── staging/
│   ├── namespace.yml       → namespace taskflow-staging
│   ├── configmap.yml       → variables non sensibles (APP_ENV, PORT, REDIS_URL)
│   ├── secret.yml          → variables sensibles en base64 (APP_NAME, CLE_API)
│   ├── deployment.yml      → backend (1 replica) + frontend (1 replica) + redis
│   ├── service.yml         → ClusterIP (backend, redis) + NodePort (frontend)
│   ├── ingress.yml         → /api → backend, / → frontend (host: taskflow.staging.local)
│   └── networkpolicy.yml   → Redis accessible uniquement depuis le backend
│
├── production/
│   ├── namespace.yml
│   ├── configmap.yml       → APP_ENV=production
│   ├── secret.yml
│   ├── deployment.yml      → backend (3 replicas) + frontend (3 replicas) + redis + PVC
│   ├── service.yml
│   ├── ingress.yml         → host: taskflow.prod.local
│   ├── networkpolicy.yml
│   ├── hpa.yml             → autoscaling 2 à 6 replicas si CPU > 50%
│   └── pdb.yml             → garantit min 1 pod backend + frontend pendant maintenance
│
└── monitoring/             ← Bonus C
    ├── namespace.yml       → namespace monitoring
    ├── prometheus.yml      → scrape CPU/mémoire des pods via cAdvisor + kubelet
    └── grafana.yml         → dashboard "TaskFlow - Pods CPU et Mémoire" (provisionné auto)
```

---

## Bonus A — GET /stats

Route ajoutée sur le backend :
```
GET /stats → { total, todo, inProgress, done, completionRate }
```
Appelée depuis le frontend toutes les 30s — affichée dans la barre de stats en haut du board.

---

## Bonus B — JWT Auth

Le backend protège toutes les routes `/tasks` avec un token JWT signé.

**Nouvelles routes :**
```
POST /auth/register   → crée un compte (username + password hashé bcrypt)
POST /auth/login      → retourne un token JWT valide 24h
```

**Utilisation :**
```
Authorization: Bearer <token>   ← header requis sur GET/POST/PUT/DELETE /tasks
```

Token stocké dans `localStorage` côté frontend — écran de connexion affiché si absent.

---

## Bonus C — Monitoring Prometheus + Grafana

### Déployer

```bash
kubectl apply -f k8s/monitoring/namespace.yml
kubectl apply -f k8s/monitoring/prometheus.yml
kubectl apply -f k8s/monitoring/grafana.yml
```

### Accéder (via port-forward car cluster kind)

```bash
kubectl port-forward svc/prometheus 9090:9090 -n monitoring
kubectl port-forward svc/grafana 3000:3000 -n monitoring
```

- **Prometheus** → http://localhost:9090
- **Grafana** → http://localhost:3000 — `admin` / `admin`
  - Dashboard : **Dashboards → TaskFlow → TaskFlow - Pods CPU et Mémoire**

### kubectl top (metrics-server requis)

```bash
# metrics-server installé + patché pour Docker Desktop :
kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml
kubectl patch deployment metrics-server -n kube-system ...  # --kubelet-insecure-tls

kubectl top nodes
kubectl top pods -A
```

### Requêtes Prometheus utiles

```promql
# CPU par pod
sum(rate(container_cpu_usage_seconds_total{container!=""}[5m])) by (pod)

# Mémoire par pod (MB)
sum(container_memory_working_set_bytes{container!=""}) by (pod) / 1048576
```

---

## Bonus D — Ingress nginx

### Prérequis : installer le contrôleur ingress

```bash
# Installer l'ingress controller pour kind/Docker Desktop
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/controller-v1.12.1/deploy/static/provider/kind/deploy.yaml

# Labelliser le node (requis pour kind)
kubectl label node desktop-control-plane ingress-ready=true

# Attendre qu'il soit prêt
kubectl wait --namespace ingress-nginx --for=condition=ready pod \
  --selector=app.kubernetes.io/component=controller --timeout=120s
```

### Déployer staging avec ingress

```bash
kubectl apply -f k8s/staging/namespace.yml
kubectl apply -f k8s/staging/configmap.yml
kubectl apply -f k8s/staging/secret.yml
kubectl apply -f k8s/staging/deployment.yml
kubectl apply -f k8s/staging/service.yml
kubectl apply -f k8s/staging/ingress.yml
```

### Accéder à l'app via l'ingress

```bash
# Port-forward du contrôleur ingress
kubectl port-forward svc/ingress-nginx-controller 8080:80 -n ingress-nginx
```

Ajouter dans `C:\Windows\System32\drivers\etc\hosts` (Notepad en admin) :
```
127.0.0.1 taskflow.staging.local
```

Ensuite : **http://taskflow.staging.local:8080**

Ou tester sans modifier le fichier hosts :
```bash
# Frontend
curl http://localhost:8080/ -H "Host: taskflow.staging.local"

# Backend
curl http://localhost:8080/api/health -H "Host: taskflow.staging.local"
```

### Routing configuré

| Chemin | Destination              |
|--------|--------------------------|
| `/`    | frontend-service:80      |
| `/api` | backend-service:3001     |

L'annotation `nginx.ingress.kubernetes.io/rewrite-target: /$2` supprime le préfixe `/api` avant de transmettre au backend.

---

## Déploiement complet (ordre à respecter)

```bash
# 1. Builder les images localement
docker build -t taskflow-backend:latest ./backend
docker build -t taskflow-frontend:latest ./frontend
docker pull redis:7-alpine

# 2. Installer ingress controller + metrics-server (une seule fois)
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/controller-v1.12.1/deploy/static/provider/kind/deploy.yaml
kubectl label node desktop-control-plane ingress-ready=true
kubectl wait --namespace ingress-nginx --for=condition=ready pod --selector=app.kubernetes.io/component=controller --timeout=120s

# 3. Déployer staging
kubectl apply -f k8s/staging/namespace.yml
kubectl apply -f k8s/staging/

# 4. Déployer production
kubectl apply -f k8s/production/namespace.yml
kubectl apply -f k8s/production/

# 5. Déployer monitoring
kubectl apply -f k8s/monitoring/namespace.yml
kubectl apply -f k8s/monitoring/

# 6. Port-forwards
kubectl port-forward svc/ingress-nginx-controller 8080:80 -n ingress-nginx &
kubectl port-forward svc/prometheus 9090:9090 -n monitoring &
kubectl port-forward svc/grafana 3000:3000 -n monitoring &
```

---

## Commandes utiles

```bash
# État des pods par namespace
kubectl get pods -n taskflow-staging
kubectl get pods -n taskflow-production
kubectl get pods -n monitoring
kubectl get pods -n ingress-nginx

# Voir les ingress
kubectl get ingress -A

# Voir l'autoscaling (HPA)
kubectl get hpa -n taskflow-production

# Self-healing : tuer un pod et regarder K8s le recréer
kubectl delete pod <nom-pod> -n taskflow-production
kubectl get pods -n taskflow-production -w

# Rolling update
kubectl set image deployment/taskflow-backend backend=taskflow-backend:v2 -n taskflow-production
kubectl rollout status deployment/taskflow-backend -n taskflow-production

# Rollback
kubectl rollout undo deployment/taskflow-backend -n taskflow-production

# Nettoyer
kubectl delete namespace taskflow-staging
kubectl delete namespace taskflow-production
kubectl delete namespace monitoring
```