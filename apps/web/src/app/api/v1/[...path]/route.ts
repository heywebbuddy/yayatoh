import { scannerRoutes } from '@yayatoh/checkin/routes';
import { problem, problemFor, problemResponse } from '@yayatoh/platform/http';
import { Hono } from 'hono';
import { ports } from '@/server/ports.ts';

/**
 * The `/v1` scanner endpoints, same-origin for the Scan PWA. The router is the one `apps/api`
 * serves at `api.yayatoh.com/v1`; only the mount point differs.
 */
const app = new Hono()
  .basePath('/api/v1')
  .route('/', scannerRoutes(ports))
  .onError((err) => {
    const p = problemFor(err);
    if (p.code === 'internal') console.error(err);
    return problemResponse(p);
  })
  .notFound(() => problemResponse(problem('not_found')));

const handle = (req: Request) => app.fetch(req);
export const GET = handle;
export const POST = handle;
