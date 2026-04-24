const API = window.API_URL || "http://localhost:3001";
let allTasks = [];
let currentFilter = "all";
let token = localStorage.getItem("tf_token") || null;
let currentUser = localStorage.getItem("tf_user") || null;

function authHeaders() {
  return token
    ? { "Content-Type": "application/json", "Authorization": `Bearer ${token}` }
    : { "Content-Type": "application/json" };
}

// ============= FETCH FUNCTIONS =============
async function fetchHealth() {
  try {
    const response = await fetch(`${API}/health`);
    const data = await response.json();
    const badge = document.getElementById("status-badge");
    badge.textContent = `✅ ${data.env} · v${data.version} · Redis ${data.redis}`;
    badge.className = "status-ok";
    document.getElementById("version-info").textContent =
      `TaskFlow v${data.version} · ${data.stats.totalCreated} créées, ${data.stats.totalCompleted} terminées`;
  } catch {
    const badge = document.getElementById("status-badge");
    badge.textContent = "❌ API indisponible";
    badge.className = "status-err";
  }
}

async function fetchTasks() {
  try {
    const response = await fetch(`${API}/tasks`, { headers: authHeaders() });
    if (response.status === 401) { showAuth(); return; }
    const data = await response.json();
    allTasks = data.tasks || [];
    renderBoard();
  } catch (error) {
    console.error("Erreur lors du chargement des tâches:", error);
  }
}

// ============= FILTER FUNCTIONS =============
function setFilter(filter, buttonElement) {
  currentFilter = filter;
  document.querySelectorAll(".filter-btn").forEach(btn => btn.classList.remove("active"));
  buttonElement.classList.add("active");
  renderBoard();
}

function getFilteredTasks() {
  if (currentFilter === "all") return allTasks;
  return allTasks.filter(task => task.priority === currentFilter);
}

// ============= RENDER FUNCTIONS =============
function renderBoard() {
  const filteredTasks = getFilteredTasks();
  const todoTasks = filteredTasks.filter(t => t.status === "todo");
  const inProgressTasks = filteredTasks.filter(t => t.status === "in-progress");
  const doneTasks = filteredTasks.filter(t => t.status === "done");

  // Update counts
  document.getElementById("count-todo").textContent = todoTasks.length;
  document.getElementById("count-inprogress").textContent = inProgressTasks.length;
  document.getElementById("count-done").textContent = doneTasks.length;
  document.getElementById("task-count").textContent = `${filteredTasks.length} tâche(s)`;

  // Update stats (global, not filtered)
  document.getElementById("stat-todo").textContent = allTasks.filter(t => t.status === "todo").length;
  document.getElementById("stat-inprogress").textContent = allTasks.filter(t => t.status === "in-progress").length;
  document.getElementById("stat-done").textContent = allTasks.filter(t => t.status === "done").length;
  document.getElementById("stat-total").textContent = allTasks.length;

  // Render columns
  document.getElementById("col-todo").innerHTML = todoTasks.map(createTaskCard).join("") || createEmptyState();
  document.getElementById("col-inprogress").innerHTML = inProgressTasks.map(createTaskCard).join("") || createEmptyState();
  document.getElementById("col-done").innerHTML = doneTasks.map(createTaskCard).join("") || createEmptyState();
}

function createTaskCard(task) {
  const priorityLabels = { low: "Basse", medium: "Moyenne", high: "Haute" };
  const priorityLabel = priorityLabels[task.priority] || task.priority;

  return `
    <div class="task-card prio-${task.priority}" id="task-${task.id}">
      <div class="task-title">${escapeHtml(task.title)}</div>
      ${task.description ? `<div class="task-desc">${escapeHtml(task.description)}</div>` : ""}
      <div class="task-footer">
        <span class="prio-badge">${priorityLabel}</span>
        <select class="status-select" onchange="changeStatus('${task.id}', this.value)">
          <option value="todo" ${task.status === "todo" ? "selected" : ""}>À faire</option>
          <option value="in-progress" ${task.status === "in-progress" ? "selected" : ""}>En cours</option>
          <option value="done" ${task.status === "done" ? "selected" : ""}>Terminé</option>
        </select>
        <button class="btn-icon btn-del" onclick="deleteTask('${task.id}')" title="Supprimer">✕</button>
      </div>
    </div>
  `;
}

function createEmptyState() {
  return `
    <div class="empty">
      <div class="empty-icon">○</div>
      <div>Aucune tâche</div>
    </div>
  `;
}

// ============= TASK OPERATIONS =============
async function addTask() {
  const titleInput = document.getElementById("input-title");
  const descInput = document.getElementById("input-desc");
  const prioSelect = document.getElementById("input-prio");

  const title = titleInput.value.trim();
  const description = descInput.value.trim();
  const priority = prioSelect.value;

  if (!title) {
    titleInput.focus();
    return;
  }

  try {
    const res = await fetch(`${API}/tasks`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ title, description, priority })
    });
    if (res.status === 401) { showAuth(); return; }

    titleInput.value = "";
    descInput.value = "";
    fetchTasks();
    fetchHealth();
    fetchStats();
  } catch (error) {
    console.error("Erreur lors de l'ajout de la tâche:", error);
  }
}

async function changeStatus(taskId, newStatus) {
  try {
    const res = await fetch(`${API}/tasks/${taskId}`, {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify({ status: newStatus })
    });
    if (res.status === 401) { showAuth(); return; }
    fetchTasks();
    fetchHealth();
    fetchStats();
  } catch (error) {
    console.error("Erreur lors de la mise à jour du statut:", error);
  }
}

async function deleteTask(taskId) {
  if (confirm("Supprimer cette tâche ?")) {
    try {
      const res = await fetch(`${API}/tasks/${taskId}`, {
        method: "DELETE",
        headers: authHeaders()
      });
      if (res.status === 401) { showAuth(); return; }
      fetchTasks();
      fetchStats();
    } catch (error) {
      console.error("Erreur lors de la suppression:", error);
    }
  }
}

// ============= AUTH =============
async function login() {
  const username = document.getElementById("auth-username").value.trim();
  const password = document.getElementById("auth-password").value;
  if (!username || !password) return;
  try {
    const res = await fetch(`${API}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (!res.ok) { document.getElementById("auth-error").textContent = data.error || "Erreur"; return; }
    token = data.token;
    currentUser = data.username;
    localStorage.setItem("tf_token", token);
    localStorage.setItem("tf_user", currentUser);
    document.getElementById("auth-error").textContent = "";
    document.getElementById("auth-password").value = "";
    showBoard();
    fetchHealth();
    fetchTasks();
    fetchStats();
  } catch { document.getElementById("auth-error").textContent = "Erreur de connexion"; }
}

async function register() {
  const username = document.getElementById("auth-username").value.trim();
  const password = document.getElementById("auth-password").value;
  if (!username || !password) return;
  try {
    const res = await fetch(`${API}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (!res.ok) { document.getElementById("auth-error").textContent = data.error || "Erreur"; return; }
    await login();
  } catch { document.getElementById("auth-error").textContent = "Erreur lors de l'inscription"; }
}

function logout() {
  token = null;
  currentUser = null;
  localStorage.removeItem("tf_token");
  localStorage.removeItem("tf_user");
  allTasks = [];
  showAuth();
}

function showBoard() {
  document.getElementById("auth-section").style.display = "none";
  document.getElementById("board-section").style.display = "block";
  document.getElementById("current-user").textContent = currentUser || "";
  document.getElementById("btn-logout").style.display = "inline-flex";
}

function showAuth() {
  document.getElementById("auth-section").style.display = "flex";
  document.getElementById("board-section").style.display = "none";
  document.getElementById("current-user").textContent = "";
  document.getElementById("btn-logout").style.display = "none";
}

// ============= STATS =============
async function fetchStats() {
  try {
    const response = await fetch(`${API}/stats`);
    const data = await response.json();
    document.getElementById("stat-completion").textContent = `${data.completionRate}%`;
  } catch {
    document.getElementById("stat-completion").textContent = "—";
  }
}

// ============= UTILITIES =============
function escapeHtml(text) {
  const map = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  };
  return text.replace(/[&<>"']/g, char => map[char]);
}

// ============= EVENT LISTENERS =============
document.getElementById("input-title").addEventListener("keypress", (event) => {
  if (event.key === "Enter") {
    addTask();
  }
});

// ============= INITIALIZATION =============
document.getElementById("auth-username").addEventListener("keypress", (e) => {
  if (e.key === "Enter") login();
});
document.getElementById("auth-password").addEventListener("keypress", (e) => {
  if (e.key === "Enter") login();
});

if (token) {
  showBoard();
  fetchHealth();
  fetchTasks();
  fetchStats();
} else {
  showAuth();
  fetchHealth();
}
setInterval(fetchHealth, 30000);
setInterval(fetchStats, 30000);
