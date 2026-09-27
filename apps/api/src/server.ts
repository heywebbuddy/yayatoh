import { serve } from '@hono/node-server';
import { createApp } from './app.ts';

const port = Number(process.env.PORT ?? 4000);
serve({ fetch: createApp().fetch, port }, (info) => console.info(`api listening on :${info.port}`));
