import { NextFunction, Request, Response } from 'express';

export function botBlockMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const url = (req.originalUrl || req.url || '').toLowerCase();
  const pathOnly = (url.split('?')[0] || '/').replace(/\/+$/, '') || '/';
  const isProduction = process.env.NODE_ENV === 'production';

  const blockedExactPaths = new Set<string>([
    '/robots.txt',
    '/sitemap.xml',
    '/favicon.ico',
    '/config.json',
    '/app',
    '/pdown',
    '/wp-login.php',
    '/xmlrpc.php',
    '/.env',
    '/.git/config',
    '/autodiscover/autodiscover.json',
    '/manager/html',
    '/webui',
    '/owa',
    '/wiki',
    '/portal',
    '/hnap1',
    '/pandora_console',
  ]);

  const blockedPathPrefixes: string[] = [
    '/wp-admin',
    '/wp-',
    '/wp-content',
    '/cfide',
    '/geoserver',
    '/phpmyadmin',
    '/cgi-bin',
    '/cgi-mod',
    '/boaform',
    '/dana-',
    '/apps/zxtm',
    '/versa',
    '/dniapi',
    '/api/v1',
    '/api/server',
    '/api/vip',
    '/magento',
    '/nifi',
    '/kylin',
    '/actuator',
  ];

  const blockedSubstrings: string[] = [
    '..%2f..%2f..%2f',
    'etc%2fpasswd',
    '/etc/passwd',
  ];

  // Swagger route is allowed only in non-production environments.
  if (pathOnly === '/docs' || pathOnly.startsWith('/docs/')) {
    if (!isProduction) {
      next();
      return;
    }

    res.status(404).end();
    return;
  }

  if (
    blockedExactPaths.has(pathOnly) ||
    blockedPathPrefixes.some((prefix) => pathOnly.startsWith(prefix)) ||
    blockedSubstrings.some((substring) => url.includes(substring))
  ) {
    res.status(404).end();
    return;
  }

  next();
}
