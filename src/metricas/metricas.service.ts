import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { hostname } from 'node:os';

interface Contadores {
  cacheHits: number;
  cacheMisses: number;
  cacheErrores: number;
  rateLimitErrores: number;
  aceptadas: Record<string, number>;
  rechazos429: Record<string, number>;
}

const vacios = (): Contadores => ({
  cacheHits: 0,
  cacheMisses: 0,
  cacheErrores: 0,
  rateLimitErrores: 0,
  aceptadas: {},
  rechazos429: {},
});

/**
 * Metricas del experimento del ASR de escalabilidad: hit ratio de la cache de
 * clientes y peticiones aceptadas / rechazadas (429) por socio.
 *
 * Cada METRICAS_INTERVALO_S segundos cada replica escribe UNA linea JSON en el
 * log ("metrica":"distribucion") con lo de esa ventana, para sumar entre
 * replicas despues (docker logs / CloudWatch). Se cuenta en memoria y no en
 * Redis para no agregar una llamada mas a cada peticion.
 */
@Injectable()
export class MetricasService implements OnModuleDestroy {
  private readonly logger = new Logger('Metricas');
  private readonly replica = hostname();
  private ventana = vacios();
  private readonly total = vacios();
  private readonly timer: NodeJS.Timeout;

  constructor(config: ConfigService) {
    const segundos = Number(config.get<string>('METRICAS_INTERVALO_S', '10'));
    this.timer = setInterval(() => this.volcar(), segundos * 1000);
    this.timer.unref();
  }

  cacheHit(): void {
    this.ventana.cacheHits++;
    this.total.cacheHits++;
  }

  cacheMiss(): void {
    this.ventana.cacheMisses++;
    this.total.cacheMisses++;
  }

  errorCache(): void {
    this.ventana.cacheErrores++;
    this.total.cacheErrores++;
  }

  errorRateLimit(): void {
    this.ventana.rateLimitErrores++;
    this.total.rateLimitErrores++;
  }

  aceptada(socioId: string): void {
    sumar(this.ventana.aceptadas, socioId);
    sumar(this.total.aceptadas, socioId);
  }

  rechazada(socioId: string): void {
    sumar(this.ventana.rechazos429, socioId);
    sumar(this.total.rechazos429, socioId);
  }

  /** Acumulado de ESTA replica desde que arranco (GET /metricas). */
  acumulado() {
    const t = this.total;
    const consultas = t.cacheHits + t.cacheMisses;
    return {
      replica: this.replica,
      cacheHits: t.cacheHits,
      cacheMisses: t.cacheMisses,
      cacheHitRatio: consultas ? Number((t.cacheHits / consultas).toFixed(4)) : null,
      cacheErrores: t.cacheErrores,
      rateLimitErrores: t.rateLimitErrores,
      aceptadasTotal: suma(t.aceptadas),
      rechazos429Total: suma(t.rechazos429),
      rechazos429PorSocio: t.rechazos429,
      aceptadasPorSocio: t.aceptadas,
    };
  }

  private volcar(): void {
    const v = this.ventana;
    this.ventana = vacios();
    if (v.cacheHits + v.cacheMisses + suma(v.aceptadas) + suma(v.rechazos429) === 0) {
      return;
    }
    this.logger.log(
      JSON.stringify({
        metrica: 'distribucion',
        replica: this.replica,
        cacheHits: v.cacheHits,
        cacheMisses: v.cacheMisses,
        cacheErrores: v.cacheErrores,
        rateLimitErrores: v.rateLimitErrores,
        aceptadasTotal: suma(v.aceptadas),
        rechazos429Total: suma(v.rechazos429),
        rechazos429PorSocio: v.rechazos429,
      }),
    );
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
    this.volcar();
  }
}

function sumar(mapa: Record<string, number>, clave: string): void {
  mapa[clave] = (mapa[clave] ?? 0) + 1;
}

function suma(mapa: Record<string, number>): number {
  return Object.values(mapa).reduce((a, b) => a + b, 0);
}
