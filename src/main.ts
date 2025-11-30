import { NestFactory } from '@nestjs/core';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import compression from 'compression';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { WinstonLoggerService } from './common/logger/winston-logger.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
  });

  const configService = app.get(ConfigService);
  const logger = app.get(WinstonLoggerService);

  app.useLogger(logger);
  app.use(helmet());
  app.use(compression());

  // Global prefix
  app.setGlobalPrefix('api');

  // API Versioning
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1',
  });

  // CORS
  const allowedOrigins = configService.get<string[]>('ALLOWED_CORS_ORIGINS', []);
  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Api-Version'],
    exposedHeaders: ['Content-Disposition'],
  });

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // Global filters
  app.useGlobalFilters(new AllExceptionsFilter(logger));

  // Global interceptors
  app.useGlobalInterceptors(
    new LoggingInterceptor(logger),
    new TransformInterceptor(),
  );

  // Swagger documentation
  const config = new DocumentBuilder()
    .setTitle('MG D365FO Middleware API')
    .setDescription('Middleware API for IST and Dynamics 365 FO Integration')
    .setVersion('1.0')
    .addBearerAuth()
    .addApiKey({ type: 'apiKey', name: 'X-Api-Version', in: 'header' })
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api-docs', app, document, {
    customSiteTitle: 'MG D365FO Middleware API Docs',
    customCss: '.swagger-ui .topbar { display: none }',
  });

  // Redirect root path to Swagger docs
  app.getHttpAdapter().get('/', (req: any, res: any) => {
    res.redirect('/api-docs');
  });

  const port = configService.get<number>('PORT', 3000);
  await app.listen(port);

  logger.log(`🚀 Application is running on: http://localhost:${port}`, 'Bootstrap');
  logger.log(`📚 API Documentation: http://localhost:${port}/api-docs`, 'Bootstrap');
  logger.log(`🔗 Root URL redirects to: http://localhost:${port}/api-docs`, 'Bootstrap');
}

bootstrap();

