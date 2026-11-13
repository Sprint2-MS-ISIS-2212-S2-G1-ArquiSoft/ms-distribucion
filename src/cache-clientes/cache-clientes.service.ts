import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { Cliente, IdentidadClient } from '../clients/identidad.client';
import { MetricasService } from '../metricas/metricas.service';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class CacheClientesService {
  private readonly logger = new Logger(CacheClientesService.name);
  private readonly habilitada: boolean;
  private readonly ttlSegundos: number;

  constructor(
    private readonly identidadClient: IdentidadClient,
    private readonly redis: RedisService,
    private readonly metricas: MetricasService,
    config: ConfigService,
  ) {
    this.habilitada = config.get<string>('CACHE_ENABLED', 'true') === 'true';
    this.ttlSegundos = Number(config.get<string>('CACHE_TTL_S', '60'));
  }

  async verificarCliente(
    nombre: string,
    documento: string,
    socioId?: string,
  ): Promise<Cliente> {
    if (!this.habilitada) {
      return this.identidadClient.verificarCliente(nombre, documento, socioId);
    }

    const clave = `cliente:doc:${createHash('sha256').update(documento).digest('hex')}`;

    let enCache: string | null = null;
    try {
      enCache = await this.redis.get(clave);
    } catch (error) {
      this.metricas.errorCache();
      this.logger.warn(`Cache no disponible, se llama a Identidad: ${String(error)}`);
    }
    if (enCache) {
      this.metricas.cacheHit();
      return JSON.parse(enCache) as Cliente;
    }

    this.metricas.cacheMiss();
    const cliente = await this.identidadClient.verificarCliente(
      nombre,
      documento,
      socioId,
    );
    // Sin await: guardar en cache no debe sumar latencia a la respuesta.
    this.redis
      .setConTtl(clave, JSON.stringify(cliente), this.ttlSegundos)
      .catch(() => this.metricas.errorCache());
    return cliente;
  }
}
