import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { llamar } from './llamada-http';

export interface EventoAuditoria {
  socioId: string;
  accion: string;
  recurso: string;
  resultado: string;
  detalle?: string;
  fecha: string;
}

/**
 * Cliente HTTP hacia el microservicio auditoria (todavia sin migrar).
 *
 * El monolito no tenia ningun modulo, servicio, interceptor ni tabla de
 * auditoria: este contrato es nuevo y sale del diagrama, donde Distribucion
 * registra en Auditoria los rechazos del validador de socio.
 *
 * ASR de seguridad (Martin) · tactica de audit log. Quien invoca este cliente
 * es AuditoriaFilter (src/validador-socio/auditoria.filter.ts), el filtro
 * global que registra todo 403 de este servicio. La llamada se hace
 * fire-and-forget: ver el comentario del filtro.
 */
@Injectable()
export class AuditoriaClient {
  private readonly logger = new Logger(AuditoriaClient.name);

  constructor(private readonly config: ConfigService) {}

  async registrar(
    evento: EventoAuditoria,
    socioId?: string,
  ): Promise<{ id: string }> {
    return llamar<{ id: string }>({
      servicio: 'Auditoría',
      baseUrl: this.config.get<string>('AUDITORIA_URL'),
      metodo: 'POST',
      ruta: '/eventos',
      socioId,
      cuerpo: evento,
      logger: this.logger,
    });
  }
}
