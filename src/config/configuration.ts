export const configuration = () => ({
  port: parseInt(process.env.PORT || '3000', 10),
  environment: process.env.NODE_ENV || 'development',
  
  // Database
  database: {
    url: process.env.DATABASE_URL, // Prisma uses DATABASE_URL, but we support individual config too
    host: process.env.DATABASE_HOST || 'localhost',
    port: parseInt(process.env.DATABASE_PORT || '5432', 10),
    username: process.env.DATABASE_USERNAME || 'postgres',
    password: process.env.DATABASE_PASSWORD,
    name: process.env.DATABASE_NAME || 'mgd365fomiddleware',
    logging: process.env.DATABASE_LOGGING === 'true',
    maxConnections: parseInt(process.env.DATABASE_MAX_CONNECTIONS || '20', 10),
  },

  // MongoDB
  mongodb: {
    uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/d365fomiddleware',
    maxPoolSize: parseInt(process.env.MONGODB_MAX_POOL_SIZE || '10', 10),
  },

  // Redis
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD,
  },

  // Cache
  cache: {
    ttl: parseInt(process.env.CACHE_TTL || '300', 10), // 5 minutes
    maxItems: parseInt(process.env.CACHE_MAX_ITEMS || '1000', 10),
    l1Ttl: parseInt(process.env.CACHE_L1_TTL || '300', 10), // 5 minutes
    l2Ttl: parseInt(process.env.CACHE_L2_TTL || '1800', 10), // 30 minutes
    l3Ttl: parseInt(process.env.CACHE_L3_TTL || '7200', 10), // 2 hours
  },

  // JWT
  jwt: {
    secret: process.env.JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN || '15d',
    audience: process.env.JWT_AUDIENCE,
    issuer: process.env.JWT_ISSUER || 'mg-d365fo-middleware',
  },

  // CORS
  allowedCorsOrigins: process.env.ALLOWED_CORS_ORIGINS?.split(',') || [
    'http://localhost:3000',
    'http://localhost:5500',
  ],

  // Throttling
  throttle: {
    ttl: parseInt(process.env.THROTTLE_TTL || '60', 10),
    limit: parseInt(process.env.THROTTLE_LIMIT || '100', 10),
  },

  // D365FO
  d365fo: {
    tenantId: process.env.D365FO_TENANT_ID,
    clientId: process.env.D365FO_CLIENT_ID,
    clientSecret: process.env.D365FO_CLIENT_SECRET,
    resource: process.env.D365FO_RESOURCE,
    authority: process.env.D365FO_AUTHORITY || 'https://login.microsoftonline.com',
  },

  // Resilience
  resilience: {
    circuitBreaker: {
      failureThreshold: parseInt(process.env.CIRCUIT_BREAKER_FAILURE_THRESHOLD || '5', 10),
      timeout: parseInt(process.env.CIRCUIT_BREAKER_TIMEOUT || '30000', 10),
      resetTimeout: parseInt(process.env.CIRCUIT_BREAKER_RESET_TIMEOUT || '30000', 10),
      errorThresholdPercentage: parseInt(process.env.CIRCUIT_BREAKER_ERROR_THRESHOLD_PERCENTAGE || '50', 10),
    },
    retry: {
      maxRetries: parseInt(process.env.RETRY_MAX_RETRIES || '3', 10),
      delay: parseInt(process.env.RETRY_DELAY || '1000', 10),
      backoffMultiplier: parseFloat(process.env.RETRY_BACKOFF_MULTIPLIER || '2'),
    },
    timeout: {
      requestTimeout: parseInt(process.env.REQUEST_TIMEOUT || '30000', 10),
    },
  },

  // Background Jobs (Bull)
  bull: {
    jobAttempts: parseInt(process.env.BULL_JOB_ATTEMPTS || '3', 10),
    jobBackoffDelay: parseInt(process.env.BULL_JOB_BACKOFF_DELAY || '2000', 10),
    removeOnCompleteAge: parseInt(process.env.BULL_JOB_REMOVE_ON_COMPLETE_AGE || '3600', 10),
    removeOnCompleteCount: parseInt(process.env.BULL_JOB_REMOVE_ON_COMPLETE_COUNT || '1000', 10),
    removeOnFailAge: parseInt(process.env.BULL_JOB_REMOVE_ON_FAIL_AGE || '86400', 10),
  },

  // HTTP Configuration
  http: {
    maxRedirects: parseInt(process.env.HTTP_MAX_REDIRECTS || '5', 10),
  },

  // HTTPS Configuration
  https: {
    enabled: process.env.HTTPS_ENABLED === 'true',
    keyPath: process.env.HTTPS_KEY_PATH || 'certs/key.pem',
    certPath: process.env.HTTPS_CERT_PATH || 'certs/cert.pem',
  },

  // Logging
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    postgres: {
      enabled: process.env.LOG_POSTGRES_ENABLED === 'true',
      tableName: process.env.LOG_TABLE_NAME || 'logs',
    },
  },
});

