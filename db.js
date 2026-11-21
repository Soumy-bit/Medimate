/**
 * SQLite Database Layer for MediMate Fullstack Application
 * Uses Node.js native DatabaseSync (node:sqlite)
 */

const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

const DB_PATH = path.join(__dirname, 'medimate.db');
const db = new DatabaseSync(DB_PATH);

// Enable WAL mode for high performance concurrent reads/writes
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

// Initialize database schema
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    picture TEXT,
    given_name TEXT,
    family_name TEXT,
    locale TEXT,
    provider TEXT DEFAULT 'google',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_login DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS user_settings (
    user_id TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT,
    PRIMARY KEY (user_id, key)
  );

  CREATE TABLE IF NOT EXISTS meds (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    dose TEXT,
    form TEXT,
    per_dose REAL DEFAULT 1,
    times TEXT,
    start_date TEXT,
    end_date TEXT,
    stock REAL,
    notes TEXT,
    color TEXT,
    user_id TEXT DEFAULT 'local',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS dose_logs (
    key TEXT PRIMARY KEY,
    date TEXT NOT NULL,
    med_id TEXT NOT NULL,
    time TEXT NOT NULL,
    status TEXT NOT NULL,
    taken_at INTEGER,
    user_id TEXT DEFAULT 'local',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS doctor_questions (
    id TEXT PRIMARY KEY,
    q TEXT NOT NULL,
    date TEXT,
    user_id TEXT DEFAULT 'local',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS blood_donors (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    bg TEXT NOT NULL,
    area TEXT,
    phone TEXT,
    last TEXT,
    user_id TEXT DEFAULT 'local',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS care_circle (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    rel TEXT,
    phone TEXT,
    active INTEGER DEFAULT 1,
    consent_at INTEGER,
    since INTEGER,
    delay INTEGER DEFAULT 60,
    share TEXT,
    user_id TEXT DEFAULT 'local',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS care_alerts (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    med_name TEXT,
    time TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS care_acks (
    key TEXT PRIMARY KEY,
    ack_by TEXT,
    ack_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS verified_checks (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS app_meta (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS price_quotes (
    id TEXT PRIMARY KEY,
    medicine_name TEXT,
    shop TEXT,
    pack_price REAL,
    units REAL,
    delivery_fee REAL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS medicine_reference (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    aliases TEXT,
    verified INTEGER DEFAULT 1,
    summary TEXT,
    used_for TEXT,
    warnings TEXT,
    details TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS generic_alternatives (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    salt TEXT NOT NULL,
    category TEXT,
    brands TEXT,
    alt_names TEXT,
    is_combination INTEGER DEFAULT 0
  );
`);

// Ensure user_id column exists on user-data tables
const userTables = ['meds', 'dose_logs', 'doctor_questions', 'blood_donors', 'care_circle'];
for (const tbl of userTables) {
  try {
    const cols = db.prepare(`PRAGMA table_info(${tbl})`).all().map(c => c.name);
    if (!cols.includes('user_id')) {
      db.exec(`ALTER TABLE ${tbl} ADD COLUMN user_id TEXT DEFAULT 'local';`);
    }
  } catch (e) {}
}

/**
 * Maps database med row to frontend medication object
 */
function mapMedFromDb(row) {
  if (!row) return null;
  let times = [];
  try {
    times = typeof row.times === 'string' ? JSON.parse(row.times) : (row.times || []);
  } catch (e) {
    times = [];
  }
  return {
    id: row.id,
    name: row.name,
    dose: row.dose || '',
    form: row.form || 'Tablet',
    perDose: row.per_dose != null ? Number(row.per_dose) : 1,
    times,
    start: row.start_date || '',
    end: row.end_date || '',
    stock: row.stock != null ? Number(row.stock) : null,
    notes: row.notes || '',
    color: row.color || '#6D4FC2'
  };
}

/**
 * User & Authentication Management
 */
function saveGoogleUser(userData) {
  const { id, email, name, picture, given_name, family_name, locale } = userData;
  const stmt = db.prepare(`
    INSERT INTO users (id, email, name, picture, given_name, family_name, locale, last_login)
    VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET
      email = excluded.email,
      name = excluded.name,
      picture = excluded.picture,
      given_name = excluded.given_name,
      family_name = excluded.family_name,
      locale = excluded.locale,
      last_login = CURRENT_TIMESTAMP
  `);
  stmt.run(id, email, name, picture || '', given_name || '', family_name || '', locale || 'en');
  return getUserById(id);
}

function getUserById(id) {
  if (!id) return null;
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id) || null;
}

function getUserByEmail(email) {
  if (!email) return null;
  return db.prepare('SELECT * FROM users WHERE email = ?').get(email) || null;
}

function getAllUsers() {
  return db.prepare('SELECT id, email, name, picture, created_at, last_login FROM users ORDER BY last_login DESC').all();
}

function createSession(token, userId, days = 30) {
  db.prepare(`
    INSERT INTO sessions (token, user_id, expires_at)
    VALUES (?, ?, datetime('now', '+' || ? || ' days'))
  `).run(token, userId, days);
  return token;
}

function getUserBySession(token) {
  if (!token) return null;
  const row = db.prepare(`
    SELECT u.* FROM users u
    JOIN sessions s ON u.id = s.user_id
    WHERE s.token = ? AND s.expires_at > CURRENT_TIMESTAMP
  `).get(token);
  return row || null;
}

function deleteSession(token) {
  if (!token) return false;
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  return true;
}

function migrateGuestDataToUser(userId) {
  if (!userId || userId === 'local') return false;
  try {
    const userMeds = db.prepare('SELECT COUNT(*) as count FROM meds WHERE user_id = ?').get(userId).count;
    if (userMeds > 0) return false;

    const localMeds = db.prepare('SELECT * FROM meds WHERE user_id = ?').all('local');
    if (!localMeds.length) return false;

    db.exec('BEGIN TRANSACTION;');
    for (const m of localMeds) {
      db.prepare(`
        INSERT INTO meds (id, name, dose, form, per_dose, times, start_date, end_date, stock, notes, color, user_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET user_id = excluded.user_id
      `).run(m.id, m.name, m.dose, m.form, m.per_dose, m.times, m.start_date, m.end_date, m.stock, m.notes, m.color, userId);
    }

    const localLogs = db.prepare('SELECT * FROM dose_logs WHERE user_id = ?').all('local');
    for (const l of localLogs) {
      db.prepare(`
        INSERT INTO dose_logs (key, date, med_id, time, status, taken_at, user_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET user_id = excluded.user_id
      `).run(l.key, l.date, l.med_id, l.time, l.status, l.taken_at, userId);
    }

    const localQ = db.prepare('SELECT * FROM doctor_questions WHERE user_id = ?').all('local');
    for (const q of localQ) {
      db.prepare(`
        INSERT INTO doctor_questions (id, q, date, user_id)
        VALUES (?, ?, ?, ?)
      `).run(q.id, q.q, q.date, userId);
    }

    db.exec('COMMIT;');
    return true;
  } catch (err) {
    db.exec('ROLLBACK;');
    return false;
  }
}

/**
 * Unified state extractor (scoped by userId)
 */
function getFullState(userId = 'local') {
  if (userId && userId !== 'local') {
    migrateGuestDataToUser(userId);
  }

  // 1. Meds
  const medRows = db.prepare('SELECT * FROM meds WHERE user_id = ? ORDER BY created_at ASC').all(userId);
  const meds = medRows.map(mapMedFromDb);

  // 2. Logs & Timestamps
  const logRows = db.prepare('SELECT * FROM dose_logs WHERE user_id = ?').all(userId);
  const logs = {};
  const ts = {};
  for (const row of logRows) {
    logs[row.key] = row.status;
    if (row.taken_at) {
      ts[row.key] = Number(row.taken_at);
    }
  }

  // 3. Questions
  const qRows = db.prepare('SELECT * FROM doctor_questions WHERE user_id = ? ORDER BY created_at ASC').all(userId);
  const questions = qRows.map(r => ({ id: r.id, q: r.q, date: r.date }));

  // 4. Blood Donors
  const donorRows = db.prepare('SELECT * FROM blood_donors WHERE user_id = ? ORDER BY created_at ASC').all(userId);
  const donors = donorRows.map(r => ({
    id: r.id,
    name: r.name,
    bg: r.bg,
    area: r.area || '',
    phone: r.phone || '',
    last: r.last || ''
  }));

  // 5. Care circle & alerts
  const circleRows = db.prepare('SELECT * FROM care_circle WHERE user_id = ? ORDER BY created_at ASC').all(userId);
  const circle = circleRows.map(r => {
    let share = { summary: true, alerts: true, names: false };
    try {
      if (r.share) share = JSON.parse(r.share);
    } catch (e) {}
    return {
      id: r.id,
      name: r.name,
      rel: r.rel || '',
      phone: r.phone || '',
      active: Boolean(r.active),
      consentAt: r.consent_at ? Number(r.consent_at) : null,
      since: r.since ? Number(r.since) : null,
      delay: r.delay ? Number(r.delay) : 60,
      share
    };
  });

  const alertRows = db.prepare('SELECT * FROM care_alerts ORDER BY created_at DESC LIMIT 50').all();
  const alerts = alertRows.map(r => ({
    id: r.id,
    type: r.type,
    medName: r.med_name,
    time: r.time,
    createdAt: r.created_at
  }));

  const ackRows = db.prepare('SELECT * FROM care_acks').all();
  const acks = {};
  for (const r of ackRows) {
    acks[r.key] = { by: r.ack_by, at: r.ack_at };
  }

  // 6. Verified checks
  const verRows = db.prepare('SELECT * FROM verified_checks').all();
  const verified = {};
  for (const r of verRows) {
    verified[r.key] = r.value;
  }

  // 7. Settings (user-scoped with fallback)
  const settings = { voice: true, name: '', theme: 'light' };
  const userSettingRows = db.prepare('SELECT key, value FROM user_settings WHERE user_id = ?').all(userId);
  for (const r of userSettingRows) {
    if (r.key === 'voice') settings.voice = r.value === '1' || r.value === 'true';
    if (r.key === 'name') settings.name = r.value;
    if (r.key === 'theme') settings.theme = r.value;
  }
  if (!userSettingRows.length) {
    const settingRows = db.prepare('SELECT * FROM app_settings').all();
    for (const r of settingRows) {
      if (r.key === 'voice') settings.voice = r.value === '1' || r.value === 'true';
      if (r.key === 'name') settings.name = r.value;
      if (r.key === 'theme') settings.theme = r.value;
    }
  }

  // 8. Agreed status
  const agreedRow = db.prepare("SELECT value FROM app_meta WHERE key = 'agreed'").get();
  const agreed = agreedRow ? agreedRow.value === '1' || agreedRow.value === 'true' : false;

  return {
    meds,
    logs,
    ts,
    questions,
    settings,
    agreed,
    care: {
      circle,
      alerts,
      acks
    },
    donors,
    verified
  };
}

/**
 * Bulk save full state (supports atomic sync, scoped by userId)
 */
function saveFullState(state, userId = 'local') {
  if (!state || typeof state !== 'object') return false;

  db.exec('BEGIN TRANSACTION;');
  try {
    // 1. Agreed
    if (state.agreed !== undefined) {
      db.prepare(`
        INSERT INTO app_meta (key, value) VALUES ('agreed', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `).run(state.agreed ? '1' : '0');
    }

    // 2. Settings
    if (state.settings) {
      if (state.settings.voice !== undefined) {
        db.prepare(`
          INSERT INTO user_settings (user_id, key, value) VALUES (?, 'voice', ?)
          ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value
        `).run(userId, state.settings.voice ? '1' : '0');
      }
      if (state.settings.name !== undefined) {
        db.prepare(`
          INSERT INTO user_settings (user_id, key, value) VALUES (?, 'name', ?)
          ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value
        `).run(userId, String(state.settings.name || ''));
      }
      if (state.settings.theme !== undefined) {
        db.prepare(`
          INSERT INTO user_settings (user_id, key, value) VALUES (?, 'theme', ?)
          ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value
        `).run(userId, String(state.settings.theme || ''));
      }
    }

    // 3. Meds
    if (Array.isArray(state.meds)) {
      db.prepare('DELETE FROM meds WHERE user_id = ?;').run(userId);
      const insertMed = db.prepare(`
        INSERT INTO meds (id, name, dose, form, per_dose, times, start_date, end_date, stock, notes, color, user_id, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `);
      for (const m of state.meds) {
        if (!m || !m.name) continue;
        const id = m.id || Math.random().toString(36).slice(2, 9);
        const times = JSON.stringify(Array.isArray(m.times) ? m.times : []);
        insertMed.run(
          id,
          m.name,
          m.dose || '',
          m.form || 'Tablet',
          m.perDose != null ? Number(m.perDose) : 1,
          times,
          m.start || '',
          m.end || '',
          m.stock != null ? Number(m.stock) : null,
          m.notes || '',
          m.color || '#6D4FC2',
          userId
        );
      }
    }

    // 4. Logs and Timestamps
    if (state.logs && typeof state.logs === 'object') {
      db.prepare('DELETE FROM dose_logs WHERE user_id = ?;').run(userId);
      const insertLog = db.prepare(`
        INSERT INTO dose_logs (key, date, med_id, time, status, taken_at, user_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      for (const [key, status] of Object.entries(state.logs)) {
        if (!key || !status) continue;
        const parts = key.split('|');
        const date = parts[0] || '';
        const medId = parts[1] || '';
        const time = parts[2] || '';
        const takenAt = state.ts && state.ts[key] ? Number(state.ts[key]) : null;
        insertLog.run(key, date, medId, time, String(status), takenAt, userId);
      }
    }

    // 5. Questions
    if (Array.isArray(state.questions)) {
      db.prepare('DELETE FROM doctor_questions WHERE user_id = ?;').run(userId);
      const insertQ = db.prepare(`
        INSERT INTO doctor_questions (id, q, date, user_id)
        VALUES (?, ?, ?, ?)
      `);
      for (const q of state.questions) {
        if (!q || !q.q) continue;
        const id = q.id || Math.random().toString(36).slice(2, 9);
        insertQ.run(id, q.q, q.date || '', userId);
      }
    }

    // 6. Blood Donors
    if (Array.isArray(state.donors)) {
      db.prepare('DELETE FROM blood_donors WHERE user_id = ?;').run(userId);
      const insertDonor = db.prepare(`
        INSERT INTO blood_donors (id, name, bg, area, phone, last, user_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      for (const d of state.donors) {
        if (!d || !d.name) continue;
        const id = d.id || Math.random().toString(36).slice(2, 9);
        insertDonor.run(id, d.name, d.bg || '', d.area || '', d.phone || '', d.last || '', userId);
      }
    }

    // 7. Care
    if (state.care && typeof state.care === 'object') {
      if (Array.isArray(state.care.circle)) {
        db.prepare('DELETE FROM care_circle WHERE user_id = ?;').run(userId);
        const insertCircle = db.prepare(`
          INSERT INTO care_circle (id, name, rel, phone, active, consent_at, since, delay, share, user_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const c of state.care.circle) {
          if (!c || !c.name) continue;
          const id = c.id || Math.random().toString(36).slice(2, 9);
          insertCircle.run(
            id,
            c.name,
            c.rel || '',
            c.phone || '',
            c.active !== false ? 1 : 0,
            c.consentAt ? Number(c.consentAt) : null,
            c.since ? Number(c.since) : null,
            c.delay ? Number(c.delay) : 60,
            JSON.stringify(c.share || { summary: true, alerts: true, names: false }),
            userId
          );
        }
      }

      if (state.care.acks && typeof state.care.acks === 'object') {
        db.exec('DELETE FROM care_acks;');
        const insertAck = db.prepare(`
          INSERT INTO care_acks (key, ack_by, ack_at)
          VALUES (?, ?, ?)
        `);
        for (const [k, v] of Object.entries(state.care.acks)) {
          if (!k) continue;
          insertAck.run(k, v && v.by ? v.by : '', v && v.at ? Number(v.at) : Date.now());
        }
      }
    }

    // 8. Verified
    if (state.verified && typeof state.verified === 'object') {
      db.exec('DELETE FROM verified_checks;');
      const insertVer = db.prepare(`
        INSERT INTO verified_checks (key, value)
        VALUES (?, ?)
      `);
      for (const [k, v] of Object.entries(state.verified)) {
        if (!k) continue;
        insertVer.run(k, String(v));
      }
    }

    db.exec('COMMIT;');
    return true;
  } catch (err) {
    db.exec('ROLLBACK;');
    console.error('Error in saveFullState:', err);
    throw err;
  }
}

/**
 * Individual REST helpers
 */
function getAllMeds(userId = 'local') {
  return db.prepare('SELECT * FROM meds WHERE user_id = ? ORDER BY created_at ASC').all(userId).map(mapMedFromDb);
}

function getMedById(id, userId = null) {
  const row = userId
    ? db.prepare('SELECT * FROM meds WHERE id = ? AND user_id = ?').get(id, userId)
    : db.prepare('SELECT * FROM meds WHERE id = ?').get(id);
  return mapMedFromDb(row);
}

function createOrUpdateMed(med, userId = 'local') {
  const id = med.id || Math.random().toString(36).slice(2, 9);
  const times = JSON.stringify(Array.isArray(med.times) ? med.times : []);
  db.prepare(`
    INSERT INTO meds (id, name, dose, form, per_dose, times, start_date, end_date, stock, notes, color, user_id, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      dose = excluded.dose,
      form = excluded.form,
      per_dose = excluded.per_dose,
      times = excluded.times,
      start_date = excluded.start_date,
      end_date = excluded.end_date,
      stock = excluded.stock,
      notes = excluded.notes,
      color = excluded.color,
      user_id = excluded.user_id,
      updated_at = CURRENT_TIMESTAMP
  `).run(
    id,
    med.name,
    med.dose || '',
    med.form || 'Tablet',
    med.perDose != null ? Number(med.perDose) : 1,
    times,
    med.start || '',
    med.end || '',
    med.stock != null ? Number(med.stock) : null,
    med.notes || '',
    med.color || '#6D4FC2',
    userId
  );
  return getMedById(id);
}

function deleteMed(id, userId = 'local') {
  db.prepare('DELETE FROM meds WHERE id = ? AND user_id = ?').run(id, userId);
  db.prepare("DELETE FROM dose_logs WHERE med_id = ? AND user_id = ?").run(id, userId);
  return true;
}

function logDose(key, status, takenAt, userId = 'local') {
  const parts = key.split('|');
  const date = parts[0] || '';
  const medId = parts[1] || '';
  const time = parts[2] || '';
  const ts = status === 'taken' ? (takenAt || Date.now()) : null;

  db.prepare(`
    INSERT INTO dose_logs (key, date, med_id, time, status, taken_at, user_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      status = excluded.status,
      taken_at = excluded.taken_at,
      user_id = excluded.user_id
  `).run(key, date, medId, time, status, ts, userId);

  // If taken, decrement stock
  if (status === 'taken' && medId) {
    const med = getMedById(medId);
    if (med && med.stock !== null && !isNaN(med.stock)) {
      const newStock = Math.max(0, med.stock - (med.perDose || 1));
      db.prepare('UPDATE meds SET stock = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(newStock, medId);
    }
  }

  return { key, status, takenAt: ts };
}

function undoDose(key, userId = 'local') {
  const log = db.prepare('SELECT * FROM dose_logs WHERE key = ? AND user_id = ?').get(key, userId);
  if (log) {
    if (log.status === 'taken' && log.med_id) {
      const med = getMedById(log.med_id);
      if (med && med.stock !== null && !isNaN(med.stock)) {
        const newStock = med.stock + (med.perDose || 1);
        db.prepare('UPDATE meds SET stock = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(newStock, log.med_id);
      }
    }
    db.prepare('DELETE FROM dose_logs WHERE key = ? AND user_id = ?').run(key, userId);
  }
  return true;
}

function addQuestion(q, date, userId = 'local') {
  const id = Math.random().toString(36).slice(2, 9);
  db.prepare('INSERT INTO doctor_questions (id, q, date, user_id) VALUES (?, ?, ?, ?)').run(id, q, date || '', userId);
  return { id, q, date };
}

function deleteQuestion(id, userId = 'local') {
  db.prepare('DELETE FROM doctor_questions WHERE id = ? AND user_id = ?').run(id, userId);
  return true;
}

function addDonor(donor, userId = 'local') {
  const id = donor.id || Math.random().toString(36).slice(2, 9);
  db.prepare(`
    INSERT INTO blood_donors (id, name, bg, area, phone, last, user_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      bg = excluded.bg,
      area = excluded.area,
      phone = excluded.phone,
      last = excluded.last,
      user_id = excluded.user_id
  `).run(id, donor.name, donor.bg || '', donor.area || '', donor.phone || '', donor.last || '', userId);
  return { id, ...donor };
}

function deleteDonor(id, userId = 'local') {
  db.prepare('DELETE FROM blood_donors WHERE id = ? AND user_id = ?').run(id, userId);
  return true;
}

/**
 * Returns statistics computed via SQL
 */
function getStats(userId = 'local') {
  const totalMeds = db.prepare('SELECT COUNT(*) as count FROM meds WHERE user_id = ?').get(userId).count;
  const totalLogs = db.prepare('SELECT COUNT(*) as count FROM dose_logs WHERE user_id = ?').get(userId).count;
  const takenLogs = db.prepare("SELECT COUNT(*) as count FROM dose_logs WHERE status = 'taken' AND user_id = ?").get(userId).count;
  const totalQuestions = db.prepare('SELECT COUNT(*) as count FROM doctor_questions WHERE user_id = ?').get(userId).count;
  const totalDonors = db.prepare('SELECT COUNT(*) as count FROM blood_donors WHERE user_id = ?').get(userId).count;
  const lowStock = db.prepare('SELECT COUNT(*) as count FROM meds WHERE stock IS NOT NULL AND stock <= 5 AND user_id = ?').get(userId).count;
  const totalUsers = db.prepare('SELECT COUNT(*) as count FROM users').get().count;

  return {
    userId,
    totalMeds,
    totalLogs,
    takenLogs,
    totalQuestions,
    totalDonors,
    lowStock,
    totalUsers,
    dbPath: DB_PATH,
    databaseEngine: 'SQLite 3 (native node:sqlite DatabaseSync)'
  };
}

/**
 * Seed initial demo data into database
 */
function seedDemoData(userId = 'local') {
  const pad = n => String(n).padStart(2, '0');
  const dkey = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const now = new Date();
  const soon = pad(now.getHours()) + ':' + pad((now.getMinutes() + 2) % 60);
  const st = dkey(new Date(Date.now() - 42 * 864e5));

  const demoState = {
    agreed: true,
    settings: { voice: true, name: 'Asha', theme: 'light' },
    meds: [
      { id: 'm1', name: 'Metformin', dose: '500 mg', form: 'Tablet', perDose: 1, times: ['08:00', '20:00'], start: st, end: '', stock: 11, notes: 'Take after meals (sample)', color: '#6D4FC2' },
      { id: 'm2', name: 'Amlodipine', dose: '5 mg', form: 'Tablet', perDose: 1, times: ['09:00'], start: st, end: '', stock: 40, notes: 'Blood pressure regulation', color: '#3E6FB0' },
      { id: 'm3', name: 'Vitamin D3', dose: '1000 IU', form: 'Capsule', perDose: 1, times: ['14:00'], start: st, end: '', stock: 50, notes: 'With afternoon meal', color: '#C9892B' },
      { id: 'm4', name: 'Vitamin C', dose: '500 mg', form: 'Tablet', perDose: 1, times: [soon], start: dkey(now), end: '', stock: 30, notes: 'Immune support', color: '#4E8F5A' }
    ],
    logs: {},
    ts: {},
    questions: [
      { id: 'q1', q: 'Is it okay to take my evening tablet later if I eat dinner late?', date: dkey(now) }
    ],
    care: {
      circle: [
        { id: 'c1', name: 'Priya', rel: 'Daughter', phone: '+91 98765 43210', active: true, delay: 60, share: { summary: true, alerts: true, names: false } }
      ],
      alerts: [],
      acks: {}
    },
    donors: [
      { id: 'd1', name: 'Rahul Sharma', bg: 'O+', area: 'Indiranagar', phone: '+91 98765 00001', last: '2026-08-10' },
      { id: 'd2', name: 'Ananya Verma', bg: 'A+', area: 'Koramangala', phone: '+91 98765 00002', last: '2026-09-01' },
      { id: 'd3', name: 'Karthik Rao', bg: 'B+', area: 'Whitefield', phone: '+91 98765 00003', last: '2026-06-15' }
    ],
    verified: {}
  };

  // Generate 28 days of realistic demo adherence logs
  for (let i = 1; i <= 28; i++) {
    const dt = new Date(Date.now() - i * 864e5);
    const dk = dkey(dt);
    for (const m of demoState.meds) {
      for (const t of m.times) {
        const key = `${dk}|${m.id}|${t}`;
        const taken = Math.random() < 0.92;
        if (taken) {
          demoState.logs[key] = 'taken';
          demoState.ts[key] = dt.getTime() + 1000 * 60 * 15;
        } else {
          demoState.logs[key] = Math.random() < 0.5 ? 'skipped' : 'missed';
        }
      }
    }
  }

  saveFullState(demoState, userId);
  return getFullState(userId);
}

/**
 * Wipe all database records cleanly (optionally scoped)
 */
function wipeAll(userId = null) {
  if (userId) {
    db.prepare('DELETE FROM meds WHERE user_id = ?;').run(userId);
    db.prepare('DELETE FROM dose_logs WHERE user_id = ?;').run(userId);
    db.prepare('DELETE FROM doctor_questions WHERE user_id = ?;').run(userId);
    db.prepare('DELETE FROM blood_donors WHERE user_id = ?;').run(userId);
    db.prepare('DELETE FROM care_circle WHERE user_id = ?;').run(userId);
    db.prepare('DELETE FROM user_settings WHERE user_id = ?;').run(userId);
  } else {
    db.exec(`
      DELETE FROM meds;
      DELETE FROM dose_logs;
      DELETE FROM doctor_questions;
      DELETE FROM blood_donors;
      DELETE FROM care_circle;
      DELETE FROM care_alerts;
      DELETE FROM care_acks;
      DELETE FROM verified_checks;
      DELETE FROM app_settings;
      DELETE FROM user_settings;
      DELETE FROM app_meta;
      DELETE FROM price_quotes;
    `);
  }
  return true;
}

/**
 * Reference Medicines & Generic Alternatives (Drug Encyclopedia)
 */
function seedReferenceData() {
  const refPath = path.join(__dirname, 'reference_data.json');
  if (!fs.existsSync(refPath)) return false;

  const countRef = db.prepare('SELECT COUNT(*) as count FROM medicine_reference').get().count;
  const countGx = db.prepare('SELECT COUNT(*) as count FROM generic_alternatives').get().count;

  if (countRef > 0 && countGx > 0) return true;

  try {
    const data = JSON.parse(fs.readFileSync(refPath, 'utf8'));

    if (Array.isArray(data.meddb) && countRef === 0) {
      const insertRef = db.prepare(`
        INSERT INTO medicine_reference (id, name, aliases, verified, summary, used_for, warnings, details)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          aliases = excluded.aliases,
          summary = excluded.summary,
          used_for = excluded.used_for,
          warnings = excluded.warnings,
          details = excluded.details
      `);

      for (const m of data.meddb) {
        insertRef.run(
          m.id || m.name.toLowerCase().replace(/\s+/g, '-'),
          m.name,
          JSON.stringify(m.aliases || []),
          m.verified !== false ? 1 : 0,
          m.summary || '',
          JSON.stringify(m.usedFor || []),
          JSON.stringify(m.warnings || []),
          JSON.stringify({
            howToTake: m.howToTake || '',
            sideEffects: m.sideEffects || [],
            missedDose: m.missedDose || '',
            sources: m.sources || [],
            openfdaQuery: m.openfdaQuery || ''
          })
        );
      }
    }

    if (Array.isArray(data.gx) && countGx === 0) {
      const insertGx = db.prepare(`
        INSERT INTO generic_alternatives (salt, category, brands, alt_names, is_combination)
        VALUES (?, ?, ?, ?, ?)
      `);

      for (const g of data.gx) {
        insertGx.run(
          g.s,
          g.g || '',
          JSON.stringify(g.b || []),
          JSON.stringify(g.alt || []),
          g.c ? 1 : 0
        );
      }
    }

    console.log('Seeded reference medicines and generic alternatives into SQLite!');
    return true;
  } catch (err) {
    console.error('Error seeding reference data:', err);
    return false;
  }
}

// Auto-seed reference data on startup
seedReferenceData();

function getAllReferenceMeds() {
  const rows = db.prepare('SELECT * FROM medicine_reference ORDER BY name ASC').all();
  return rows.map(r => ({
    id: r.id,
    name: r.name,
    aliases: JSON.parse(r.aliases || '[]'),
    verified: Boolean(r.verified),
    summary: r.summary,
    usedFor: JSON.parse(r.used_for || '[]'),
    warnings: JSON.parse(r.warnings || '[]'),
    ...JSON.parse(r.details || '{}')
  }));
}

function getReferenceMedByName(name) {
  if (!name) return null;
  const q = name.toLowerCase().trim();
  const all = getAllReferenceMeds();
  return all.find(m => m.name.toLowerCase() === q || m.aliases.some(a => a.toLowerCase() === q)) || null;
}

function getAllGenerics() {
  const rows = db.prepare('SELECT * FROM generic_alternatives ORDER BY salt ASC').all();
  return rows.map(r => ({
    id: r.id,
    salt: r.salt,
    category: r.category,
    brands: JSON.parse(r.brands || '[]'),
    alt: JSON.parse(r.alt_names || '[]'),
    isCombination: Boolean(r.is_combination)
  }));
}

function searchGenerics(query) {
  if (!query) return [];
  const q = query.toLowerCase().trim();
  const all = getAllGenerics();
  return all.filter(g => {
    return g.salt.toLowerCase().includes(q) ||
      g.brands.some(b => b.toLowerCase().includes(q)) ||
      g.alt.some(a => a.toLowerCase().includes(q));
  });
}

module.exports = {
  db,
  DB_PATH,
  getFullState,
  saveFullState,
  getAllMeds,
  getMedById,
  createOrUpdateMed,
  deleteMed,
  logDose,
  undoDose,
  addQuestion,
  deleteQuestion,
  addDonor,
  deleteDonor,
  getStats,
  seedDemoData,
  wipeAll,
  seedReferenceData,
  getAllReferenceMeds,
  getReferenceMedByName,
  getAllGenerics,
  searchGenerics,
  saveGoogleUser,
  getUserById,
  getUserByEmail,
  getAllUsers,
  createSession,
  getUserBySession,
  deleteSession,
  migrateGuestDataToUser
};
