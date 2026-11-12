'use strict';

/**
 * Servidor de mocks generico, compartido por los seis vecinos de Distribucion
 * en docker-compose.local.yml. Solo para desarrollo local.
 *
 * Se configura con dos variables de entorno:
 *   MOCK_NAME    nombre que aparece en los logs
 *   MOCK_CONFIG  ruta al JSON de rutas (mocks/<servicio>.json)
 *
 * Cada ruta del JSON tiene la forma:
 *   {
 *     "metodo": "POST",
 *     "ruta": "/cotizaciones/:id/validacion",
 *     "casos": [
 *       { "cuando": { "campo": "body.documento", "empiezaPor": "000" },
 *         "status": 402, "cuerpo": { ... } },
 *       { "status": 200, "cuerpo": { ... } }            // caso por defecto
 *     ]
 *   }
 *
 * "cuando" admite "igual" o "empiezaPor" sobre un campo que puede ser
 * body.<clave>, param.<nombre> o header.<nombre>. El primer caso cuyo
 * "cuando" se cumpla (o que no tenga "cuando") es el que responde.
 *
 * En los cuerpos se pueden interpolar valores de la peticion con
 * {{body.clienteId}}, {{param.id}} o {{header.x-socio-id}}.
 *
 * Toda peticion se loguea con metodo, ruta y body: asi se comprueba en los
 * logs del mock de cotizacion que Distribucion llamo al PATCH de estado
 * (ACEPTADA en el flujo feliz, RECHAZADA en la compensacion).
 */

const http = require('node:http');
const fs = require('node:fs');

const NOMBRE = process.env.MOCK_NAME || 'mock';
const CONFIG = process.env.MOCK_CONFIG;
const PUERTO = Number(process.env.PORT || 3000);

if (!CONFIG) {
  console.error('[%s] Falta MOCK_CONFIG', NOMBRE);
  process.exit(1);
}

const rutas = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));

/** Convierte /cotizaciones/:id/validacion en una expresion regular. */
function compilar(patron) {
  const nombres = [];
  const fuente = patron
    .split('/')
    .map((segmento) => {
      if (segmento.startsWith(':')) {
        nombres.push(segmento.slice(1));
        return '([^/]+)';
      }
      return segmento.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  return { regex: new RegExp(`^${fuente}$`), nombres };
}

const compiladas = rutas.map((ruta) => ({ ...ruta, ...compilar(ruta.ruta) }));

/** Lee body.x / param.x / header.x de la peticion. */
function leerCampo(campo, contexto) {
  const punto = campo.indexOf('.');
  const origen = campo.slice(0, punto);
  const clave = campo.slice(punto + 1);
  if (origen === 'body') return contexto.body[clave];
  if (origen === 'param') return contexto.params[clave];
  if (origen === 'header') return contexto.headers[clave.toLowerCase()];
  return undefined;
}

function cumple(cuando, contexto) {
  if (!cuando) return true;
  const valor = leerCampo(cuando.campo, contexto);
  if (cuando.igual !== undefined) return valor === cuando.igual;
  if (cuando.empiezaPor !== undefined) {
    return typeof valor === 'string' && valor.startsWith(cuando.empiezaPor);
  }
  if (cuando.existe !== undefined) {
    const existe = valor !== undefined && valor !== null && valor !== '';
    return existe === cuando.existe;
  }
  return false;
}

/** Sustituye {{body.x}}, {{param.x}} y {{header.x}} en todo el cuerpo. */
function interpolar(valor, contexto) {
  if (typeof valor === 'string') {
    const exacto = valor.match(/^\{\{([^}]+)\}\}$/);
    if (exacto) {
      const resuelto = leerCampo(exacto[1].trim(), contexto);
      return resuelto === undefined ? null : resuelto;
    }
    return valor.replace(/\{\{([^}]+)\}\}/g, (_, campo) => {
      const resuelto = leerCampo(campo.trim(), contexto);
      return resuelto === undefined ? '' : String(resuelto);
    });
  }
  if (Array.isArray(valor)) return valor.map((v) => interpolar(v, contexto));
  if (valor && typeof valor === 'object') {
    return Object.fromEntries(
      Object.entries(valor).map(([k, v]) => [k, interpolar(v, contexto)]),
    );
  }
  return valor;
}

const servidor = http.createServer((peticion, respuesta) => {
  const trozos = [];
  peticion.on('data', (trozo) => trozos.push(trozo));
  peticion.on('end', () => {
    const crudo = Buffer.concat(trozos).toString('utf8');
    const ruta = peticion.url.split('?')[0];
    console.log(
      '[%s] %s %s %s',
      NOMBRE,
      peticion.method,
      ruta,
      crudo === '' ? '' : crudo,
    );

    let body = {};
    if (crudo !== '') {
      try {
        body = JSON.parse(crudo);
      } catch {
        return responder(respuesta, 400, { message: 'JSON invalido' });
      }
    }

    for (const candidata of compiladas) {
      if (candidata.metodo !== peticion.method) continue;
      const coincidencia = candidata.regex.exec(ruta);
      if (!coincidencia) continue;

      const params = {};
      candidata.nombres.forEach((nombre, indice) => {
        params[nombre] = decodeURIComponent(coincidencia[indice + 1]);
      });
      const contexto = { body, params, headers: peticion.headers };

      const caso = (candidata.casos || []).find((c) => cumple(c.cuando, contexto));
      if (!caso) {
        return responder(respuesta, 500, { message: 'Mock sin caso aplicable' });
      }
      return responder(
        respuesta,
        caso.status,
        interpolar(caso.cuerpo, contexto),
      );
    }

    responder(respuesta, 404, { error: 'not found' });
  });
});

function responder(respuesta, status, cuerpo) {
  respuesta.writeHead(status, { 'Content-Type': 'application/json' });
  respuesta.end(JSON.stringify(cuerpo === undefined ? null : cuerpo));
}

servidor.listen(PUERTO, () =>
  console.log('[%s] escuchando en %d', NOMBRE, PUERTO),
);
