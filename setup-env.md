# Setting Up DATABASE_URL

## Option 1: If using PostgreSQL (Render.com, Heroku, etc.)

1. **Get your DATABASE_URL from your hosting provider:**
   - **Render.com**: Go to your PostgreSQL service → "Connect" → Copy "External Connection String"
   - **Heroku**: Run `heroku config:get DATABASE_URL`
   - **Local PostgreSQL**: `postgresql://username:password@localhost:5432/database_name`

2. **Create a `.env` file in the project root:**
   ```bash
   # Copy the example file
   cp .env.example .env
   ```

3. **Edit `.env` and add your DATABASE_URL:**
   ```
   DATABASE_URL=postgresql://user:pass@host:port/dbname
   STORAGE=postgres
   PGSSL=require
   ```

## Option 2: If using File-based Storage (No Database)

If you're using file-based storage (not PostgreSQL), you don't need DATABASE_URL. The server will use files in the `data/apps` directory.

To check which storage you're using, look at your server logs when it starts - it will say:
- `storage=postgres` if using PostgreSQL
- `storage=file` if using file-based

## Option 3: Check Your Current Setup

Run this to see what storage type is configured:
```bash
node -e "import('dotenv/config').then(() => console.log('STORAGE:', process.env.STORAGE || 'file (default)'));"
```

## Quick Setup for Render.com

If you're using Render.com:

1. Go to your Render dashboard
2. Click on your PostgreSQL database
3. Copy the "External Connection String"
4. Create `.env` file:
   ```
   DATABASE_URL=<paste connection string here>
   STORAGE=postgres
   PGSSL=require
   ```

## Quick Setup for Local PostgreSQL

If you have PostgreSQL running locally:

1. Create `.env` file:
   ```
   DATABASE_URL=postgresql://postgres:yourpassword@localhost:5432/metrics_db
   STORAGE=postgres
   ```

2. Make sure PostgreSQL is running:
   ```bash
   # Windows
   # Check if PostgreSQL service is running in Services

   # Mac/Linux
   sudo service postgresql status
   ```

## Verify Connection

After setting up, test the connection:
```bash
npm run check-db
```

