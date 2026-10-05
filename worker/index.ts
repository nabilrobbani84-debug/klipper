import { createApp } from './app.js';
import { runMaintenance } from './cron.js';
import type { Env, JobMessage } from './env.js';
import { handleQueueBatch } from './pipeline.js';

export { MediaContainer } from './container.js';
// Required for container outbound interception (r2.internal / api.internal).
export { ContainerProxy } from '@cloudflare/containers';

const app = createApp();

export default {
  fetch: (request, env, ctx) => app.fetch(request, env, ctx),
  queue: (batch, env) => handleQueueBatch(batch, env),
  scheduled: (_controller, env, ctx) => {
    ctx.waitUntil(runMaintenance(env).then(() => undefined));
  },
} satisfies ExportedHandler<Env, JobMessage>;
