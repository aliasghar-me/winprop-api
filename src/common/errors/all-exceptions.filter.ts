import { ExceptionFilter, Catch, ArgumentsHost, HttpException } from '@nestjs/common';
import { Response } from 'express';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse() as any;
      const code = body.code ?? this.defaultCode(status);
      const message = Array.isArray(body.message) ? body.message.join(', ')
        : (body.message ?? exception.message);
      return res.status(status).json({ statusCode: status, code, message });
    }
    return res.status(500).json({ statusCode: 500, code: 'INTERNAL', message: 'Internal error' });
  }
  private defaultCode(status: number) {
    if (status === 401) return 'UNAUTHORIZED';
    if (status === 403) return 'FORBIDDEN';
    if (status === 404) return 'NOT_FOUND';
    if (status === 400) return 'VALIDATION';
    return 'ERROR';
  }
}
