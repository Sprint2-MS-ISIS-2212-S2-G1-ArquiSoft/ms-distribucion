import { CanActivate, Injectable } from '@nestjs/common';

/**
 * Rate limiter: el tercero de los componentes de Distribucion en el diagrama
 * de despliegue (cuotas por socio en Redis).
 *
 * TODO: ASR de rate limiting por socio (Ivonne). Por ahora SIEMPRE deja pasar.
 * La cuota por socio se llevara en Redis, con la clave derivada del
 * X-Socio-Id que resuelve el ValidadorSocioGuard, y el rechazo sera un 429.
 * El monolito no tenia ningun limite: cualquier socio podia pedir lo que
 * quisiera.
 */
@Injectable()
export class RateLimiterGuard implements CanActivate {
  canActivate(): boolean {
    return true;
  }
}
