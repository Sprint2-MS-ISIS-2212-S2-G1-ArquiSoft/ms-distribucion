import { BadRequestException, Injectable } from '@nestjs/common';
import { CacheClientesService } from '../cache-clientes/cache-clientes.service';
import { CatalogoClient } from '../clients/catalogo.client';
import { Cotizacion, CotizacionClient } from '../clients/cotizacion.client';
import { IdentidadClient } from '../clients/identidad.client';
import { Siniestro, SiniestrosClient } from '../clients/siniestros.client';
import {
  Suscripcion,
  SuscripcionesClient,
} from '../clients/suscripciones.client';
import { CotizarDto } from './dtos/cotizar.dto';
import { SuscribirDto } from './dtos/suscribir.dto';

/**
 * Orquestacion de negocio de Distribucion.
 *
 * Es DistribucionService del monolito con las llamadas en proceso convertidas
 * en HTTP hacia los servicios duenos de cada dato. Lo que ya no vive aqui:
 *  - la consulta de Open Data: la hace Cotizacion,
 *  - el pago y la emision: los orquesta Suscripciones,
 *  - la transaccion de TypeORM: desaparece al separar los servicios y la
 *    reemplaza la compensacion RECHAZADA.
 */
@Injectable()
export class ApiSociosService {
  constructor(
    private readonly catalogoClient: CatalogoClient,
    private readonly identidadClient: IdentidadClient,
    private readonly cotizacionClient: CotizacionClient,
    private readonly suscripcionesClient: SuscripcionesClient,
    private readonly siniestrosClient: SiniestrosClient,
    private readonly cacheClientes: CacheClientesService,
  ) {}

  /**
   * Paso a paso de DistribucionService.cotizar. El paso 2 del monolito
   * (buscar el socio) ya lo resolvio el ValidadorSocioGuard.
   */
  async cotizar(dto: CotizarDto, socioId: string): Promise<Cotizacion> {
    // producto
    const producto = await this.catalogoClient.obtenerProducto(
      dto.idProducto,
      socioId,
    );

    //identidad
    const cliente = await this.cacheClientes.verificarCliente(
      dto.nombre,
      dto.documento,
      socioId,
    );

    // cotizacion
    return this.cotizacionClient.crearCotizacion(
      {
        productoId: producto.id,
        sumaAseguradaMaxima: producto.sumaAseguradaMaxima,
        clienteId: cliente.id,
        documento: cliente.documento,
        aceptaOpenData: dto.aceptaOpenData,
      },
      socioId,
    );
  }

  //DistribucionService.suscribirYEmitir.

  async suscribir(dto: SuscribirDto, socioId: string): Promise<Suscripcion> {
    // mismo mensaje que el monolito.
    if (!dto.aceptado) {
      throw new BadRequestException(
        'La cotización no fue aceptada por el cliente',
      );
    }

    // cotizacion vigente
    const cotizacion = await this.cotizacionClient.validar(
      dto.idCotizacion,
      socioId,
    );

    // documento del cliente
    const cliente = await this.identidadClient.obtenerCliente(
      cotizacion.clienteId,
      socioId,
    );

    try {
      // hace una sola llamada
      const suscripcion = await this.suscripcionesClient.crear(
        {
          cotizacionId: cotizacion.id,
          clienteId: cliente.id,
          documento: cliente.documento,
          primaMensual: cotizacion.primaMensual,
          sumaAsegurada: cotizacion.sumaAsegurada,
        },
        socioId,
      );

      // igual que distribucion.service.ts
      await this.cotizacionClient.marcarEstado(
        cotizacion.id,
        'ACEPTADA',
        socioId,
      );

      return suscripcion;
    } catch (error) {
      // compensacion y se propaga el error orginal
      await this.cotizacionClient.compensarRechazada(cotizacion.id, socioId);
      throw error;
    }
  }

  /**
   * Reenvio de GET /cotizaciones/:id.
   *
   * ASR de seguridad (Martin): Distribucion no guarda cotizaciones, asi que no
   * puede comprobar la pertenencia por si misma; propaga el socio y respeta la
   * decision del dueno del dato (404 si no existe, 403 si es de otro socio).
   */
  async consultarCotizacion(
    cotizacionId: string,
    socioId: string,
  ): Promise<Cotizacion> {
    return this.cotizacionClient.obtener(cotizacionId, socioId);
  }

  // Reenvio de GET /siniestros/poliza/:numeroPoliza
  async consultarSiniestros(
    numeroPoliza: string,
    socioId: string,
  ): Promise<Siniestro[]> {
    return this.siniestrosClient.consultarPorPoliza(numeroPoliza, socioId);
  }
}
