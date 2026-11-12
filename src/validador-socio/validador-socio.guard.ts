import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { SociosService } from '../socios/socios.service';
import { Socio } from '../socios/socio';

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
 * TODO: ASR de seguridad (Martin). Falta la validacion de scopes por socio
 * (leidos de Redis) y el registro del rechazo en Auditoria via
 * POST /eventos. Hoy el guard solo comprueba que el socio exista.
 */
@Injectable()
export class ValidadorSocioGuard implements CanActivate {
  private readonly logger = new Logger(ValidadorSocioGuard.name);

  constructor(private readonly sociosService: SociosService) {}

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

    request.socio = socio;
    return true;
  }
}
