import { SetMetadata } from '@nestjs/common';

/** Clave de metadata donde cada ruta declara el scope que exige. */
export const SCOPE_METADATA = 'solventa:scope';

/**
 * ASR de seguridad (Martin) · tactica de autorizacion por alcance.
 *
 * Declara el scope que una ruta de la API de socios exige. El
 * ValidadorSocioGuard lo lee con Reflector y lo compara contra el alcance del
 * socio en Redis (socio:<id>:scopes).
 *
 * El alcance se declara AQUI, junto a la ruta, y no en una tabla aparte de
 * ruta -> scope: asi una ruta nueva no puede "olvidar" su scope sin que se
 * note (el guard es fail-closed y rechaza la ruta que no declare ninguno).
 *
 *   @Scope('cotizaciones:leer')
 *   @Get('cotizaciones/:id')
 */
export const Scope = (scope: string) => SetMetadata(SCOPE_METADATA, scope);
