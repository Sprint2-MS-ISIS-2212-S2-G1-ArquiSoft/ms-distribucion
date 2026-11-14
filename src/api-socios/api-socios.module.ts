import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { CacheClientesService } from '../cache-clientes/cache-clientes.service';
import { AuditoriaClient } from '../clients/auditoria.client';
import { CatalogoClient } from '../clients/catalogo.client';
import { CotizacionClient } from '../clients/cotizacion.client';
import { IdentidadClient } from '../clients/identidad.client';
import { SiniestrosClient } from '../clients/siniestros.client';
import { SuscripcionesClient } from '../clients/suscripciones.client';
import { RateLimiterGuard } from '../rate-limiter/rate-limiter.guard';
import { RedisModule } from '../redis/redis.module';
import { SociosModule } from '../socios/socios.module';
import { AuditoriaFilter } from '../validador-socio/auditoria.filter';
import { ValidadorSocioGuard } from '../validador-socio/validador-socio.guard';
import { ApiSociosController } from './api-socios.controller';
import { ApiSociosService } from './api-socios.service';

/**
 * API socios + los dos guards + los seis clientes HTTP hacia los vecinos.
 *
 * Los clientes se registran aqui y no en un ClientsModule aparte, siguiendo a
 * ms-identidad, que declara su TercerosClient en el modulo que lo consume.
 *
 * Aqui se registra tambien el AuditoriaFilter del ASR de seguridad: es un
 * filtro global, pero necesita AuditoriaClient, que es un provider de este
 * modulo.
 */
@Module({
  imports: [SociosModule, RedisModule],
  controllers: [ApiSociosController],
  providers: [
    ApiSociosService,
    CacheClientesService,
    RateLimiterGuard,
    ValidadorSocioGuard,
    CatalogoClient,
    IdentidadClient,
    CotizacionClient,
    SuscripcionesClient,
    SiniestrosClient,
    AuditoriaClient,
    // ASR de seguridad (Martin): filtro GLOBAL (APP_FILTER) que registra en
    // Auditoria todo 403, venga del ValidadorSocioGuard o propagado de otro
    // servicio. Se declara aqui porque es donde ya vive AuditoriaClient.
    { provide: APP_FILTER, useClass: AuditoriaFilter },
  ],
})
export class ApiSociosModule {}
