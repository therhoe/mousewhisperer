// Geo-location lookup using ip-api.com (free, 45 requests/minute)

interface GeoData {
  country: string | null;
  countryCode: string | null;
  city: string | null;
  region: string | null;
  timezone: string | null;
}

// Simple in-memory cache to avoid hitting rate limits
const geoCache = new Map<string, { data: GeoData; timestamp: number }>();
const CACHE_TTL = 1000 * 60 * 60; // 1 hour

export function getClientIP(request: Request): string | null {
  // Try various headers in order of preference
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    // x-forwarded-for can contain multiple IPs, take the first one (client IP)
    return forwardedFor.split(",")[0]?.trim() || null;
  }

  // Cloudflare
  const cfConnectingIP = request.headers.get("cf-connecting-ip");
  if (cfConnectingIP) return cfConnectingIP;

  // Nginx
  const realIP = request.headers.get("x-real-ip");
  if (realIP) return realIP;

  // Vercel
  const vercelIP = request.headers.get("x-vercel-forwarded-for");
  if (vercelIP) return vercelIP.split(",")[0]?.trim() || null;

  return null;
}

export async function getGeoData(ip: string | null): Promise<GeoData> {
  const emptyResult: GeoData = {
    country: null,
    countryCode: null,
    city: null,
    region: null,
    timezone: null,
  };

  if (!ip) return emptyResult;

  // Skip private/local IPs
  if (isPrivateIP(ip)) return emptyResult;

  // Check cache
  const cached = geoCache.get(ip);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  try {
    // ip-api.com - free tier, no API key required
    // Rate limit: 45 requests per minute
    const response = await fetch(
      `http://ip-api.com/json/${ip}?fields=status,country,countryCode,regionName,city,timezone`,
      { signal: AbortSignal.timeout(3000) } // 3 second timeout
    );

    if (!response.ok) {
      console.error(`Geo lookup failed for ${ip}: ${response.status}`);
      return emptyResult;
    }

    const data = await response.json();

    if (data.status !== "success") {
      return emptyResult;
    }

    const geoData: GeoData = {
      country: data.country || null,
      countryCode: data.countryCode || null,
      city: data.city || null,
      region: data.regionName || null,
      timezone: data.timezone || null,
    };

    // Cache the result
    geoCache.set(ip, { data: geoData, timestamp: Date.now() });

    return geoData;
  } catch (error) {
    console.error(`Geo lookup error for ${ip}:`, error);
    return emptyResult;
  }
}

function isPrivateIP(ip: string): boolean {
  // Check for private IP ranges
  const privateRanges = [
    /^10\./,
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
    /^192\.168\./,
    /^127\./,
    /^localhost$/i,
    /^::1$/,
    /^fc00:/i,
    /^fe80:/i,
  ];

  return privateRanges.some((range) => range.test(ip));
}

// Cleanup old cache entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of geoCache.entries()) {
    if (now - entry.timestamp > CACHE_TTL) {
      geoCache.delete(ip);
    }
  }
}, CACHE_TTL);
