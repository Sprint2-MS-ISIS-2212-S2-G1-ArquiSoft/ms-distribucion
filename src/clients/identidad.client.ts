import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { llamar } from './llamada-http';

/** Cliente tal como lo devuelve ms-identidad. */
export interface Cliente {
  id: string;
  nombre: string;
  documento: string;
}

/**
 * Cliente HTTP hacia el microservicio identidad.
 *
 * verificarCliente reemplaza identidadService.verificarYGuardar(nombre,
 * documento) del monolito, el paso 3 de cotizar. obtenerCliente no existia en
 * el monolito: alli el cliente llegaba dentro de la entidad Cotizacion
 * (cotizacion.cliente), y ahora la cotizacion solo trae clienteId.
 *
 * Los reintentos y el circuit breaker que el mock del monolito tenia con
 * opossum NO se migran: son tacticas del ASR de Terceros. Aqui solo queda el
 * timeout, que es obligatorio.
 */
@Injectable()
export class IdentidadClient {
  private readonly logger = new Logger(IdentidadClient.name);

  constructor(private readonly config: ConfigService) {}

  /**
   * POST /clientes/verificacion. Es un get-or-create por documento, de ahi el
   * 200. Un 400 significa "este documento no paso el KYC" y un 503 "no
   * pudimos verificar": los dos se propagan tal cual, sin colapsarse.
   */
  async verificarCliente(
    nombre: string,
    documento: string,
    socioId?: string,
  ): Promise<Cliente> {
    return llamar<Cliente>({
      servicio: 'Identidad',
      baseUrl: this.config.get<string>('IDENTIDAD_URL'),
      metodo: 'POST',
      ruta: '/clientes/verificacion',
      socioId,
      cuerpo: { nombre, documento },
      logger: this.logger,
    });
  }

  /** GET /clientes/:id. Se usa en suscribir para obtener el documento. */
  async obtenerCliente(clienteId: string, socioId?: string): Promise<Cliente> {
    return llamar<Cliente>({
      servicio: 'Identidad',
      baseUrl: this.config.get<string>('IDENTIDAD_URL'),
      metodo: 'GET',
      ruta: `/clientes/${clienteId}`,
      socioId,
      logger: this.logger,
    });
  }
}
