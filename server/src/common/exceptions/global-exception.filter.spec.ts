import { HttpException, HttpStatus } from '@nestjs/common';
import { GlobalExceptionFilter } from '@/common/exceptions/global-exception.filter';

describe('GlobalExceptionFilter', () => {
  function host() {
    const response = {
      statusCode: 0,
      body: undefined as unknown,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(body: unknown) {
        this.body = body;
        return this;
      },
    };
    return {
      response,
      arguments: {
        switchToHttp: () => ({
          getResponse: () => response,
          getRequest: () => ({ url: '/api/room/1' }),
        }),
      },
    };
  }

  it('returns 503 when mysql or redis is down', () => {
    const { response, arguments: argumentsHost } = host();
    new GlobalExceptionFilter().catch(
      Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:6379'), {
        code: 'ECONNREFUSED',
      }),
      argumentsHost as never,
    );
    expect(response.statusCode).toBe(HttpStatus.SERVICE_UNAVAILABLE);
    expect(response.body).toMatchObject({
      statusCode: 503,
      error: 'Service Unavailable',
    });
  });

  it('keeps application http errors', () => {
    const { response, arguments: argumentsHost } = host();
    new GlobalExceptionFilter().catch(
      new HttpException('missing', HttpStatus.NOT_FOUND),
      argumentsHost as never,
    );
    expect(response.statusCode).toBe(404);
  });
});
