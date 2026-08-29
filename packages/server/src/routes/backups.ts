import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  backupStatus,
  createBackup,
  deleteBackup,
  listBackups,
  readBackupArtifact,
  restoreBackup,
} from '../services/backup.js';

const idParam = z.object({ id: z.string().uuid() });
const createBody = z.object({ passphrase: z.string().min(8).optional() }).default({});
const restoreBody = z.object({
  passphrase: z.string().min(8).optional(),
  confirm: z.string(),
});

export async function backupRoutes(app: FastifyInstance): Promise<void> {
  app.post('/backups', async (req, reply) => {
    const body = createBody.parse(req.body ?? {});
    const row = await createBackup(app.db, { kind: 'MANUAL', passphrase: body.passphrase });
    return reply.status(201).send(row);
  });

  app.get('/backups', async () => listBackups(app.db));

  app.get('/backups/status', async () => backupStatus(app.db));

  app.get('/backups/:id/download', async (req, reply: FastifyReply) => {
    const { id } = idParam.parse(req.params);
    const { bytes } = await readBackupArtifact(app.db, id);
    return reply
      .header('content-type', 'application/octet-stream')
      .header('content-disposition', `attachment; filename="${id}.invbak"`)
      .send(bytes);
  });

  app.post('/backups/:id/restore', async (req) => {
    const { id } = idParam.parse(req.params);
    const body = restoreBody.parse(req.body ?? {});
    return restoreBackup(app.db, id, { passphrase: body.passphrase, confirm: body.confirm });
  });

  app.delete('/backups/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    await deleteBackup(app.db, id);
    return reply.status(204).send();
  });
}
