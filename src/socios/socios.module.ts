import { Module } from '@nestjs/common';
import { RedisModule } from '../redis/redis.module';
import { SociosService } from './socios.service';

/** Registro de socios en Redis, con carga de la semilla al arrancar. */
@Module({
  imports: [RedisModule],
  providers: [SociosService],
  exports: [SociosService],
})
export class SociosModule {}
