import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { SociosService } from '../socios/socios.service';
import { Socio } from '../socios/socio';
import { SCOPE_METADATA } from './scope.decorator';

/** Peticion con el socio ya resuelto por este guard. */
export interface RequestConSocio extends Request {
  socio?: Socio;
}

/**
 * Validador socio: el segundo de los tres componentes de Distribucion en el
 * diagrama de despliegue.
 *
 * Identifica al socio por el header X-Socio-Id, que en produccion inyecta el
 * gateway Nginx a partir del certificado mTLS del socio. En el monolito el
 * socio llegaba como un campo del body (CotizarDto.idSocio) y el llamante
 * afirmaba su propia identidad; peor aun, un idSocio desconocido se creaba en
 * silencio (distribucion.service.ts:35-40). Las dos cosas se corrigen aqui.
 *
 * ASR de seguridad (Martin) · tactica de autorizacion por alcance (RBAC/scopes)
 *
 * Dos chequeos, en este orden:
 *
 *   1. AUTENTICACION: el socio del header existe en Redis. Sin header -> 401;
 *      socio desconocido -> 403.
 *   2. AUTORIZACION: el socio tiene el scope que la ruta declara con @Scope.
 *      Si no lo tiene -> 403 'Fuera del alcance otorgado'.
 *
 * El aislamiento por RECURSO (que el socio A no lea la cotizacion del socio B)
 * no se decide aqui: lo decide el servicio dueno del dato (ms-cotizacion
 * compara socioDistribucionId con el X-Socio-Id propagado) y su 403 se propaga
 * tal cual. Un gateway o un Distribucion comprometidos no bastan para leer los
 * datos de otro socio.
 *
 * Todo 403 que salga de aqui queda registrado en Auditoria: lo hace
 * AuditoriaFilter (auditoria.filter.ts), que es un filtro global, para que el
 * registro no se repita en cada guard ni en cada metodo del controller.
 *
 * Fail-closed, al contrario del rate limiter (que es fail-open por diseno):
 * ante la duda, autorizacion niega. Si Redis no responde, el error sube y la
 * peticion no se atiende; si una ruta nueva no declara @Scope, se rechaza.
 */
@Injectable()
export class ValidadorSocioGuard implements CanActivate {
  private readonly logger = new Logger(ValidadorSocioGuard.name);

  constructor(
    private readonly sociosService: SociosService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestConSocio>();
    const socioId = request.headers['x-socio-id'];

    if (typeof socioId !== 'string' || socioId.trim() === '') {
      this.logger.warn('Peticion sin header X-Socio-Id');
      throw new UnauthorizedException('Socio no identificado');
    }

    const socio = await this.sociosService.buscar(socioId);
    if (!socio) {
      this.logger.warn(`Socio ${socioId} no esta registrado en Redis`);
      throw new ForbiddenException('Socio no autorizado');
    }

    // Alcance exigido por la ruta (el handler gana sobre el controller).
    const scope = this.reflector.getAllAndOverride<string | undefined>(
      SCOPE_METADATA,
      [context.getHandler(), context.getClass()],
    );

    if (!scope) {
      // Fail-closed: una ruta protegida por este guard que no declare su
      // alcance es un error de programacion, no una ruta abierta.
      this.logger.error(
        `La ruta ${request.method} ${request.path} no declara @Scope; se rechaza`,
      );
      throw new ForbiddenException('Fuera del alcance otorgado');
    }

    if (!(await this.sociosService.tieneScope(socioId, scope))) {
      this.logger.warn(
        `Socio ${socioId} intento ${request.method} ${request.path} sin el scope ${scope}`,
      );
      throw new ForbiddenException('Fuera del alcance otorgado');
    }

    request.socio = socio;
    return true;
  }
}
