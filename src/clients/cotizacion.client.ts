import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { llamar } from './llamada-http';

/** Estados del enum cotizaciones_estado_enum de ms-cotizacion. */
export type EstadoCotizacion =
  'PENDIENTE' | 'ACEPTADA' | 'RECHAZADA' | 'EXPIRADA';

/** Cotizacion tal como la devuelve ms-cotizacion. */
export interface Cotizacion {
  id: string;
  estado: EstadoCotizacion;
  /** numeric(14,2): string, igual que en el monolito. */
  primaMensual: string;
  sumaAsegurada: string;
  fechaEmision: string;
  fechaVencimiento: string;
  socioDistribucionId: string;
  productoId: string;
  suscripcionId: string | null;
  clienteId: string;
}

export interface DatosCotizacion {
  productoId: string;
  sumaAseguradaMaxima: string;
  clienteId: string;
  documento: string;
  aceptaOpenData: boolean;
}

/**
 * Cliente HTTP hacia el microservicio cotizacion (ya migrado: el contrato sale
 * de su README y no se toca).
 *
 * Reemplaza las tres llamadas en proceso del monolito:
 * cotizacionService.crearCotizacion(), validarCotizacion() y
 * actualizarEstado(). La consulta de Open Data, que en el monolito hacia
 * Distribucion (tercerosService.getOpenDataScore), ahora la hace Cotizacion
 * por dentro: aqui solo se le reenvia aceptaOpenData.
 */
@Injectable()
export class CotizacionClient {
  private readonly logger = new Logger(CotizacionClient.name);

  constructor(private readonly config: ConfigService) {}

  private get baseUrl(): string | undefined {
    return this.config.get<string>('COTIZACION_URL');
  }

  /**
   * POST /cotizaciones. El X-Socio-Id es obligatorio para Cotizacion: es el
   * socio que queda guardado en socioDistribucionId, y no viaja en el body.
   */
  async crearCotizacion(
    datos: DatosCotizacion,
    socioId: string,
  ): Promise<Cotizacion> {
    return llamar<Cotizacion>({
      servicio: 'Cotización',
      baseUrl: this.baseUrl,
      metodo: 'POST',
      ruta: '/cotizaciones',
      socioId,
      cuerpo: datos,
      logger: this.logger,
    });
  }

  /**
   * GET /cotizaciones/:id.
   *
   * ASR de seguridad (Martin): Cotizacion compara su socioDistribucionId con
   * el X-Socio-Id que va en la cabecera y responde 403 'No autorizado para
   * este recurso' si la cotizacion es de otro socio. llamar() propaga ese 403
   * con su status y su mensaje, sin cuerpo de la cotizacion ajena.
   */
  async obtener(cotizacionId: string, socioId: string): Promise<Cotizacion> {
    return llamar<Cotizacion>({
      servicio: 'Cotización',
      baseUrl: this.baseUrl,
      metodo: 'GET',
      ruta: `/cotizaciones/${cotizacionId}`,
      socioId,
      logger: this.logger,
    });
  }

  /**
   * POST /cotizaciones/:id/validacion. Devuelve la cotizacion si esta vigente
   * (PENDIENTE y sin vencer) y 400 'Cotización inválida o expirada' si no.
   * Tiene efecto de escritura heredado del monolito: si vencio estando
   * PENDIENTE, la marca EXPIRADA antes de responder.
   */
  async validar(cotizacionId: string, socioId: string): Promise<Cotizacion> {
    return llamar<Cotizacion>({
      servicio: 'Cotización',
      baseUrl: this.baseUrl,
      metodo: 'POST',
      ruta: `/cotizaciones/${cotizacionId}/validacion`,
      socioId,
      logger: this.logger,
    });
  }

  /** PATCH /cotizaciones/:id/estado. */
  async marcarEstado(
    cotizacionId: string,
    estado: EstadoCotizacion,
    socioId: string,
  ): Promise<Cotizacion> {
    return llamar<Cotizacion>({
      servicio: 'Cotización',
      baseUrl: this.baseUrl,
      metodo: 'PATCH',
      ruta: `/cotizaciones/${cotizacionId}/estado`,
      socioId,
      cuerpo: { estado },
      logger: this.logger,
    });
  }

  /**
   * Compensacion: marca la cotizacion RECHAZADA cuando la suscripcion falla,
   * igual que el rollback del monolito (distribucion.service.ts:99-105).
   *
   * No propaga su propio error a proposito: el socio tiene que recibir el
   * error original de la suscripcion, no el de la compensacion. Reintentar
   * esta llamada seria logica de saga y queda fuera del andamio.
   */
  async compensarRechazada(
    cotizacionId: string,
    socioId: string,
  ): Promise<void> {
    try {
      await this.marcarEstado(cotizacionId, 'RECHAZADA', socioId);
      this.logger.log(
        `Cotizacion ${cotizacionId} marcada RECHAZADA (compensacion)`,
      );
    } catch (error) {
      this.logger.error(
        `No se pudo compensar la cotizacion ${cotizacionId}: ${String(error)}`,
      );
    }
  }
}
