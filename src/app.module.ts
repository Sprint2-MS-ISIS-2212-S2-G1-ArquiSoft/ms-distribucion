import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ApiSociosModule } from './api-socios/api-socios.module';
import { HealthModule } from './health/health.module';
import { MetricasModule } from './metricas/metricas.module';
import { RedisModule } from './redis/redis.module';
import { SociosModule } from './socios/socios.module';

/**
 * Distribucion no tiene base de datos relacional: no hay TypeOrmModule porque
 * segun CLAUDE.md y el ADR este servicio no tiene RDS. Las cuotas y los
 * scopes por socio viven en Redis.
 *
 * Los tres componentes del diagrama estan en src/api-socios, src/rate-limiter
 * y src/validador-socio; los dos guards se registran dentro de ApiSociosModule.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    RedisModule,
    MetricasModule,
    SociosModule,
    ApiSociosModule,
    HealthModule,
  ],
})
export class AppModule {}
