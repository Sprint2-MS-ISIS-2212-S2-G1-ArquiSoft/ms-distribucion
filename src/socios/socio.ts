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

/**
 * Socio tal como viene en socios.seed.json: los mismos campos mas el alcance
 * otorgado.
 *
 * ASR de seguridad (Martin): los scopes no se guardan dentro del JSON de
 * socio:<id>, sino en su propia clave socio:<id>:scopes como SET de Redis
 * (ver SociosService). Asi el chequeo de alcance de cada peticion es un solo
 * SISMEMBER O(1) y no obliga a traer y parsear el socio completo.
 */
export interface SocioSemilla extends Socio {
  scopes: string[];
}

/** Scopes que reconoce la API de socios, uno por ruta. */
export const SCOPES = [
  'cotizar',
  'suscribir',
  'cotizaciones:leer',
  'siniestros:leer',
] as const;
