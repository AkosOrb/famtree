import type { NextFunction, Request, Response } from 'express';

/**
 * Small, dependency-free hardening middleware: security headers, a
 * same-origin check for state-changing requests, and in-memory rate limits.
 */

// Photos are data: URLs; everything else is served from this origin. React sets
// inline styles through the CSSOM, which style-src does not restrict.
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

export function securityHeaders(req: Request, res: Response, next: NextFunction) {
  res.setHeader('Content-Security-Policy', CONTENT_SECURITY_POLICY);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  // Share links carry their key in the fragment, which browsers never send; this also hides the path and query.
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  // Tree data and account details must not end up in shared or browser caches.
  if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
  next();
}

/**
 * Rejects cross-site writes (CSRF defence in depth on top of SameSite cookies).
 * Browsers send Origin on every cross-origin and every non-GET request; clients
 * without one (curl, tests) are not browsers and carry no ambient cookie risk.
 */
export function sameOrigin(req: Request, res: Response, next: NextFunction) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  const origin = req.headers.origin;
  if (!origin) return next();
  let host: string;
  try {
    host = new URL(origin).host;
  } catch {
    host = '';
  }
  if (host !== req.host) return res.status(403).json({ error: 'Más oldalról érkező kérés elutasítva.' });
  next();
}

/** Fixed-window limiter keyed by client IP. Expired entries are swept so the map cannot grow without bound. */
export function rateLimiter(limit: number, windowMs: number, message = 'Túl sok kérés, várj egy kicsit.') {
  const hits = new Map<string, { count: number; reset: number }>();
  let nextSweep = 0;
  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    if (now > nextSweep) {
      for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
      nextSweep = now + windowMs;
    }
    const ip = req.ip ?? 'unknown';
    const entry = hits.get(ip);
    if (!entry || entry.reset < now) hits.set(ip, { count: 1, reset: now + windowMs });
    else if (++entry.count > limit) {
      res.setHeader('Retry-After', Math.ceil((entry.reset - now) / 1000));
      return res.status(429).json({ error: message });
    }
    next();
  };
}
