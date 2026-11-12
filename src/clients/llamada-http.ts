import {
  HttpException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';

/**
 * Timeout de toda llamada saliente (regla 5 de CLAUDE.md: ninguna llamada
 * HTTP sale sin timeout).
 */
export const TIMEOUT_MS = 5000;

interface OpcionesLlamada {
  /** Nombre del servicio tal como aparece en el 503: '<Servicio> no disponible'. */
  servicio: string;
  /** Variable de entorno con la URL base (regla 4: nunca una IP ni un host en codigo). */
  baseUrl: string | undefined;
  metodo: 'GET' | 'POST' | 'PATCH';
  ruta: string;
  socioId?: string;
  cuerpo?: unknown;
  logger: Logger;
}

/**
 * Nucleo compartido por los seis clientes de src/clients.
 *
 * Es el mismo patron de ms-identidad (src/clients/terceros.client.ts): fetch
 * nativo, timeout con AbortSignal, X-Socio-Id propagado solo si viene, y el
 * mapeo de errores siempre en el mismo orden. Esta extraido en una funcion
 * porque Distribucion llama a seis vecinos y copiarlo seis veces seria
 * invitar a que los mensajes se desalineen.
 *
 * Mapeo de errores:
 *  1. el fetch falla (timeout o conexion rechazada) -> 503 '<Servicio> no disponible'
 *  2. status >= 500                                 -> 503 '<Servicio> no disponible'
 *  3. 4xx                                           -> se propaga status y mensaje
 *  4. exito                                         -> se devuelve el JSON
 *
 * El caso 3 se aparta de ms-identidad a proposito (alli un 4xx se convertia en
 * un resultado de dominio): Distribucion es un orquestador y el socio tiene
 * que ver el 400 o el 404 real del servicio dueno del dato. Eso preserva la
 * distincion entre "este documento no paso la verificacion" (400) y "no
 * pudimos verificar" (503) que el README de ms-identidad pide no colapsar.
 */
export async function llamar<T>(opciones: OpcionesLlamada): Promise<T> {
  const { servicio, baseUrl, metodo, ruta, socioId, cuerpo, logger } = opciones;
  const noDisponible = `${servicio} no disponible`;

  if (!baseUrl) {
    logger.error(`Falta la variable de entorno con la URL de ${servicio}`);
    throw new ServiceUnavailableException(noDisponible);
  }

  const headers: Record<string, string> = {};
  if (cuerpo !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (socioId) {
    headers['X-Socio-Id'] = socioId;
  }

  let respuesta: Response;
  try {
    respuesta = await fetch(`${baseUrl}${ruta}`, {
      method: metodo,
      headers,
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    logger.error(
      `${servicio} no respondio a ${metodo} ${ruta}: ${String(error)}`,
    );
    throw new ServiceUnavailableException(noDisponible);
  }

  if (respuesta.status >= 500) {
    logger.error(
      `${servicio} respondio ${respuesta.status} a ${metodo} ${ruta}`,
    );
    throw new ServiceUnavailableException(noDisponible);
  }

  if (!respuesta.ok) {
    const mensaje = await leerMensaje(respuesta);
    logger.warn(
      `${servicio} respondio ${respuesta.status} a ${metodo} ${ruta}: ${mensaje}`,
    );
    throw new HttpException(mensaje, respuesta.status);
  }

  return (await respuesta.json()) as T;
}

/** Saca el campo message del cuerpo de error de Nest, si lo hay. */
async function leerMensaje(respuesta: Response): Promise<string> {
  try {
    const cuerpo = (await respuesta.json()) as { message?: string | string[] };
    if (Array.isArray(cuerpo.message)) {
      return cuerpo.message.join('; ');
    }
    if (typeof cuerpo.message === 'string') {
      return cuerpo.message;
    }
  } catch {
    // Cuerpo vacio o no JSON: nos quedamos con el status.
  }
  return `Respuesta ${respuesta.status}`;
}
