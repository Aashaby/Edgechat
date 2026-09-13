import type { Hono } from 'hono';
import { runSystemCheck } from '../maintenance/system-check.ts';

export function registerMaintenanceRoutes(app: Hono) {
  app.get('/api/admin/maintenance', async (c) => {
    c.header('Cache-Control', 'private, no-store');
    return c.json(await runSystemCheck(c.env));
  });
}
