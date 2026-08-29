// Usage: npm run create-admin -- admin@sulaksh.com "a-strong-password"
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const db = require('../src/db');

const [,, email, password] = process.argv;

if (!email || !password) {
  console.error('Usage: npm run create-admin -- <email> <password>');
  process.exit(1);
}
if (password.length < 10) {
  console.error('Password must be at least 10 characters.');
  process.exit(1);
}

const normalizedEmail = email.toLowerCase().trim();
const existing = db.prepare('SELECT id FROM admins WHERE email = ?').get(normalizedEmail);
if (existing) {
  console.error(`An admin with email ${normalizedEmail} already exists.`);
  process.exit(1);
}

const hash = bcrypt.hashSync(password, 12);
db.prepare(`
  INSERT INTO admins (id, email, password_hash, created_at)
  VALUES (?, ?, ?, ?)
`).run(uuidv4(), normalizedEmail, hash, new Date().toISOString());

console.log(`Admin account created for ${normalizedEmail}`);
