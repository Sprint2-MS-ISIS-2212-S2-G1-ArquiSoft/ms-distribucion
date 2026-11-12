import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { llamar } from './llamada-http';

/** Siniestro tal como lo devuelve ms-siniestros (contrato pendiente). */
export interface Siniestro {
  id: string;
  descripcionEvento: string;
  /** numeric(14,2) como string. */
  montoReclamado: string;
  estado: string;
  polizaId: string;
  numeroPoliza: string;
}

/**
 * Cliente HTTP hacia el microservicio siniestros (todavia sin migrar).
 *
 * En el monolito GET /siniestros/poliza/:numeroPoliza era una ruta publica
 * propia del modulo siniestros. En microservicios el socio solo entra por
 * Distribucion, asi que esa ruta se expone aqui y se reenvia.
 *
 * La cache de Redis con TTL de 60 s que el monolito tenia en
 * siniestros.service.ts NO se migra: es tactica del ASR de Siniestros y le
 * corresponde a ese servicio.
 */
@Injectable()
export class SiniestrosClient {
  private readonly logger = new Logger(SiniestrosClient.name);

  constructor(private readonly config: ConfigService) {}

  async consultarPorPoliza(
    numeroPoliza: string,
    socioId?: string,
  ): Promise<Siniestro[]> {
    return llamar<Siniestro[]>({
      servicio: 'Siniestros',
      baseUrl: this.config.get<string>('SINIESTROS_URL'),
      metodo: 'GET',
      ruta: `/siniestros/poliza/${encodeURIComponent(numeroPoliza)}`,
      socioId,
      logger: this.logger,
    });
  }
}
