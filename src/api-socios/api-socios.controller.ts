import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Cotizacion } from '../clients/cotizacion.client';
import { Siniestro } from '../clients/siniestros.client';
import { Suscripcion } from '../clients/suscripciones.client';
import { RateLimiterGuard } from '../rate-limiter/rate-limiter.guard';
import { Scope } from '../validador-socio/scope.decorator';
import { ValidadorSocioGuard } from '../validador-socio/validador-socio.guard';
import { ApiSociosService } from './api-socios.service';
import { CotizarDto } from './dtos/cotizar.dto';
import { SuscribirDto } from './dtos/suscribir.dto';

/**
 * API socios: el primero de los tres componentes de Distribucion en el
 * diagrama de despliegue. Es el unico punto de entrada del socio a Solventa.
 *
 * Las rutas pierden el prefijo /distribucion que tenian en el monolito: alli
 * era el prefijo del modulo dentro del monolito modular, aqui el servicio ya
 * es Distribucion.
 *
 * Los dos guards se aplican a toda la clase y en este orden: primero la cuota
 * por socio (hoy pasa siempre), despues la identificacion del socio.
 *
 * ASR de seguridad (Martin): cada ruta declara con @Scope el alcance que
 * exige. El ValidadorSocioGuard lo compara con el alcance del socio en Redis y
 * responde 403 'Fuera del alcance otorgado' si no lo tiene. El guard es
 * fail-closed: una ruta nueva sin @Scope se rechaza.
 */
@Controller()
@UseGuards(RateLimiterGuard, ValidadorSocioGuard)
export class ApiSociosController {
  constructor(private readonly apiSociosService: ApiSociosService) {}

  //POST /distribucion/cotizar del monolito
  @Scope('cotizar')
  @Post('cotizar')
  cotizar(
    @Body() dto: CotizarDto,
    @Headers('x-socio-id') socioId: string,
  ): Promise<Cotizacion> {
    return this.apiSociosService.cotizar(dto, socioId);
  }

  // POST /distribucion/suscribir del monolito
  @Scope('suscribir')
  @Post('suscribir')
  suscribir(
    @Body() dto: SuscribirDto,
    @Headers('x-socio-id') socioId: string,
  ): Promise<Suscripcion> {
    return this.apiSociosService.suscribir(dto, socioId);
  }

  /**
   * Consulta de una cotizacion propia.
   *
   * ASR de seguridad (Martin): ruta nueva. El scope cotizaciones:leer autoriza
   * la RUTA; la pertenencia del RECURSO la decide ms-cotizacion comparando
   * socioDistribucionId con el X-Socio-Id que se le propaga, y su 403 se
   * propaga al socio sin cuerpo de la cotizacion ajena.
   */
  @Scope('cotizaciones:leer')
  @Get('cotizaciones/:id')
  consultarCotizacion(
    @Param('id') id: string,
    @Headers('x-socio-id') socioId: string,
  ): Promise<Cotizacion> {
    return this.apiSociosService.consultarCotizacion(id, socioId);
  }

  //GET /siniestros/poliza/:numeroPoliza del monolito, con la misma ruta para
  // no romper a los socios que ya la usan. Sin ParseUUIDPipe ni validacion
  // del numero: el 404 lo decide Siniestros.
  //
  @Scope('siniestros:leer')
  @Get('siniestros/poliza/:numeroPoliza')
  consultarSiniestros(
    @Param('numeroPoliza') numeroPoliza: string,
    @Headers('x-socio-id') socioId: string,
  ): Promise<Siniestro[]> {
    return this.apiSociosService.consultarSiniestros(numeroPoliza, socioId);
  }
}
