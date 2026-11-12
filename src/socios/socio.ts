/**
 * Socio de distribucion.
 *
 * Copia de los campos de SocioDistribucion del monolito
 * (src/modules/distribucion/entities/socio-distribucion.entity.ts) sin la
 * relacion @OneToMany hacia Cotizacion: segun la regla 3 de CLAUDE.md esa
 * relacion ya es la columna socioDistribucionId de ms-cotizacion.
 *
 * No es una entidad de TypeORM: Distribucion no tiene base de datos
 * relacional, los socios viven en Redis bajo la clave socio:<id>.
 */
export interface Socio {
  id: string;
  nombreEmpresa: string;
  sectorIndustria: string;
}
