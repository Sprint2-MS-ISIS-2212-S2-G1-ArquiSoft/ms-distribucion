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
    // 1. Producto, en Catalogo.
    const producto = await this.catalogoClient.obtenerProducto(
      dto.idProducto,
      socioId,
    );

    // 2. Cliente, en Identidad (get-or-create por documento, con KYC dentro),
    //    detras de la cache cache-aside del ASR de escalabilidad.
    const cliente = await this.cacheClientes.verificarCliente(
      dto.nombre,
      dto.documento,
      socioId,
    );

    // 3. Cotizacion. sumaAseguradaMaxima se reenvia como string, sin
    //    parseFloat: es un numeric(14,2) y el calculo lo hace Cotizacion.
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

  /**
   * Paso a paso de DistribucionService.suscribirYEmitir.
   *
   * Segun el diagrama Suscripciones no llama a Cotizacion ni a Identidad, asi
   * que Distribucion resuelve antes la cotizacion vigente y el documento del
   * cliente, y se los pasa en el body.
   */
  async suscribir(dto: SuscribirDto, socioId: string): Promise<Suscripcion> {
    // a. Mismo mensaje que el monolito.
    if (!dto.aceptado) {
      throw new BadRequestException(
        'La cotización no fue aceptada por el cliente',
      );
    }

    // b. Cotizacion vigente. Su 400 'Cotización inválida o expirada' se
    //    propaga tal cual, igual que validarCotizacion en el monolito.
    const cotizacion = await this.cotizacionClient.validar(
      dto.idCotizacion,
      socioId,
    );

    // c. Documento del cliente. En el monolito llegaba dentro de la entidad
    //    (cotizacion.cliente); ahora la cotizacion solo trae clienteId.
    const cliente = await this.identidadClient.obtenerCliente(
      cotizacion.clienteId,
      socioId,
    );

    try {
      // d. Una sola llamada: Suscripciones hace puntaje, pago y emision.
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

      // e. Igual que distribucion.service.ts:94.
      await this.cotizacionClient.marcarEstado(
        cotizacion.id,
        'ACEPTADA',
        socioId,
      );

      return suscripcion;
    } catch (error) {
      // f. Compensacion y se propaga el error ORIGINAL con su status. El
      //    monolito lo aplanaba todo a un 400 ('Fallo en suscripcion/emision:
      //    ...'), con lo que un pago rechazado y un body malo se veian igual.
      await this.cotizacionClient.compensarRechazada(cotizacion.id, socioId);
      throw error;
    }
  }

  /**
   * Reenvio de GET /siniestros/poliza/:numeroPoliza, que en el monolito era
   * una ruta publica del modulo siniestros.
   */
  async consultarSiniestros(
    numeroPoliza: string,
    socioId: string,
  ): Promise<Siniestro[]> {
    return this.siniestrosClient.consultarPorPoliza(numeroPoliza, socioId);
  }
}
