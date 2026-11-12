import { Module } from '@nestjs/common';
import { RedisService } from './redis.service';

/** Conexion compartida a Redis. */
@Module({
  providers: [RedisService],
  exports: [RedisService],
})
export class RedisModule {}
