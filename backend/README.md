# SULAKSH — Cloudflare R2 Materials Storage

Backend for storing study material PDFs in Cloudflare R2, with only metadata
in a local database. Built as a standalone Express API since the existing
SULAKSH site (in the sibling project) was a static frontend with no
backend/DB/auth yet — this fills that gap without touching the site's UI.

## 1. Files changed / added

Everything here is new (`/home/claude/backend/`):

```
backend/
├── package.json
├── .env.example
├── src/
│   ├── server.js          # Express app entrypoint
│   ├── db.js               # SQLite connection + schema
│   ├── r2.js                # Cloudflare R2 client (S3-compatible SDK)
│   ├── middleware/auth.js   # JWT admin-session guard
│   ├── routes/auth.js       # POST /login, /logout, GET /me
│   ├── routes/materials.js  # Public: list/search/filter, presigned download
│   ├── routes/admin.js      # Admin: upload/edit/replace/delete
│   └── utils/validate.js    # PDF magic-byte check, key/filename sanitizing
├── scripts/create-admin.js  # CLI to seed the first admin (no open signup)
└── public/
    ├── admin/login.html     # Minimal admin login page
    ├── admin/dashboard.html # Upload + manage materials
    └── materials-api.example.js  # Drop-in snippet for your existing homepage
```

Your existing `index.html` (the SULAKSH homepage) is **untouched**. When
you're ready to wire real "View"/"Download" buttons into it, use
`materials-api.example.js` as a starting point — it only adds two functions,
no styling changes.

## 2. Environment variables required

Copy `.env.example` to `.env` and fill in:

| Variable | Purpose |
|---|---|
| `PORT` | API port (default 4000) |
| `CORS_ORIGINS` | Comma-separated list of allowed frontend origins |
| `JWT_SECRET` | Long random string for signing admin sessions — generate with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `JWT_EXPIRES_IN` | Admin session lifetime (default `12h`) |
| `ADMIN_COOKIE_NAME` | httpOnly cookie name for the session |
| `R2_ACCOUNT_ID` | Your Cloudflare account ID |
| `R2_ACCESS_KEY_ID` | R2 API token access key |
| `R2_SECRET_ACCESS_KEY` | R2 API token secret |
| `R2_BUCKET_NAME` | The bucket you create for materials |
| `MAX_FILE_SIZE_MB` | Upload size cap (default 25) |
| `PRESIGNED_URL_EXPIRY_SECONDS` | Download link lifetime (default 300 = 5 min) |
| `DATABASE_PATH` | SQLite file location |

**None of these are ever sent to the frontend.** The browser only ever talks
to your API; the API talks to R2 server-side.

## 3. Database schema

SQLite via `better-sqlite3` (single file, no server to run — swap for
Postgres later by changing only `db.js`, since it's plain SQL).

```sql
CREATE TABLE admins (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE materials (
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
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

This is created automatically on first server start — no manual migration
step needed. Indexes exist on `exam`, `category`, `subject`, `year`, `status`.

## 4. Cloudflare dashboard steps (manual, one-time)

1. **Create the bucket**: R2 → Create bucket → name it (e.g. `sulaksh-materials`) → Standard storage class.
2. **Create an API token**: R2 → Manage API Tokens → Create API Token → grant it **Object Read & Write** scoped to that one bucket only (not account-wide).
3. Copy the **Access Key ID** and **Secret Access Key** shown once — put them in `.env` as `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY`.
4. Copy your **Account ID** (shown on the R2 overview page) into `R2_ACCOUNT_ID`.
5. **Leave the bucket private** (no public access) — this setup relies entirely on presigned URLs, not public bucket access.
6. **CORS** — only needed because presigned GET URLs are fetched directly by the browser from `*.r2.cloudflarestorage.com`. In the bucket's Settings → CORS Policy, add:
   ```json
   [
     {
       "AllowedOrigins": ["https://your-production-domain.com", "http://localhost:5500"],
       "AllowedMethods": ["GET"],
       "AllowedHeaders": ["*"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```
   Only `GET` is needed since uploads go through your server (not direct browser-to-R2), and downloads are simple `GET`s against presigned URLs.

## 5. How to test uploading a PDF

```bash
cd backend
npm install
cp .env.example .env   # fill in real R2 + JWT_SECRET values
npm run create-admin -- you@sulaksh.com "a-strong-password"
npm start
```

Then either:
- Open `http://localhost:4000/admin/login.html`, log in, and use the upload form, **or**
- curl directly:
  ```bash
  curl -c cookies.txt -X POST http://localhost:4000/api/auth/login \
    -H "Content-Type: application/json" \
    -d '{"email":"you@sulaksh.com","password":"a-strong-password"}'

  curl -b cookies.txt -X POST http://localhost:4000/api/admin/materials \
    -F "title=UPSC Prelims Notes 2024" \
    -F "exam=UPSC" -F "category=Prelims" -F "year=2024" \
    -F "file=@/path/to/real-file.pdf;type=application/pdf"
  ```
Confirm the object appears under `materials/upsc/prelims/2024/<uuid>.pdf` in
the R2 bucket dashboard, and the row appears in `GET /api/admin/materials`.

I ran this full flow locally (login → validation rejection of non-PDF files
→ successful metadata insert only after a successful R2 upload) against a
live server during development — see the routes for the exact rollback
behavior on partial failure.

## 6. How to test downloading a PDF

```bash
curl http://localhost:4000/api/materials/<material-id>/download?disposition=inline
# → { "url": "https://<account>.r2.cloudflarestorage.com/...", "expires_in": 300 }
```
Open the returned `url` in a browser within 5 minutes — it should render
(or, with `disposition=attachment`, download) the PDF directly from R2, with
no request ever touching your app server for the file bytes themselves.

## 7. Security issues / limitations still remaining

- **No rate limiting** on `/api/auth/login` or the admin upload endpoints yet — add something like `express-rate-limit` before production to blunt brute-force/spam.
- **No refresh-token rotation** — sessions are a flat JWT with a fixed expiry; fine for a small admin team, but add rotation if you expect many admins or long-lived sessions.
- **Orphan reconciliation is log-only** — if a DB insert fails right after a successful R2 upload, the code attempts cleanup and logs loudly if that cleanup itself fails, but there's no automated sweep job yet. Worth adding a periodic script that diffs R2 object keys against `materials.r2_object_key` and reports mismatches.
- **No virus/malware scanning** on uploaded PDFs — only structural validation (magic bytes, size, mimetype). If public-facing user uploads are added later (not just admin), add a scanning step.
- **SQLite is single-writer** — fine for one backend instance; if you scale to multiple server instances behind a load balancer, move to Postgres (schema is already portable SQL).
- **Admin creation is CLI-only by design** — there's no signup endpoint, which is intentional (avoids open admin registration), but it means admin onboarding requires server/SSH access. Consider a `super-admin`-gated invite endpoint if you need to onboard admins without shell access.
- **Presigned URLs are technically shareable** during their 5-minute window — anyone with the link can access the file until it expires. This is normal and expected for this pattern, just noting it's not per-user access control.
