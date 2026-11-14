import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { AuditoriaClient } from '../clients/auditoria.client';

/**
 * ASR de seguridad (Martin) · tactica de audit log.
 *
 * Registra en Auditoria TODO rechazo por autorizacion (403) de este servicio,
 * con socio, recurso y timestamp, sea cual sea su origen:
 *
 *   - socio inexistente              ValidadorSocioGuard
 *   - fuera del alcance otorgado     ValidadorSocioGuard (@Scope)
 *   - recurso de otro socio          403 propagado de ms-cotizacion
 *   - suscribir una cotizacion ajena 403 propagado de ms-cotizacion
 *
 * Esta en un filtro global y no repartido por los metodos del controller por
 * dos razones: los dos ultimos casos los decide otro servicio y llegan como
 * excepcion propagada por llamada-http.ts, y un registro por metodo se
 * desincroniza en cuanto alguien agrega una ruta.
 *
 * El registro es FIRE-AND-FORGET a proposito. La medida del ASR es p95 < 500 ms
 * a 75 TPS, y `llamar` tiene un timeout de 5 s (llamada-http.ts:11): esperar la
 * respuesta de Auditoria agregaria hasta 5 s a cada 403 y convertiria una caida
 * de Auditoria en un 503 que taparia el 403 real. El catch solo loguea. Mismo
 * patron que la escritura en cache de cache-clientes.service.ts.
 *
 * Solo intercepta HttpException: los errores no HTTP siguen cayendo en el
 * filtro por defecto de Nest y siguen siendo 500. Para cualquier status que no
 * sea 403 este filtro reproduce exactamente la respuesta de Nest.
 */
@Catch(HttpException)
export class AuditoriaFilter implements ExceptionFilter {
  private readonly logger = new Logger(AuditoriaFilter.name);

  constructor(private readonly auditoria: AuditoriaClient) {}

  catch(exception: HttpException, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();
    const status = exception.getStatus();

    if (status === HttpStatus.FORBIDDEN) {
      this.registrarRechazo(request, exception);
    }

    // Exactamente la misma forma de respuesta que el filtro por defecto de
    // Nest (BaseExceptionFilter): si la excepcion declara un objeto se usa tal
    // cual, y si declara un string se envuelve en { statusCode, message }. Hay
    // que replicarlo porque llamada-http.ts propaga los 4xx de los vecinos con
    // `new HttpException(mensaje, status)`, cuyo getResponse() es un string: sin
    // envolverlo, el cuerpo de esos errores cambiaria de forma para el socio.
    //
    // El mensaje de un 403 nunca lleva datos del recurso ajeno (ms-cotizacion
    // responde el literal 'No autorizado para este recurso'), asi que no hay
    // nada mas que filtrar aqui.
    const declarado = exception.getResponse();
    const cuerpo =
      typeof declarado === 'object' && declarado !== null
        ? declarado
        : { statusCode: status, message: declarado };

    if (response.headersSent) {
      response.end();
      return;
    }
    response.status(status).json(cuerpo);
  }

  private registrarRechazo(request: Request, exception: HttpException): void {
    const socioId = request.headers['x-socio-id'];
    // La ruta declarada (/cotizaciones/:id) para poder agrupar, y la ruta real
    // como recurso concreto del intento.
    const plantilla = (request.route as { path?: string } | undefined)?.path;

    void this.auditoria
      .registrar({
        socioId: typeof socioId === 'string' ? socioId : 'desconocido',
        accion: `${request.method} ${plantilla ?? request.path}`,
        recurso: request.originalUrl,
        resultado: 'RECHAZADO',
        detalle: this.mensaje(exception),
        fecha: new Date().toISOString(),
      })
      .catch((error) =>
        this.logger.error(
          `No se pudo registrar el rechazo en Auditoria: ${String(error)}`,
        ),
      );
  }

  /** Saca el texto del 403 para el campo detalle del evento. */
  private mensaje(exception: HttpException): string {
    const cuerpo = exception.getResponse();
    if (typeof cuerpo === 'string') {
      return cuerpo;
    }
    const mensaje = (cuerpo as { message?: string | string[] }).message;
    if (Array.isArray(mensaje)) {
      return mensaje.join('; ');
    }
    return mensaje ?? exception.message;
  }
}
