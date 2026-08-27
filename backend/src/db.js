const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
require('dotenv').config();

const dbPath = process.env.DATABASE_PATH || './data/sulaksh.db';
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ---- Schema ----
// status: 'active' | 'deleted' — deleted rows are only removed after the
// corresponding R2 object is confirmed gone (see routes/admin.js).
db.exec(`
CREATE TABLE IF NOT EXISTS admins (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS materials (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  exam TEXT NOT NULL,
  category TEXT NOT NULL,
  subject TEXT,
  year INTEGER,
  description TEXT,
  file_name TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'application/pdf',
  r2_object_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active',
  is_imp INTEGER NOT NULL DEFAULT 0,
  is_syllabus INTEGER NOT NULL DEFAULT 0,
  is_pyq INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`);

// ---- Migrations for databases created before these columns existed ----
// Must run before creating the indexes below.
const cols = db.prepare('PRAGMA table_info(materials)').all();
if (!cols.some((c) => c.name === 'is_imp')) {
  db.exec('ALTER TABLE materials ADD COLUMN is_imp INTEGER NOT NULL DEFAULT 0');
  console.log('[db] Added is_imp column to materials');
}
if (!cols.some((c) => c.name === 'is_syllabus')) {
  db.exec('ALTER TABLE materials ADD COLUMN is_syllabus INTEGER NOT NULL DEFAULT 0');
  console.log('[db] Added is_syllabus column to materials');
}
if (!cols.some((c) => c.name === 'is_pyq')) {
  db.exec('ALTER TABLE materials ADD COLUMN is_pyq INTEGER NOT NULL DEFAULT 0');
  console.log('[db] Added is_pyq column to materials');
}
// track: section within a subject folder (e.g. Core Subjects → Honours / As
// Major / As Minor). Nullable — existing materials are unaffected.
if (!cols.some((c) => c.name === 'track')) {
  db.exec('ALTER TABLE materials ADD COLUMN track TEXT');
  console.log('[db] Added track column to materials');
}
// semester: which semester of a subject's course a file belongs to (Core
// Subjects → Sem 1..8). Nullable — legacy materials are unaffected.
if (!cols.some((c) => c.name === 'semester')) {
  db.exec('ALTER TABLE materials ADD COLUMN semester TEXT');
  console.log('[db] Added semester column to materials');
}
// material_category: Core Subject category (syllabus/notes/pyqs/
// important-questions/question-bank/books/exam-preparation). Nullable —
// legacy materials are unaffected.
if (!cols.some((c) => c.name === 'material_category')) {
  db.exec('ALTER TABLE materials ADD COLUMN material_category TEXT');
  console.log('[db] Added material_category column to materials');
}
// uploaded_by: email of the admin who uploaded a file, so reports can say who
// published the content. Populated from the upload token; legacy rows default
// to null ("unknown").
if (!cols.some((c) => c.name === 'uploaded_by')) {
  db.exec('ALTER TABLE materials ADD COLUMN uploaded_by TEXT');
  console.log('[db] Added uploaded_by column to materials');
}
// report_count: number of pending (unresolved) reports on a file, surfaced to
// admins so frequently-flagged content is easy to spot.
if (!cols.some((c) => c.name === 'report_count')) {
  db.exec('ALTER TABLE materials ADD COLUMN report_count INTEGER NOT NULL DEFAULT 0');
  console.log('[db] Added report_count column to materials');
}

db.exec(`
CREATE TABLE IF NOT EXISTS subjects (
  id TEXT PRIMARY KEY,
  exam TEXT NOT NULL,
  category TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(exam, category, name)
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`);

// ---- Content reports ----
// A visitor can flag a material as duplicate / copyrighted / irrelevant, but
// can NEVER modify or delete it — only admins review and resolve reports.
// status: 'open' | 'resolved' | 'dismissed'.
db.exec(`
CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  material_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  details TEXT,
  reporter_name TEXT,
  reporter_email TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL,
  FOREIGN KEY (material_id) REFERENCES materials(id)
);
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);
CREATE INDEX IF NOT EXISTS idx_reports_material ON reports(material_id);
CREATE INDEX IF NOT EXISTS idx_reports_created ON reports(created_at);
`);

// ---- Auth sessions (server-side revocation + sliding expiry) ----
db.exec(`
CREATE TABLE IF NOT EXISTS auth_sessions (
  id TEXT PRIMARY KEY,
  admin_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0,
  ip TEXT,
  user_agent TEXT
);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_admin ON auth_sessions(admin_id);
`);

// ---- Security audit log ----
db.exec(`
CREATE TABLE IF NOT EXISTS auth_log (
  at TEXT NOT NULL,
  email TEXT,
  event TEXT NOT NULL,
  ok INTEGER NOT NULL,
  ip TEXT,
  user_agent TEXT
);
`);

function logAuthEvent(email, event, ok, req) {
  try {
    const ip = (req && (req.headers['x-forwarded-for'] || '').split(',')[0].trim()) ||
      (req && req.socket && req.socket.remoteAddress) || null;
    db.prepare('INSERT INTO auth_log (at, email, event, ok, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?)')
      .run(new Date().toISOString(), email || null, event, ok ? 1 : 0, ip,
        (req && req.headers['user-agent']) || null);
  } catch (e) {
    console.error('[auth-log] failed:', e.message);
  }
}

// ---- Admin roles ----
// 'super' = full control (uploads, deletes, subjects). 'maintenance' = may
// only toggle maintenance mode. Existing admins default to 'super'.
const adminCols = db.prepare('PRAGMA table_info(admins)').all();
if (!adminCols.some((c) => c.name === 'role')) {
  db.exec("ALTER TABLE admins ADD COLUMN role TEXT NOT NULL DEFAULT 'super'");
  console.log('[db] Added role column to admins');
}

// ---- Settings helpers ----
function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}
function setSetting(key, value) {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(key, String(value));
}

// ---- Seed default subject folders for the DU & College "Common / University
// Courses" categories (SEC, VAC, AEC, GE). These are exposed as editable
// subject folders so admins can rename, add or remove them without editing code.
// Only runs once if the subjects table is empty.
const SEED_SUBJECTS = {
  SEC: [
    'Advanced Spreadsheets Tools', 'Analytics/ Computing With Python', 'APP Development using Flutter',
    'Back-End Web Development', 'Basic IT Tools', 'Big Data Analytics', 'Beginners Course to Calligraphy',
    'Business Communication', 'Business Intelligence and Data Visualisation', 'CAD for Fashion',
    'Communication in Everyday Life', 'Communication in Professional Life', 'Creative Writing',
    'Cyber Sphere and Security: Global Concern', 'Developing sustainability plans for a business',
    'Digital Film Production', 'Digital Marketing', 'Essentials of Python', 'E-Tourism',
    'Finance for Everyone', 'Financial Database and Analysis Software', 'Front End Web Design and Development',
    'Graphics Design & Animation', 'Harmonium', 'Introduction to Arabic Calligraphy',
    'Introduction to Blockchain', 'Introduction to Cloud Computing (AWS)', 'Negotiations and Leadership',
    'Personal Financial Planning', 'Personality Development and Communication',
    'Political Leadership and Communication', 'Programing with Python', 'Prospecting E-Waste for Sustainability',
    'Public Speaking in English Language and Leadership', 'Statistical Software Package',
    "Statistics with 'R'", 'Sustainable Ecotourism and Entrepreneurship', 'Visual Communication and Photography',
    'पटकथा लेखन', 'रंगमंच', 'रचनात्मक लेखन', 'Museum and Museology', 'Reading the Archive',
    'Fundamentals of Indian Manuscriptology', 'Others',
  ],
  VAC: [
    'Ayurveda and Nutrition', 'Constitutional Values and Fundamental Duties', 'Culture and Communication',
    'Emotional Intelligence', 'Envisaging Viksit Bharat: Perspectives and Challenges', 'Ethics and Culture',
    'Ethics and Values in Ancient Indian Traditions', 'Financial Literacy', 'Gandhi and Education',
    'Ecology and Literature', 'National Cadet Corps-I*', 'National Cadet Corps-II*',
    'National Cadet Corps-III*', 'National Cadet Corps-IV*', 'Panchkosha: Holistic Development of Personality',
    'Reading Indian Fiction in English', 'Science and Society', 'Social and Emotional Learning',
    'Swachh Bharat', 'Tribes of India', 'The Art of Being Happy', 'The Gita for Holistic Life',
    'The Gita for Sustainable Universe', 'The Gita: Navigating Life Challenges',
    'Leadership Excellence Through the Gita', 'Vedic Mathematics-I**', 'Vedic Mathematics-II**',
    'Vedic Mathematics-III**', 'Vedic Mathematics-IV**', 'Yoga: Philosophy and Practice',
    'The Science of Happiness', 'भारतीय भक्ति परम्परा और मानव मूल्य', 'साहित्य संस्कृति और सिनेमा',
    'सृजनात्मक लेख के आयाम', 'Digital Empowerment', 'Fit India', 'Sports for Life***', 'Indigenous Sports',
    'Sports - Diversity and Inclusivity', 'Others',
  ],
  AEC: [
    'हिंदी औपचारिक लेखन (ख)', 'EVS Theory into Practice I', 'EVS Theory into Practice II',
    'जनसंचार एवं रचनात्मक लेखन हिंदी (ख)', 'हिंदी भाषा : सम्प्रेषण और संचार (क)',
    'सोशल मीडिया और ब्लॉग लेखन', 'व्यावहारिक हिंदी', 'जनसंचार और रचनात्मक लेखन', 'हिंदी भाषा और तकनीक', 'Others',
  ],
  GE: [
    'Introduction to the Indian Constitution', 'हिन्दी गद्य, उद्भव और विकास – ख', 'Introduction to Public Policy',
    'Business Management', 'Media & Communication Skill', 'Principles of Macroeconomics', 'Public Finance',
    'Indian Economy', 'Basic Statistics for Economy', 'भाषा और समाज', 'हिन्दी भाषा और साहित्य क',
    'हिन्दी भाषा और साहित्य ख', 'हिन्दी भाषा और साहित्य ग', 'Delhi Through the Ages', 'Introduction to Linear Algebra',
    'Analytical Geometry', 'Nationalism in India', 'Introductory Probability', 'Applied Statistics',
    'Stress Management', 'Fitness and Wellness', 'History and Foundation of Physical Education', 'Others',
  ],
};

(function seedSubjects() {
  const count = db.prepare('SELECT COUNT(*) AS n FROM subjects').get().n;
  if (count > 0) return;
  const exam = 'DU & College';
  const ts = new Date().toISOString();
  const insert = db.prepare('INSERT INTO subjects (id, exam, category, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)');
  const { v4: uuidv4 } = require('uuid');
  Object.entries(SEED_SUBJECTS).forEach(([category, names]) => {
    names.forEach((name) => insert.run(uuidv4(), exam, category, name, ts, ts));
  });
  console.log('[db] Seeded default subjects table');
})();

db.exec(`
CREATE INDEX IF NOT EXISTS idx_materials_exam ON materials(exam);
CREATE INDEX IF NOT EXISTS idx_materials_category ON materials(category);
CREATE INDEX IF NOT EXISTS idx_materials_subject ON materials(subject);
CREATE INDEX IF NOT EXISTS idx_materials_year ON materials(year);
CREATE INDEX IF NOT EXISTS idx_materials_status ON materials(status);
CREATE INDEX IF NOT EXISTS idx_materials_is_imp ON materials(is_imp);
CREATE INDEX IF NOT EXISTS idx_materials_is_syllabus ON materials(is_syllabus);
CREATE INDEX IF NOT EXISTS idx_materials_is_pyq ON materials(is_pyq);
CREATE INDEX IF NOT EXISTS idx_materials_track ON materials(track);
CREATE INDEX IF NOT EXISTS idx_materials_semester ON materials(semester);
CREATE INDEX IF NOT EXISTS idx_materials_material_category ON materials(material_category);
`);

module.exports = db;
module.exports.getSetting = getSetting;
module.exports.setSetting = setSetting;
module.exports.logAuthEvent = logAuthEvent;
