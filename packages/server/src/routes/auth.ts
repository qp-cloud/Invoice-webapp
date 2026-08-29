import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authRequired, isUnlocked, SESSION_COOKIE, setPin, unlock } from '../services/auth.js';

const pinBody = z.object({ pin: z.string().min(1).max(128) });

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.get('/auth/status', async (req) => {
    const required = await authRequired(app.db);
    return {
      authRequired: required,
      unlocked: !required || (await isUnlocked(app.db, req.cookies[SESSION_COOKIE])),
    };
  });

  app.post('/auth/unlock', async (req, reply) => {
    const { pin } = pinBody.parse(req.body);
    const cookie = await unlock(app.db, pin);
    reply.setCookie(cookie.name, cookie.value, cookie.options);
    return { unlocked: true };
  });

  app.post('/auth/lock', async (_req, reply) => {
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { unlocked: false };
  });

  app.post('/auth/set-pin', async (req) => {
    // Allowed only when no PIN is configured yet, or the caller is already unlocked.
    const required = await authRequired(app.db);
    if (required && !(await isUnlocked(app.db, req.cookies[SESSION_COOKIE]))) {
      return { ok: false };
    }
    const { pin } = pinBody.parse(req.body);
    await setPin(app.db, pin);
    return { ok: true };
  });
}
