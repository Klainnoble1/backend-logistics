# Oprime Logistics Backend API

## Quick Start

1. Install dependencies:
```bash
npm install
```

2. Create a `.env` file in the backend root and add your credentials (see Environment Variables below).

3. Run database migrations:
```bash
npm run migrate
```

4. Start the server:
```bash
npm run dev
```

The API will be available at `http://localhost:3000`

## Environment Variables

Create a `.env` file in the backend root. Use either:

- **DATABASE_URL** – PostgreSQL connection string (recommended for Vercel), e.g.  
  `postgresql://user:password@host:5432/dbname?sslmode=require`

or individual DB vars:

- **DB_HOST**, **DB_PORT**, **DB_NAME**, **DB_USER**, **DB_PASSWORD**, **DB_SSL**

Required for auth:

- **JWT_SECRET** – Secret key for JWT tokens (use a strong random string in production)
- **JWT_EXPIRES_IN** – Token expiration (default: 7d)

Optional:

- **PORT** – Server port (default: 3000)
- **GOOGLE_MAPS_API_KEY** – For distance/pricing
- **STRIPE_SECRET_KEY**, **PAYSTACK_SECRET_KEY** – Payments
- **EXPO_ACCESS_TOKEN** – Push notifications

## Database

The application uses PostgreSQL. Run migrations to set up the database schema:

```bash
npm run migrate
```

This will create all necessary tables and indexes.

### Admin user (PHP admin + mobile app)

Create an admin user in the same `users` table:

```bash
npm run seed
```

Default credential (change in production via env):

- **Email:** `admin@oprime.com`
- **Password:** `Admin123!`

Override with env: **ADMIN_EMAIL**, **ADMIN_PASSWORD**, **ADMIN_NAME**. Use this login for the PHP admin panel and for the mobile app (Profile → Admin Dashboard).

## Deploy to Vercel

1. Push this backend to a GitHub repo (see root of repo for git steps).
2. In [Vercel](https://vercel.com), **Import** the repo and select the **backend** folder as the root (or deploy a repo that contains only this backend).
3. Set **Root Directory** to `.` if the repo is backend-only, or leave default.
4. Add environment variables in Vercel: **Settings → Environment Variables**
   - `DATABASE_URL` – PostgreSQL connection string (e.g. from Vercel Postgres, Neon, Supabase)
   - `JWT_SECRET` – strong random secret for JWT
   - Optional: `GOOGLE_MAPS_API_KEY`, `STRIPE_SECRET_KEY`, `PAYSTACK_SECRET_KEY`, `EXPO_ACCESS_TOKEN`
5. Deploy. The API will be available at `https://your-project.vercel.app/api/...` (e.g. `/api/health`, `/api/auth/login`).

## Push to GitHub

From the **backend** folder (this folder is its own git repo):

```bash
# Add your GitHub repo as remote (create the repo on GitHub first)
git remote add origin https://github.com/YOUR_USERNAME/oprime-logistics-backend.git

# Push (use main if your default branch is main)
git push -u origin master
```

Then import the repo in Vercel and set the root to this backend folder (or deploy a repo that contains only this backend).

## API Documentation

See the main README.md for API endpoint documentation.


