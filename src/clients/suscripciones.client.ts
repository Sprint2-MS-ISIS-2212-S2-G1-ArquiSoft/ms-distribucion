import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { llamar } from './llamada-http';

export interface DatosSuscripcion {
  cotizacionId: string;
  clienteId: string;
  documento: string;
  /** numeric(14,2) como string, lo que se cobra en Terceros. */
  primaMensual: string;
  /** numeric(14,2) como string, con lo que se calcula el puntaje de riesgo. */
  sumaAsegurada: string;
}

/** Respuesta de POST /suscripciones (contrato pendiente, ver README). */
export interface Suscripcion {
  suscripcionId: string;
  estado: string;
  puntajeRiesgo: number;
  polizaId: string;
  numeroPoliza: string;
  estadoPoliza: string;
  fechaInicioVigencia: string;
  fechaFinVigencia: string;
  cotizacionId: string;
  clienteId: string;
}

/**
 * Cliente HTTP hacia el microservicio suscripciones (todavia sin migrar: el
 * contrato esta en la seccion "Contratos pendientes" del README).
 *
 * Es UNA sola llamada: Suscripciones orquesta por dentro el puntaje de riesgo
 * (suscripcion.service.ts del monolito), el cobro en Terceros
 * (POST /pagos/cobros) y la emision de la poliza en Emision. En el monolito
 * esos tres pasos eran llamadas en proceso de DistribucionService dentro de
 * una misma transaccion de TypeORM; esa transaccion desaparece al separar los
 * servicios y la reemplaza la compensacion de CotizacionClient.
 */
@Injectable()
export class SuscripcionesClient {
  private readonly logger = new Logger(SuscripcionesClient.name);

  constructor(private readonly config: ConfigService) {}

  async crear(datos: DatosSuscripcion, socioId: string): Promise<Suscripcion> {
    return llamar<Suscripcion>({
      servicio: 'Suscripciones',
      baseUrl: this.config.get<string>('SUSCRIPCIONES_URL'),
      metodo: 'POST',
      ruta: '/suscripciones',
      socioId,
      cuerpo: datos,
      logger: this.logger,
    });
  }
}
