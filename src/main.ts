import { NestFactory } from '@nestjs/core';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import compression from 'compression';
import * as fs from 'fs';
import * as path from 'path';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { WinstonLoggerService } from './common/logger/winston-logger.service';

async function bootstrap() {
  // Read HTTPS config from environment before creating app
  const enableHttps = process.env.HTTPS_ENABLED === 'true';
  const httpsOptions = enableHttps ? await getHttpsOptions() : null;
  
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
    httpsOptions: httpsOptions || undefined,
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
  const protocol = httpsOptions ? 'https' : 'http';
  await app.listen(port);

  logger.log(`🚀 Application is running on: ${protocol}://localhost:${port}`, 'Bootstrap');
  logger.log(`📚 API Documentation: ${protocol}://localhost:${port}/api-docs`, 'Bootstrap');
  logger.log(`🔗 Root URL redirects to: ${protocol}://localhost:${port}/api-docs`, 'Bootstrap');
}

async function getHttpsOptions(): Promise<{ key: Buffer; cert: Buffer } | null> {
  const keyPath = process.env.HTTPS_KEY_PATH || 'certs/key.pem';
  const certPath = process.env.HTTPS_CERT_PATH || 'certs/cert.pem';

  try {
    const key = fs.readFileSync(path.resolve(keyPath));
    const cert = fs.readFileSync(path.resolve(certPath));
    
    return { key, cert };
  } catch (error) {
    console.warn('⚠️  HTTPS certificates not found. Falling back to HTTP.');
    console.warn(`   Key path: ${keyPath}`);
    console.warn(`   Cert path: ${certPath}`);
    console.warn('   Set HTTPS_ENABLED=false or provide valid certificate paths.');
    console.warn('   Run: .\scripts\generate-ssl-cert.ps1 to generate self-signed certificates.');
    return null;
  }
}

bootstrap();

