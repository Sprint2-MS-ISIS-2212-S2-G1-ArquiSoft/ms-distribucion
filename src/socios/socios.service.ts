import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';
import { Socio } from './socio';

/** Prefijo de las claves de socio en Redis. */
const PREFIJO = 'socio:';

/** Socios semilla, copiados de database/solventa.sql del monolito. */
const ARCHIVO_SEMILLA = 'socios.seed.json';

/**
 * Registro de socios en Redis.
 *
 * En el monolito esto era el repositorio TypeORM de SocioDistribucion sobre la
 * tabla socios_distribucion. Aqui no hay RDS (ver ADR), asi que al arrancar se
 * cargan los socios semilla a Redis si todavia no existen.
 *
 * El auto-create de distribucion.service.ts:35-40 (que inventaba un
 * 'Mock Socio' con el id que llegara en el body) NO se migra: era scaffolding
 * de pruebas en un camino de escritura publico.
 */
@Injectable()
export class SociosService implements OnModuleInit {
  private readonly logger = new Logger(SociosService.name);

  constructor(private readonly redis: RedisService) {}

  async onModuleInit(): Promise<void> {
    const socios = this.leerSemilla();
    for (const socio of socios) {
      try {
        const escrito = await this.redis.setIfAbsent(
          `${PREFIJO}${socio.id}`,
          JSON.stringify(socio),
        );
        this.logger.log(
          escrito
            ? `Socio semilla ${socio.id} (${socio.nombreEmpresa}) cargado en Redis`
            : `Socio semilla ${socio.id} ya existia en Redis, no se sobrescribe`,
        );
      } catch (error) {
        // Arrancar sin Redis es valido: /health lo reporta como unreachable.
        this.logger.error(
          `No se pudo cargar el socio semilla ${socio.id}: ${String(error)}`,
        );
      }
    }
  }

  /**
   * Lee socios.seed.json desde el directorio del modulo. Se lee con fs y no
   * con un import de JSON para no tener que tocar el tsconfig.json que los
   * demas microservicios ya tienen fijado; nest-cli.json lo copia a dist/.
   */
  private leerSemilla(): Socio[] {
    const ruta = join(__dirname, ARCHIVO_SEMILLA);
    return JSON.parse(readFileSync(ruta, 'utf8')) as Socio[];
  }

  async buscar(id: string): Promise<Socio | null> {
    const crudo = await this.redis.get(`${PREFIJO}${id}`);
    if (!crudo) {
      return null;
    }
    return JSON.parse(crudo) as Socio;
  }
}
