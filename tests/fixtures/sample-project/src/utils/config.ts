interface AppConfig {
  jwtSecret: string;
  dbUrl: string;
  port: number;
}

export function getConfig(): AppConfig {
  return {
    jwtSecret: process.env.JWT_SECRET ?? 'dev-secret',
    dbUrl: process.env.DATABASE_URL ?? 'postgres://localhost:5432/app',
    port: parseInt(process.env.PORT ?? '3000'),
  };
}
