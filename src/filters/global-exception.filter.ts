import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { FastifyRequest, FastifyReply } from 'fastify';
import { PrismaService } from '../prisma/prisma.service';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  constructor(private readonly prisma: PrismaService) {}

  async catch(exception: unknown, host: ArgumentsHost) {
    // Проверяем тип контекста - обрабатываем только HTTP
    const contextType = host.getType();
    if (contextType !== 'http') {
      // Для не-HTTP контекстов (WebSocket, RPC) просто логируем
      this.logger.error(
        `[calls-service] Non-HTTP exception in ${contextType} context`,
        exception instanceof Error ? exception.stack : String(exception),
      );
      return;
    }

    const ctx = host.switchToHttp();
    const response = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest<FastifyRequest>();

    // Проверяем что response валидный
    if (!response || typeof response.status !== 'function') {
      this.logger.error(
        `[calls-service] Invalid response object`,
        exception instanceof Error ? exception.stack : String(exception),
      );
      return;
    }

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const errorMessage =
      exception instanceof HttpException
        ? exception.message
        : exception instanceof Error
        ? exception.message
        : 'Unknown error';

    const errorType =
      exception instanceof Error ? exception.constructor.name : 'UnknownError';

    const stackTrace =
      exception instanceof Error ? exception.stack : undefined;

    if (status >= 500) {
      try {
        await this.prisma.errorLog.create({
          data: {
            service: 'calls-service',
            errorType,
            errorMessage,
            stackTrace,
            userId: (request as any)?.user?.userId || null,
            userRole: (request as any)?.user?.role || null,
            requestUrl: request?.url || 'unknown',
            requestMethod: request?.method || 'unknown',
            ip: request?.ip || (request?.headers?.['x-forwarded-for'] as string) || null,
            userAgent: request?.headers?.['user-agent'] || null,
            metadata: JSON.parse(JSON.stringify({
              body: request?.body ?? null,
              params: request?.params ?? null,
              query: request?.query ?? null,
            })),
          },
        });
      } catch (dbError) {
        this.logger.error(`🔥 Failed to write error log to DB`, dbError);
      }
    }

    this.logger.error(
      `[calls-service] ${request?.method || 'UNKNOWN'} ${request?.url || 'unknown'} - ${status} ${errorMessage}`,
      stackTrace,
    );

    response.status(status).send({
      success: false,
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request?.url || 'unknown',
      message: errorMessage,
    });
  }
}

