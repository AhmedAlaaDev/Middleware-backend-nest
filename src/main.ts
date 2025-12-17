import { ValidationPipe, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import compression from 'compression';
import { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';

import { AppModule } from './app.module';

import { GlobalExceptionFilter } from '@/common/filters/global-exception.filter';
import { GlobalResponseInterceptor } from '@/common/interceptors/global-response.interceptor';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // API Versioning
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1',
  });

  // CORS
  const allowedOrigins = process.env.ALLOWED_CORS_ORIGINS?.split(',') || [];

  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Api-Version',
      'X-Refresh-Token',
    ],
    exposedHeaders: ['Content-Disposition'],
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

  // use global exception filter to handle all exceptions
  app.useGlobalFilters(new GlobalExceptionFilter());

  // use global interceptor to transform response
  app.useGlobalInterceptors(new GlobalResponseInterceptor());

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
  app.setGlobalPrefix(process.env.PREFIX ?? '');

  // middleware to redirect from '/' to '/docs/
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.url === '/') {
      return res.redirect('/docs');
    }
    next();
  });

  await app.listen(process.env.PORT ?? 3000);
}

bootstrap().catch(console.error);
