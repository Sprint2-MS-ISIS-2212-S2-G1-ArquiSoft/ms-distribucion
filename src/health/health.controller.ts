import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';

@Controller('health')
export class HealthController {
  constructor(private readonly redis: RedisService) {}

  /**
   * Verifica el servicio y la conexion a Redis (PING), que es el unico
   * almacen de Distribucion.
   *
   * No consulta a los seis microservicios vecinos a proposito: la salud de
   * este contenedor no debe depender de ellos, igual que en ms-terceros.
   */
  @Get()
  async check(): Promise<{ status: string }> {
    try {
      await this.redis.ping();
    } catch {
      throw new ServiceUnavailableException({
        status: 'error',
        redis: 'unreachable',
      });
    }
    return { status: 'ok' };
  }
}
