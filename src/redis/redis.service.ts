import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { TOKEN_BUCKET_LUA } from '../rate-limiter/token-bucket.lua';

/** Resultado de consumir un token del bucket de un socio. */
export interface ResultadoBucket {
  permitido: boolean;
  tokensRestantes: number;
  /** Tasa aplicada (tokens/s): la propia del socio o la de entorno. */
  tps: number;
}

type RedisConBucket = Redis & {
  tokenBucket(
    claveBucket: string,
    claveCuota: string,
    tps: number,
    rafaga: number,
  ): Promise<[number, string, string]>;
};

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
  private readonly cliente: RedisConBucket;

  constructor(private readonly config: ConfigService) {
    const url = this.config.get<string>('REDIS_URL', 'redis://localhost:6379');
    this.cliente = new Redis(url, {
      // Sin reintentos infinitos al arrancar: si Redis no esta, /health lo dice.
      maxRetriesPerRequest: 2,
      lazyConnect: false,
      // Tope de espera por comando: si Redis se cae, la peticion no se queda
      // colgada; el rate limiter y la cache degradan (ver sus comentarios).
      commandTimeout: Number(
        this.config.get<string>('REDIS_TIMEOUT_MS', '500'),
      ),
    }) as RedisConBucket;
    this.cliente.defineCommand('tokenBucket', {
      numberOfKeys: 2,
      lua: TOKEN_BUCKET_LUA,
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

  /** SET ... EX: escribe con expiracion (cache-aside con TTL corto). */
  async setConTtl(clave: string, valor: string, segundos: number): Promise<void> {
    await this.cliente.set(clave, valor, 'EX', segundos);
  }

  /**
   * Reemplaza por completo un SET de Redis (DEL + SADD en un pipeline).
   *
   * ASR de seguridad (Martin): se usa para sembrar socio:<id>:scopes. Es
   * reemplazo y no SADD a secas para que, al cambiar el alcance de un socio en
   * socios.seed.json y reiniciar, los scopes retirados desaparezcan de verdad
   * en vez de quedarse pegados en el SET anterior.
   */
  async reemplazarConjunto(clave: string, miembros: string[]): Promise<void> {
    const pipeline = this.cliente.pipeline().del(clave);
    if (miembros.length > 0) {
      pipeline.sadd(clave, ...miembros);
    }
    await pipeline.exec();
  }

  /**
   * SISMEMBER: un solo comando O(1).
   *
   * ASR de seguridad (Martin): es el chequeo de alcance que corre en CADA
   * peticion del socio, asi que tiene que costar lo minimo. Por eso los scopes
   * son un SET y no un JSON que habria que traer completo y parsear: la medida
   * del ASR es p95 < 500 ms a 75 TPS.
   */
  async esMiembro(clave: string, miembro: string): Promise<boolean> {
    return (await this.cliente.sismember(clave, miembro)) === 1;
  }

  /**
   * Consume un token del bucket del socio con el script Lua atomico.
   * tps/rafaga son los de entorno; si existe el hash cuota:<socioId> con
   * campos tps/rafaga, el script usa esos (cuota propia del socio).
   */
  async consumirToken(
    socioId: string,
    tps: number,
    rafaga: number,
  ): Promise<ResultadoBucket> {
    const [permitido, tokens, tasa] = await this.cliente.tokenBucket(
      `ratelimit:${socioId}`,
      `cuota:${socioId}`,
      tps,
      rafaga,
    );
    return {
      permitido: permitido === 1,
      tokensRestantes: Number(tokens),
      tps: Number(tasa),
    };
  }

  async onModuleDestroy(): Promise<void> {
    await this.cliente.quit();
  }
}
