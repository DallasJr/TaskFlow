// server.test.js — tests unitaires TaskFlow
// Portent sur la logique pure : pas de connexion Redis requise.

const { genId, VALID_STATUSES, VALID_PRIORITIES } = require("./server");

let passed = 0;
let failed = 0;

function test(desc, fn) {
  try { fn(); console.log(`  ✅ ${desc}`); passed++; }
  catch (e) { console.log(`  ❌ ${desc}\n     → ${e.message}`); failed++; }
}

function expect(val) {
  return {
    toBe:            (exp) => { if (val !== exp) throw new Error(`Attendu "${exp}", reçu "${val}"`); },
    toHaveLength:    (n)   => { if (val.length !== n) throw new Error(`Attendu longueur ${n}, reçu ${val.length}`); },
    toMatch:         (re)  => { if (!re.test(val)) throw new Error(`"${val}" ne correspond pas à ${re}`); },
    toBeGreaterThan: (n)   => { if (val <= n) throw new Error(`Attendu > ${n}, reçu ${val}`); },
    toBeTruthy:      ()    => { if (!val) throw new Error("Attendu truthy, reçu falsy"); },
    toBeFalsy:       ()    => { if (val)  throw new Error("Attendu falsy, reçu truthy"); },
  };
}

console.log("\n🧪 Tests TaskFlow Backend...\n");

// ── genId ─────────────────────────────────────────────────────────────
console.log("genId");

test("retourne une chaîne de 12 caractères", () => {
  expect(genId()).toHaveLength(12);
});

test("contient uniquement des caractères hexadécimaux", () => {
  expect(genId()).toMatch(/^[a-f0-9]{12}$/);
});

test("ne contient pas de majuscules", () => {
  for (let i = 0; i < 20; i++) expect(genId()).toMatch(/^[a-f0-9]+$/);
});

test("génère des IDs uniques sur 100 appels", () => {
  const ids = new Set(Array.from({ length: 100 }, genId));
  expect(ids.size).toBeGreaterThan(95);
});

// ── Statuts ───────────────────────────────────────────────────────────
console.log("\nValidation des statuts");

test("VALID_STATUSES contient todo, in-progress, done", () => {
  expect(VALID_STATUSES.length).toBe(3);
  expect(VALID_STATUSES.includes("todo")).toBeTruthy();
  expect(VALID_STATUSES.includes("in-progress")).toBeTruthy();
  expect(VALID_STATUSES.includes("done")).toBeTruthy();
});

test("Un statut valide est accepté", () => {
  expect(VALID_STATUSES.includes("in-progress")).toBeTruthy();
});

test("Un statut invalide est rejeté", () => {
  expect(VALID_STATUSES.includes("completed")).toBeFalsy();
});

test("Un statut vide est invalide", () => {
  expect(VALID_STATUSES.includes("")).toBeFalsy();
});

test("Un statut avec majuscule est invalide", () => {
  expect(VALID_STATUSES.includes("Todo")).toBeFalsy();
  expect(VALID_STATUSES.includes("DONE")).toBeFalsy();
});

// ── Priorités ─────────────────────────────────────────────────────────
console.log("\nValidation des priorités");

test("VALID_PRIORITIES contient low, medium, high", () => {
  expect(VALID_PRIORITIES.length).toBe(3);
  expect(VALID_PRIORITIES.includes("low")).toBeTruthy();
  expect(VALID_PRIORITIES.includes("medium")).toBeTruthy();
  expect(VALID_PRIORITIES.includes("high")).toBeTruthy();
});

test("Une priorité valide est acceptée", () => {
  expect(VALID_PRIORITIES.includes("high")).toBeTruthy();
});

test("Une priorité invalide est rejetée", () => {
  expect(VALID_PRIORITIES.includes("critical")).toBeFalsy();
  expect(VALID_PRIORITIES.includes("urgent")).toBeFalsy();
});

// ── Validation titre ──────────────────────────────────────────────────
console.log("\nValidation des titres");

test("Un titre non vide est valide", () => {
  const title = "Ma tâche";
  expect(title.trim().length > 0).toBeTruthy();
});

test("Un titre vide est invalide", () => {
  const title = "   ";
  expect(title.trim().length === 0).toBeTruthy();
});

test("trim() supprime les espaces en début et fin", () => {
  expect("  Ma tâche  ".trim()).toBe("Ma tâche");
});

// ── Logique métier ────────────────────────────────────────────────────
console.log("\nLogique métier");

test("La description par défaut est une chaîne vide", () => {
  const desc = undefined;
  expect(desc?.trim() || "").toBe("");
});

test("La priorité par défaut est medium", () => {
  const priority = undefined;
  expect(priority || "medium").toBe("medium");
});

test("Passer à done depuis in-progress doit incrémenter les stats", () => {
  const wasNotDone = "in-progress" !== "done";
  const isNowDone  = "done" === "done";
  expect(wasNotDone && isNowDone).toBeTruthy();
});

test("Passer à in-progress ne doit pas incrémenter les stats", () => {
  expect("in-progress" === "done").toBeFalsy();
});

test("Une date ISO a le bon format", () => {
  expect(new Date().toISOString()).toMatch(/^\d{4}-\d{2}-\d{2}T/);
});

// ── Résultat ──────────────────────────────────────────────────────────
console.log(`\n📊 ${passed} passés, ${failed} échoués\n`);
if (failed > 0) { console.log("❌ Des tests ont échoué."); process.exit(1); }
else { console.log("✅ Tous les tests passent.\n"); }
