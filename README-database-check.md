# How to Check PostgreSQL Database

## Method 1: Using the Node.js Script (Easiest)

Run the provided script to check your database:

```bash
node check-database.js
```

This will show you:
- Database connection status
- Table structure
- Total sessions count
- Device types distribution
- Device types per app
- Recent sessions
- Device types per day

## Method 2: Using psql Command Line

If you have `psql` installed:

```bash
# Connect to database
psql $DATABASE_URL

# Or if DATABASE_URL is not set, use:
psql -h hostname -U username -d database_name
```

Once connected, run these SQL queries:

```sql
-- Check table structure
\d sessions

-- Count total sessions
SELECT COUNT(*) FROM sessions;

-- Check device types distribution
SELECT device_type, COUNT(*) as count
FROM sessions
WHERE device_type IS NOT NULL
GROUP BY device_type
ORDER BY count DESC;

-- Check device types per app
SELECT app, device_type, COUNT(*) as count
FROM sessions
WHERE device_type IS NOT NULL
GROUP BY app, device_type
ORDER BY app, count DESC;

-- Recent sessions with device types
SELECT app, session_id, device_type, country, city, started_at
FROM sessions
ORDER BY started_at DESC
LIMIT 10;

-- Device types per day (last 7 days)
SELECT 
  ((started_at AT TIME ZONE 'UTC')::date)::text AS day,
  CASE 
    WHEN device_type = 'desktop' THEN 'pc'
    WHEN device_type IN ('mobile', 'pc', 'tablet') THEN device_type
    ELSE 'other'
  END AS mapped_device_type,
  COUNT(*) as visits
FROM sessions
WHERE device_type IS NOT NULL
  AND started_at >= NOW() - INTERVAL '7 days'
GROUP BY day, mapped_device_type
ORDER BY day DESC, visits DESC;
```

## Method 3: Using pgAdmin (GUI Tool)

1. Download and install [pgAdmin](https://www.pgadmin.org/)
2. Add your database connection:
   - Right-click "Servers" → "Create" → "Server"
   - Enter connection details from your DATABASE_URL
3. Navigate to: `Servers` → `Your Server` → `Databases` → `Your Database` → `Schemas` → `public` → `Tables` → `sessions`
4. Right-click `sessions` → "View/Edit Data" → "All Rows"

## Method 4: Using DBeaver (Free GUI Tool)

1. Download [DBeaver](https://dbeaver.io/)
2. Create new connection → PostgreSQL
3. Enter connection details
4. Browse tables and run SQL queries

## Method 5: Using Render Dashboard (If using Render.com)

1. Go to your Render dashboard
2. Click on your PostgreSQL database
3. Click "Connect" → "psql" or "pgAdmin"
4. Run SQL queries directly

## Method 6: Check via API Endpoints

You can also check via your API:

```bash
# Check status endpoint (shows active sessions with device types)
curl -H "x-api-key: YOUR_KEY" https://your-server.com/v1/electrician/status

# Check stats endpoint (shows device types per day)
curl -H "x-api-key: YOUR_KEY" https://your-server.com/v1/electrician/stats?from=2025-11-07&to=2025-11-13
```

## Quick SQL Queries

### Check if device_type column exists:
```sql
SELECT column_name 
FROM information_schema.columns 
WHERE table_name = 'sessions' AND column_name = 'device_type';
```

### Update NULL device types (if needed):
```sql
UPDATE sessions 
SET device_type = 'desktop' 
WHERE device_type IS NULL 
LIMIT 10;
```

### Count sessions without device types:
```sql
SELECT COUNT(*) 
FROM sessions 
WHERE device_type IS NULL;
```

