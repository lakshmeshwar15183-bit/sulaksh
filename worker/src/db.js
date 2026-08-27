// D1 (SQLite) data layer — thin wrapper matching the old better-sqlite3 API.
// D1 column names come back as-is (snake_case), which is what the frontend
// already expects.

// Run a statement that returns rows: SELECT ... returns { results }.
async function all(env, sql, ...args) {
  const stmt = env.DB.prepare(sql);
  const out = args.length ? stmt.bind(...args) : stmt;
  const res = await out.all();
  return res.results;
}

// First row or null.
async function get(env, sql, ...args) {
  const rows = await all(env, sql, ...args);
  return rows.length ? rows[0] : null;
}

// Single scalar value or null.
async function raw(env, sql, ...args) {
  const row = await get(env, sql, ...args);
  if (!row) return null;
  const keys = Object.keys(row);
  return row[keys[0]];
}

// Statement returning no rows (INSERT/UPDATE/DELETE).
async function run(env, sql, ...args) {
  const stmt = env.DB.prepare(sql);
  const out = args.length ? stmt.bind(...args) : stmt;
  await out.run();
}

// A single scalar from a SELECT returning one column.
async function count(env, sql, ...args) {
  return (await raw(env, sql, ...args)) || 0;
}

async function getSetting(env, key) {
  return raw(env, 'SELECT value FROM settings WHERE key = ?', key);
}

async function setSetting(env, key, value) {
  await run(
    env,
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    key, String(value)
  );
}

async function logAuthEvent(env, email, event, ok, ip, userAgent) {
  try {
    await run(
      env,
      'INSERT INTO auth_log (at, email, event, ok, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?)',
      new Date().toISOString(), email || null, event, ok ? 1 : 0, ip || null, userAgent || null
    );
  } catch (_) {
    // Audit logging must never break a request.
  }
}

export { all, get, raw, run, count, getSetting, setSetting, logAuthEvent };