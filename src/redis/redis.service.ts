import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

/**
 * Conexion a Redis, el unico almacen de Distribucion: segun el ADR este
 * servicio no tiene RDS y las cuotas y los scopes por socio viven aqui.
 *
 * La URL sale de REDIS_URL (regla 4 de CLAUDE.md): nunca una IP ni un host
 * escrito en el codigo.
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly cliente: Redis;

  constructor(private readonly config: ConfigService) {
    const url = this.config.get<string>('REDIS_URL', 'redis://localhost:6379');
    this.cliente = new Redis(url, {
      // Sin reintentos infinitos al arrancar: si Redis no esta, /health lo dice.
      maxRetriesPerRequest: 2,
      lazyConnect: false,
    });
    this.cliente.on('error', (error) =>
      this.logger.error(`Error de conexion a Redis: ${String(error)}`),
    );
  }

  async ping(): Promise<string> {
    return this.cliente.ping();
  }

  async get(clave: string): Promise<string | null> {
    return this.cliente.get(clave);
  }

  /** SET ... NX: escribe solo si la clave no existe. Devuelve true si escribio. */
  async setIfAbsent(clave: string, valor: string): Promise<boolean> {
    const resultado = await this.cliente.set(clave, valor, 'NX');
    return resultado === 'OK';
  }

  async onModuleDestroy(): Promise<void> {
    await this.cliente.quit();
  }
}
