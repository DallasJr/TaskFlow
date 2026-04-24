const http   = require("http");
const redis  = require("redis");
const crypto = require("crypto");
const jwt    = require("jsonwebtoken");
const bcrypt = require("bcryptjs");

try { require("dotenv").config(); } catch { /* dotenv optionnel */ }

const PORT        = process.env.PORT        || 3001;
const APP_ENV     = process.env.APP_ENV     || "development";
const APP_VERSION = process.env.APP_VERSION || "1.0.0";
const REDIS_URL   = process.env.REDIS_URL   || "redis://127.0.0.1:6379";
const JWT_SECRET  = process.env.JWT_SECRET  || "taskflow-dev-secret-change-in-prod";

const client = redis.createClient({ url: REDIS_URL });
client.on("error", (err) => console.error("Redis error:", err.message));

// ── Utilitaires ──────────────────────────────────────────────────────

function genId() {
  return crypto.randomBytes(6).toString("hex");
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch { reject(new Error("JSON invalide")); }
    });
  });
}

function json(res, status, data) {
  res.writeHead(status, {
    "Content-Type":                "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods":"GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers":"Content-Type, Authorization",
    "X-App-Version":               APP_VERSION,
    "X-App-Env":                   APP_ENV,
  });
  res.end(JSON.stringify(data));
}

const VALID_STATUSES   = ["todo", "in-progress", "done"];
const VALID_PRIORITIES = ["low", "medium", "high"];

// ── Auth utilisateurs ───────────────────────────────────────────────

function verifyToken(req) {
  const auth = req.headers["authorization"] || "";
  if (!auth.startsWith("Bearer ")) return null;
  try { return jwt.verify(auth.slice(7), JWT_SECRET); }
  catch { return null; }
}

async function registerUser(username, password) {
  if (!/^[a-zA-Z0-9_]{3,30}$/.test(username)) {
    throw new Error("Username invalide (3-30 caractères alphanumériques)");
  }
  const exists = await client.exists(`user:${username}`);
  if (exists) throw new Error("Nom d'utilisateur déjà pris");
  const hash = await bcrypt.hash(password, 10);
  await client.hSet(`user:${username}`, { username, password: hash });
  return { username };
}

async function loginUser(username, password) {
  const user = await client.hGetAll(`user:${username}`);
  if (!user.username) throw new Error("Identifiants incorrects");
  const valid = await bcrypt.compare(password, user.password);
  if (!valid) throw new Error("Identifiants incorrects");
  const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: "24h" });
  return { token, username };
}

// ── Logique tâches ───────────────────────────────────────────────────

async function getTasks() {
  const keys = await client.keys("task:*");
  if (!keys.length) return [];
  const tasks = await Promise.all(
    keys.map(async (k) => {
      const t = await client.hGetAll(k);
      return {
        id:          k.replace("task:", ""),
        title:       t.title,
        description: t.description || "",
        status:      t.status      || "todo",
        priority:    t.priority    || "medium",
        createdAt:   t.createdAt,
        updatedAt:   t.updatedAt   || t.createdAt,
      };
    })
  );
  return tasks.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

async function getTask(id) {
  const t = await client.hGetAll(`task:${id}`);
  if (!t.title) return null;
  return { id, ...t };
}

async function createTask({ title, description, priority }) {
  if (!title?.trim()) throw new Error("Le titre est requis");
  if (priority && !VALID_PRIORITIES.includes(priority)) {
    throw new Error("Priorité invalide : low, medium ou high");
  }
  const id  = genId();
  const now = new Date().toISOString();
  await client.hSet(`task:${id}`, {
    title:       title.trim(),
    description: description?.trim() || "",
    status:      "todo",
    priority:    priority || "medium",
    createdAt:   now,
    updatedAt:   now,
  });
  await client.incr("stats:total_created");
  return { id, title: title.trim(), description: description?.trim() || "", status: "todo", priority: priority || "medium", createdAt: now };
}

async function updateTask(id, { title, description, status, priority }) {
  const exists = await client.exists(`task:${id}`);
  if (!exists) return null;
  if (status   && !VALID_STATUSES.includes(status))   throw new Error("Statut invalide : todo, in-progress ou done");
  if (priority && !VALID_PRIORITIES.includes(priority)) throw new Error("Priorité invalide : low, medium ou high");
  const now     = new Date().toISOString();
  const updates = { updatedAt: now };
  if (title       !== undefined) updates.title       = title.trim();
  if (description !== undefined) updates.description = description.trim();
  if (status      !== undefined) {
    updates.status = status;
    if (status === "done") await client.incr("stats:total_completed");
  }
  if (priority !== undefined) updates.priority = priority;
  await client.hSet(`task:${id}`, updates);
  return getTask(id);
}

async function deleteTask(id) {
  const deleted = await client.del(`task:${id}`);
  return deleted > 0;
}

// ── Serveur HTTP ─────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin":  "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    });
    res.end();
    return;
  }

  const url = req.url.split("?")[0];

  // POST /auth/register
  if (req.method === "POST" && url === "/auth/register") {
    try {
      const { username, password } = await parseBody(req);
      if (!username?.trim() || !password) throw new Error("Username et password requis");
      if (password.length < 6) throw new Error("Mot de passe trop court (6 caractères minimum)");
      const user = await registerUser(username.trim(), password);
      json(res, 201, { message: "Compte créé", username: user.username });
    } catch (e) { json(res, 400, { error: e.message }); }
    return;
  }

  // POST /auth/login
  if (req.method === "POST" && url === "/auth/login") {
    try {
      const { username, password } = await parseBody(req);
      if (!username?.trim() || !password) throw new Error("Username et password requis");
      const result = await loginUser(username.trim(), password);
      json(res, 200, result);
    } catch (e) { json(res, 401, { error: e.message }); }
    return;
  }

  // GET /health
  if (req.method === "GET" && url === "/health") {
    const totalCreated   = await client.get("stats:total_created").catch(() => "0");
    const totalCompleted = await client.get("stats:total_completed").catch(() => "0");
    json(res, 200, {
      status:  "ok",
      env:     APP_ENV,
      version: APP_VERSION,
      redis:   "connected",
      stats: {
        totalCreated:   parseInt(totalCreated   || "0"),
        totalCompleted: parseInt(totalCompleted || "0"),
      },
    });
    return;
  }

  // GET /stats
  if (req.method === "GET" && url === "/stats") {
    const tasks = await getTasks();
    const total      = tasks.length;
    const todo       = tasks.filter(t => t.status === "todo").length;
    const inProgress = tasks.filter(t => t.status === "in-progress").length;
    const done       = tasks.filter(t => t.status === "done").length;
    const completionRate = total > 0 ? Math.round((done / total) * 100) : 0;
    json(res, 200, { total, todo, inProgress, done, completionRate });
    return;
  }

  // GET /tasks
  if (req.method === "GET" && url === "/tasks") {
    if (!verifyToken(req)) { json(res, 401, { error: "Token manquant ou invalide" }); return; }
    const tasks = await getTasks();
    json(res, 200, { total: tasks.length, tasks });
    return;
  }

  // POST /tasks
  if (req.method === "POST" && url === "/tasks") {
    if (!verifyToken(req)) { json(res, 401, { error: "Token manquant ou invalide" }); return; }
    try {
      const body = await parseBody(req);
      const task = await createTask(body);
      json(res, 201, task);
    } catch (e) { json(res, 400, { error: e.message }); }
    return;
  }

  // PUT /tasks/:id
  const matchPut = url.match(/^\/tasks\/([a-f0-9]{12})$/);
  if (req.method === "PUT" && matchPut) {
    if (!verifyToken(req)) { json(res, 401, { error: "Token manquant ou invalide" }); return; }
    try {
      const body = await parseBody(req);
      const task = await updateTask(matchPut[1], body);
      if (!task) { json(res, 404, { error: "Tâche introuvable" }); return; }
      json(res, 200, task);
    } catch (e) { json(res, 400, { error: e.message }); }
    return;
  }

  // DELETE /tasks/:id
  const matchDel = url.match(/^\/tasks\/([a-f0-9]{12})$/);
  if (req.method === "DELETE" && matchDel) {
    if (!verifyToken(req)) { json(res, 401, { error: "Token manquant ou invalide" }); return; }
    const deleted = await deleteTask(matchDel[1]);
    if (!deleted) { json(res, 404, { error: "Tâche introuvable" }); return; }
    json(res, 200, { message: "Tâche supprimée" });
    return;
  }

  json(res, 404, { error: "Route introuvable" });
});

// ── Démarrage ────────────────────────────────────────────────────────

client.connect().then(() => {
  console.log(`Redis connecté sur ${REDIS_URL}`);
  server.listen(PORT, () => {
    console.log(`TaskFlow API — env: ${APP_ENV}, version: ${APP_VERSION}, port: ${PORT}`);
  });
}).catch((err) => {
  console.error("Impossible de démarrer:", err.message);
  process.exit(1);
});

module.exports = { server, genId, VALID_STATUSES, VALID_PRIORITIES };
