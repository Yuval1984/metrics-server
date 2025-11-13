-- SQL script to add random device types to existing sessions
-- Run this directly in your PostgreSQL database

-- Update existing sessions with random device types
UPDATE sessions 
SET device_type = CASE 
  WHEN random() < 0.4 THEN 'desktop'
  WHEN random() < 0.7 THEN 'mobile'
  WHEN random() < 0.9 THEN 'tablet'
  ELSE 'pc'
END
WHERE app = 'electrician' 
  AND (device_type IS NULL OR device_type = 'unknown');

-- Verify the results
SELECT 
  CASE 
    WHEN device_type = 'desktop' THEN 'pc'
    WHEN device_type IN ('mobile', 'pc', 'tablet') THEN device_type
    ELSE 'other'
  END AS mapped_device_type,
  COUNT(*) as count
FROM sessions
WHERE app = 'electrician'
  AND device_type IS NOT NULL
GROUP BY mapped_device_type
ORDER BY count DESC;

-- Show device types per day for recent days
SELECT 
  ((started_at AT TIME ZONE 'UTC')::date)::text AS day,
  CASE 
    WHEN device_type = 'desktop' THEN 'pc'
    WHEN device_type IN ('mobile', 'pc', 'tablet') THEN device_type
    ELSE 'other'
  END AS device_type,
  COUNT(*) as visits
FROM sessions
WHERE app = 'electrician'
  AND device_type IS NOT NULL
  AND started_at >= NOW() - INTERVAL '7 days'
GROUP BY day, device_type
ORDER BY day DESC, visits DESC;

