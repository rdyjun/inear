import { NestFactory } from '@nestjs/core';
import { AppModule } from '@/app.module';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { Logger, ValidationPipe } from '@nestjs/common';
import { GlobalExceptionFilter } from '@/common/exceptions/global-exception.filter';
import cookieParser from 'cookie-parser';
import { RedisIoAdapter } from '@/common/redis-adapter/redis-io.adapter';

const processLogger = new Logger('Process');

// Safety net for promises the Socket.IO Redis adapter does not await.
// A listener stops Node from exiting; this one only logs.
process.on('unhandledRejection', (reason: unknown) => {
  const error = reason instanceof Error ? reason : new Error(String(reason));
  processLogger.error(`Unhandled rejection: ${error.message}`, error.stack);
});

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });

  app.useLogger(app.get(WINSTON_MODULE_NEST_PROVIDER));
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe());
  app.use(cookieParser());

  const config = new DocumentBuilder()
    .setTitle('inear')
    .setDescription('inear API description')
    .setVersion('1.0.0')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/api-document', app, document);

  const redisIoAdapter = new RedisIoAdapter(app);
  await redisIoAdapter.connectToRedis();
  app.useWebSocketAdapter(redisIoAdapter);

  app.useGlobalFilters(new GlobalExceptionFilter());

  app.useStaticAssets(join(__dirname, '..', 'public'), {
    prefix: '/',
  });
  app.enableCors({
    origin: ['http://localhost:5173', 'https://www.inear.live'],
    credentials: true,
  });
  await app.listen(process.env.PORT ?? 3000);
  process.on('SIGTERM', async () => {
    await redisIoAdapter.disconnectFromRedis();
    await app.close();
  });
  process.on('SIGINT', async () => {
    await redisIoAdapter.disconnectFromRedis();
    await app.close();
  });
}

bootstrap();
