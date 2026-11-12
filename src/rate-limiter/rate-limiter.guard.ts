import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { MetricasService } from '../metricas/metricas.service';
import { RedisService, ResultadoBucket } from '../redis/redis.service';

/**
 * Rate limiter: el tercero de los componentes de Distribucion en el diagrama
 * de despliegue (cuotas por socio en Redis).
 *
 * ASR de escalabilidad (Ivonne) - aislamiento de carga por socio
 * Tactica:
 * control de demanda en el borde. Cada socio tiene SU PROPIO token bucket en
 * Redis (ver token-bucket.lua.ts), asi el exceso de un socio ruidoso se
 * rechaza aqui con 429, antes de consumir Catalogo, Identidad, Cotizacion o
 * sus bases, y no degrada a los demas socios. El monolito no tenia ningun
 * limite.
 *
 * Cuota: RATE_LIMIT_TPS tokens por segundo con rafaga RATE_LIMIT_BURST, igual
 * para todos; un socio puede tener la suya en el hash cuota:<socioId>
 * (HSET cuota:<id> tps 50 rafaga 100) sin reiniciar el servicio.
 *
 * Va ANTES del ValidadorSocioGuard (orden del controller): limita por el
 * X-Socio-Id que llega del gateway. Si el header falta, deja pasar para que el
 * validador responda el 401 de siempre.
 *
 * RATE_LIMIT_ENABLED=false lo apaga (corrida base del experimento, misma imagen).
 */
@Injectable()
export class RateLimiterGuard implements CanActivate {
  private readonly logger = new Logger(RateLimiterGuard.name);
  private readonly habilitado: boolean;
  private readonly tps: number;
  private readonly rafaga: number;
  private readonly failOpen: boolean;

  constructor(
    private readonly redis: RedisService,
    private readonly metricas: MetricasService,
    config: ConfigService,
  ) {
    this.habilitado =
      config.get<string>('RATE_LIMIT_ENABLED', 'true') === 'true';
    this.tps = Number(config.get<string>('RATE_LIMIT_TPS', '10'));
    this.rafaga = Number(config.get<string>('RATE_LIMIT_BURST', '20'));
    this.failOpen =
      config.get<string>('RATE_LIMIT_FAIL_OPEN', 'true') === 'true';
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const socioId = request.headers['x-socio-id'];
    if (typeof socioId !== 'string' || socioId.trim() === '') {
      return true; // el 401 lo da ValidadorSocioGuard
    }
    if (!this.habilitado) {
      this.metricas.aceptada(socioId);
      return true;
    }

    let resultado: ResultadoBucket;
    try {
      resultado = await this.redis.consumirToken(socioId, this.tps, this.rafaga);
    } catch (error) {
      // Redis no responde: fail-open prioriza disponibilidad (el servicio
      // sigue atendiendo sin cuotas); fail-closed responde 503.
      this.metricas.errorRateLimit();
      this.logger.error(`Rate limiter sin Redis: ${String(error)}`);
      if (this.failOpen) {
        this.metricas.aceptada(socioId);
        return true;
      }
      throw new ServiceUnavailableException('Control de cuota no disponible');
    }

    const response = context.switchToHttp().getResponse<Response>();
    response.setHeader('X-RateLimit-Limit', String(resultado.tps));
    response.setHeader(
      'X-RateLimit-Remaining',
      String(Math.max(0, Math.floor(resultado.tokensRestantes))),
    );

    if (!resultado.permitido) {
      this.metricas.rechazada(socioId);
      const segundos = Math.max(
        1,
        Math.ceil((1 - resultado.tokensRestantes) / resultado.tps),
      );
      response.setHeader('Retry-After', String(segundos));
      throw new HttpException(
        'Cuota de solicitudes excedida para el socio',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    this.metricas.aceptada(socioId);
    return true;
  }
}
