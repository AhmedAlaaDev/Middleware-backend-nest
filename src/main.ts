import dns from 'node:dns';

import { ValidationPipe, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import compression from 'compression';
import { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';

import { AppModule } from './app.module';

import { GlobalResponseInterceptor } from '@/common/interceptors/global-response.interceptor';
import { botBlockMiddleware } from '@/common/middlewares/bot-block.middleware';
import { TraceContextMiddleware } from '@/modules/observability/middleware/trace-context.middleware';

dns.setDefaultResultOrder('ipv4first');

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useLogger(app.get(Logger));
  const isProduction = process.env.NODE_ENV === 'production';
  const isSwaggerEnabled = !isProduction;

  // Early middleware to short-circuit obviously invalid/bot requests
  app.use(botBlockMiddleware);
  const traceContextMiddleware = app.get(TraceContextMiddleware);
  app.use(traceContextMiddleware.use.bind(traceContextMiddleware));

  // API Versioning
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1',
  });

  // CORS
  const allowedOrigins = process.env.ALLOWED_CORS_ORIGINS?.split(',') || [];

  app.enableCors({
    origin: isProduction ? allowedOrigins : true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Api-Version',
      'X-Refresh-Token',
      'X-Request-ID',
      'X-Correlation-ID',
    ],
    exposedHeaders: ['Content-Disposition', 'X-Request-ID', 'X-Correlation-ID'],
  });

  // use global validation pipe to validate DTOs in the controllers
  app.useGlobalPipes(
    new ValidationPipe({
      // only allow properties that are defined in the DTO
      whitelist: true,

      // transform the DTO properties to the correct type
      transform: true,
    }),
  );

  // use global interceptor to transform response
  app.useGlobalInterceptors(new GlobalResponseInterceptor());

  if (isSwaggerEnabled) {
    // Swagger setup
    const config = new DocumentBuilder()
      .setTitle('D365FO Middleware')
      .setDescription('D365FO Middleware API')
      .setVersion('1.0')
      .addBearerAuth()
      .build();

    const document = () => SwaggerModule.createDocument(app, config);

    SwaggerModule.setup('docs', app, document, {
      swaggerOptions: {
        persistAuthorization: true, // enable to persist authorization token
      },
    });
  }

  app.use(helmet());
  app.use(
    compression({
      filter: (req: Request, res: Response) => {
        if (req.headers['x-no-compression']) {
          return false;
        }
        return compression.filter(req, res);
      },
    }),
  );

  // use global prefix for all routes
  const globalPrefix = (process.env.PREFIX ?? '').replace(/^\/+|\/+$/g, '');
  if (globalPrefix) {
    app.setGlobalPrefix(globalPrefix);
  }

  // middleware to redirect from '/' to '/docs/
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (isSwaggerEnabled && req.url === '/') {
      return res.redirect('/docs');
    }
    next();
  });

  await app.listen(process.env.PORT ?? 3000);
}

bootstrap().catch(console.error);
