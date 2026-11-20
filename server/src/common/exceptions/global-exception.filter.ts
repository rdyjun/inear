import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { isDependencyUnavailable } from '@/common/runtime/dependency';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    if (exception instanceof HttpException) {
      this.logException(exception, { path: request.url });
      return response.status(exception.getStatus()).json({
        time: new Date().toISOString(),
        ...this.getExceptionResponse(exception),
        errorName: exception.name,
      });
    }
    if (isDependencyUnavailable(exception)) {
      this.logException(exception, { path: request.url });
      return response.status(HttpStatus.SERVICE_UNAVAILABLE).json({
        statusCode: HttpStatus.SERVICE_UNAVAILABLE,
        message: '일시적으로 데이터베이스나 Redis를 사용할 수 없습니다.',
        error: 'Service Unavailable',
        time: new Date().toISOString(),
      });
    }
    // 예상치 못한 예외 처리
    this.logException(exception, { path: request.url });
    return this.getUnexpectedExceptionResponse(exception, response);
  }

  private getExceptionResponse(exception: any): Record<string, any> {
    const exceptionResponse = exception.getResponse();
    return exceptionResponse instanceof Object
      ? exceptionResponse
      : { message: exceptionResponse };
  }

  private getUnexpectedExceptionResponse(exception: any, response: Response) {
    return response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      error: exception.constructor.name,
      errorName: exception.code,
      message: exception.message,
      time: exception.time,
    });
  }

  private logException(exception: any, requestInfo: any) {
    this.logger.error({
      type: exception.constructor.name,
      message: exception.message,
      ...requestInfo,
    });
  }
}
