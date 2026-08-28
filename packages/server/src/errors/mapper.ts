import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { AppError, type ErrorCode, httpStatusFor } from '@inventory/shared';

interface WireError {
  error: {
    code: ErrorCode;
    message: string;
    details?: Record<string, unknown>;
    correlationId: string;
  };
}

function wire(
  code: ErrorCode,
  message: string,
  correlationId: string,
  details?: Record<string, unknown>,
): WireError {
  return { error: { code, message, correlationId, ...(details ? { details } : {}) } };
}

/**
 * Single place that turns a thrown error into an HTTP response (spec §17, §37).
 * Nothing fails silently; technical detail goes to the log, the user gets a Thai
 * message + a correlation id.
 */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((err: unknown, req: FastifyRequest, reply: FastifyReply) => {
    const correlationId = req.id;

    if (AppError.is(err)) {
      req.log.warn({ err, code: err.code, details: err.details }, 'handled AppError');
      return reply
        .status(err.httpStatus)
        .send(wire(err.code, err.userMessage, correlationId, err.details));
    }

    if (err instanceof ZodError) {
      req.log.warn({ issues: err.issues }, 'request validation failed');
      return reply
        .status(httpStatusFor('VALIDATION_FAILED'))
        .send(wire('VALIDATION_FAILED', 'ข้อมูลไม่ถูกต้อง', correlationId, { issues: err.issues }));
    }

    // Fastify's own validation errors carry `.validation`
    if (typeof err === 'object' && err !== null && 'validation' in err) {
      req.log.warn({ err }, 'schema validation failed');
      return reply
        .status(400)
        .send(wire('VALIDATION_FAILED', 'ข้อมูลไม่ถูกต้อง', correlationId, {
          validation: (err as { validation: unknown }).validation,
        }));
    }

    req.log.error({ err }, 'unhandled error');
    return reply
      .status(500)
      .send(wire('INTERNAL', 'เกิดข้อผิดพลาดภายในระบบ', correlationId));
  });

  app.setNotFoundHandler((req, reply) => {
    reply.status(404).send(wire('NOT_FOUND', 'ไม่พบเส้นทางที่ร้องขอ', req.id));
  });
}
