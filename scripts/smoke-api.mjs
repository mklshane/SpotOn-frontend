/**
 * API smoke test — verifies the frontend can reach the SpotOn backend and that
 * the directory endpoints return the shapes declared in src/api/types.ts.
 *
 * Uses the SAME base URL the app uses (EXPO_PUBLIC_API_BASE_URL). Resolution
 * order: CLI arg > process.env > .env file > http://localhost:8000.
 *
 *   node scripts/smoke-api.mjs                       # uses .env (Render or local)
 *   node scripts/smoke-api.mjs http://localhost:8000 # override target
 *
 * Exits non-zero if any check fails, so it's CI/pre-push friendly.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

function resolveBaseUrl() {
  if (process.argv[2]) return process.argv[2];
  if (process.env.EXPO_PUBLIC_API_BASE_URL) return process.env.EXPO_PUBLIC_API_BASE_URL;
  try {
    const env = readFileSync(join(__dirname, "..", ".env"), "utf8");
    const m = env.match(/^\s*EXPO_PUBLIC_API_BASE_URL\s*=\s*(.+)\s*$/m);
    if (m) return m[1].trim();
  } catch {
    /* no .env file */
  }
  return "http://localhost:8000";
}

const BASE = resolveBaseUrl().replace(/\/+$/, "");
// Free-tier Render can cold-start (~50s) after idle; give the first calls room.
const TIMEOUT_MS = 90_000;

let passed = 0;
let failed = 0;

function check(name, cond, detail = "") {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name}${detail ? `  — ${detail}` : ""}`);
  }
}

async function get(path) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: { Accept: "application/json" },
      signal: ctrl.signal,
    });
    const body = res.headers.get("content-type")?.includes("json")
      ? await res.json()
      : await res.text();
    return { status: res.status, body };
  } finally {
    clearTimeout(t);
  }
}

const isStr = (v) => typeof v === "string";
const isNum = (v) => typeof v === "number";
const isBool = (v) => typeof v === "boolean";
const strOrNull = (v) => v === null || isStr(v);
const numOrNull = (v) => v === null || isNum(v);

/** Validate one facility item against the FacilitySync contract. */
function validateFacility(f) {
  return (
    f &&
    isStr(f.id) &&
    isStr(f.name) &&
    isStr(f.type) &&
    isNum(f.latitude) &&
    isNum(f.longitude) &&
    Array.isArray(f.services) &&
    strOrNull(f.phone) &&
    numOrNull(f.google_rating)
  );
}

async function main() {
  console.log(`\nSpotOn API smoke test → ${BASE}\n`);

  // 1. Health
  console.log("Health");
  const health = await get("/health");
  check("GET /health → 200", health.status === 200, `got ${health.status}`);
  check("db reports up", health.body?.db === "up", JSON.stringify(health.body));

  // 2. Meta (controlled vocab)
  console.log("\nDirectory meta");
  const meta = await get("/directory/meta");
  check("GET /directory/meta → 200", meta.status === 200, `got ${meta.status}`);
  check("services[] non-empty", Array.isArray(meta.body?.services) && meta.body.services.length > 0);
  check("specialties[] non-empty", Array.isArray(meta.body?.specialties) && meta.body.specialties.length > 0);

  // 3. Facility name search
  console.log("\nFacility search (q=skin)");
  const search = await get("/directory/facilities?q=skin&limit=3");
  check("GET /directory/facilities → 200", search.status === 200, `got ${search.status}`);
  const items = search.body?.items ?? [];
  check("returns items[]", Array.isArray(items) && items.length > 0, `len ${items.length}`);
  check("pagination flag present", isBool(search.body?.has_more));
  check("item matches FacilitySync shape", items.length > 0 && validateFacility(items[0]),
    items[0] ? JSON.stringify(items[0]).slice(0, 120) : "no item");

  // 4. Geo search — distance_m computed + nearest-first ordering
  console.log("\nGeo search (Makati CBD, 3km radius)");
  const geo = await get("/directory/facilities?lat=14.5547&lng=121.0244&radius_m=3000&limit=5");
  check("GET geo → 200", geo.status === 200, `got ${geo.status}`);
  const g = geo.body?.items ?? [];
  check("returns nearby items", Array.isArray(g) && g.length > 0, `len ${g.length}`);
  check("distance_m is numeric", g.length > 0 && isNum(g[0]?.distance_m), `got ${g[0]?.distance_m}`);
  const sorted = g.every((it, i) => i === 0 || it.distance_m >= g[i - 1].distance_m);
  check("ordered nearest-first", sorted);

  // 5. Doctor search
  console.log("\nDoctor search (q=derm)");
  const docs = await get("/directory/doctors?q=derm&limit=3");
  check("GET /directory/doctors → 200", docs.status === 200, `got ${docs.status}`);
  const d = docs.body?.items ?? [];
  check("returns doctors", Array.isArray(d) && d.length > 0, `len ${d.length}`);
  check("doctor has specialties[]", d.length > 0 && Array.isArray(d[0]?.specialties));

  console.log(`\n${failed === 0 ? "✅ PASS" : "❌ FAIL"} — ${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(`\n❌ Smoke test errored: ${err?.message || err}`);
  console.error(`   (target ${BASE} — is the backend reachable?)`);
  process.exit(1);
});
