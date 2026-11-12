import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { llamar } from './llamada-http';

/** Producto tal como lo devuelve GET /productos/:id de ms-catalogo. */
export interface Producto {
  id: string;
  nombre: string;
  ramo: string;
  /** numeric(14,2) de Postgres: viaja como string para no perder precision. */
  sumaAseguradaMaxima: string;
}

/**
 * Cliente HTTP hacia el microservicio catalogo.
 *
 * En el monolito esto era catalogoService.getProducto(id), el paso 1 de
 * DistribucionService.cotizar.
 */
@Injectable()
export class CatalogoClient {
  private readonly logger = new Logger(CatalogoClient.name);

  constructor(private readonly config: ConfigService) {}

  async obtenerProducto(
    idProducto: string,
    socioId?: string,
  ): Promise<Producto> {
    return llamar<Producto>({
      servicio: 'Catálogo',
      baseUrl: this.config.get<string>('CATALOGO_URL'),
      metodo: 'GET',
      ruta: `/productos/${idProducto}`,
      socioId,
      logger: this.logger,
    });
  }
}
