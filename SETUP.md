# Backend Setup Guide

## Quick Setup

1. **Install Dependencies**
   ```bash
   npm install
   ```

2. **Configure Environment**
   Create a `.env` file with your database credentials. Example (use your own values):
   ```bash
   # DATABASE_URL=postgres://USER:PASSWORD@HOST:PORT/DATABASE?sslmode=require
   ```

3. **Run Database Migrations**
   ```bash
   npm run migrate
   ```
   This will create all necessary tables in your PostgreSQL database.

4. **Start the Server**
   ```bash
   npm run dev
   ```
   The API will be available at `http://localhost:3000`

## Database Connection

Set `DATABASE_URL` in `.env` with your PostgreSQL connection string (e.g. from Aiven, Neon, or Supabase). Use the full URL format with `?sslmode=require` for cloud databases.

## Testing the Connection

After starting the server, you should see:
```
Database connected successfully at [timestamp]
```

If you see connection errors, verify:
1. Your internet connection
2. The database credentials are correct
3. Your Aiven service is running
4. Your IP is whitelisted (if required by Aiven)

## Next Steps

1. Update `JWT_SECRET` in `.env` with a secure random string
2. Add your Google Maps API key for distance calculations
3. Configure payment gateway keys if needed
4. Test the API endpoints using Postman or curl

## API Health Check

Test the API is running:
```bash
curl http://localhost:3000/health
```

Expected response:
```json
{
  "status": "ok",
  "message": "Oprime Logistics API is running"
}
```


