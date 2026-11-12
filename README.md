# Solventa · microservicio `distribucion`

ISIS-2212 Arquitecturas de software robustas · Grupo 1 · Sprint 2

**Responsabilidad:** Punto de entrada de negocio para los socios. Contiene tres componentes: API socios (endpoints públicos), Rate limiter (cuotas por socio en Redis) y Validador socio (scopes por socio en Redis, rechazo 403 y registro en auditoría).

| | |
|---|---|
| Nodo de despliegue | ASG Distribución ×2 (AZ a / AZ b), detrás del ALB interno |
| Llama a | identidad, suscripciones, siniestros, catalogo, cotizacion, auditoria (HTTP); redis (TCP 6379); vault (HTTPS) |
| Lo llaman | api-gateway (Nginx, mTLS) vía ALB (HTTPS) |
| Base de datos | Sin base de datos relacional: cuotas y scopes en Redis |
| Puerto interno | 3000 |
| Origen en el monolito | `src/modules/distribucion` |

Los tres componentes del diagrama son tres carpetas:

| Componente | Carpeta |
|---|---|
| API socios | `src/api-socios/` |
| Rate limiter | `src/rate-limiter/` |
| Validador socio | `src/validador-socio/` |

y los seis clientes HTTP hacia los vecinos viven en `src/clients/`.

## Correr en local

```bash
cp .env.example .env
npm ci
npm run start:dev
```

El despliegue (docker-compose por nodo EC2), el gateway, los certificados y la documentación de experimentos viven en el repositorio paraguas `Sprint2-MS-ISIS-2212-S2-G1-ArquiSoft/ISIS2212_202620_S2_Grupo1`, rama `sprint-2-microservicios`.

## Correr en local con Docker

```bash
docker compose -f docker-compose.local.yml up -d --build
curl localhost:3000/health
docker compose -f docker-compose.local.yml down
```

`docker-compose.local.yml` es **solo para desarrollo**: levanta este servicio (host `3000` → contenedor `3000`), un `redis:7-alpine` (host `6379`) y **un mock por cada uno de los seis vecinos**.

Los seis mocks corren el mismo servidor genérico (`mocks/server.js`) y se diferencian solo por su JSON de rutas (`mocks/<servicio>.json`), que declara método, ruta, casos condicionales e interpolación de valores de la petición. Los de **catalogo**, **identidad** y **cotizacion** implementan el contrato **real** documentado en los README de `ms-catalogo`, `ms-identidad` y `ms-cotizacion`; los de **suscripciones**, **siniestros** y **auditoria** implementan los contratos de la sección "Contratos pendientes" de abajo.

Cada mock loguea método, ruta y body de cada petición, así que `docker compose -f docker-compose.local.yml logs cotizacion-mock` muestra los `PATCH /cotizaciones/:id/estado` que hace Distribución.

Para probar los caminos de error:

```bash
# 503: Identidad no responde
docker compose -f docker-compose.local.yml stop identidad-mock
docker compose -f docker-compose.local.yml start identidad-mock

# 402 + compensación RECHAZADA: documento que empieza por "000"
# 400 KYC: documento que empieza por "999"
```

### Datos semilla

`src/socios/socios.seed.json` trae el único socio de `database/solventa.sql` del monolito, que es además el `socioDistribucionId` que usan las cotizaciones semilla de `ms-cotizacion`:

| id | nombreEmpresa | sectorIndustria |
|---|---|---|
| `123e4567-e89b-12d3-a456-426614174001` | Banco Aliado | FINANCIERO |

Al arrancar, `SociosService` lo escribe en Redis bajo `socio:<id>` con `SET ... NX`: si la clave ya existe no la sobrescribe.

Los mocks encadenan ids deterministas para que el flujo completo se pueda probar sin que ninguno guarde estado:

| Documento | Cliente (identidad) | Cotización (cotizacion) | Suscripción |
|---|---|---|---|
| cualquiera | `…174010` Ana Gomez | `…174020` | `201` |
| empieza por `000` | `…174011` Moroso Perez | `…174021` | `402` + compensación |
| empieza por `999` | `400` KYC | — | — |

## API

Contrato que ven los socios. Todas las respuestas son `application/json`.

El header `X-Socio-Id` es **obligatorio en las tres rutas**. En producción lo inyecta el gateway Nginx a partir del certificado mTLS del socio; el socio nunca lo envía él mismo. En el monolito el socio llegaba como un campo del body (`CotizarDto.idSocio`), así que el llamante afirmaba su propia identidad.

Errores comunes a las tres rutas:

| | |
|---|---|
| `401` | `{ "message": "Socio no identificado", "error": "Unauthorized", "statusCode": 401 }` — falta `X-Socio-Id` |
| `403` | `{ "message": "Socio no autorizado", "error": "Forbidden", "statusCode": 403 }` — el socio no está en Redis |
| `429` | `{ "message": "Cuota de solicitudes excedida para el socio", "statusCode": 429 }` — el socio superó su cuota (ver *ASR de escalabilidad*). Trae `Retry-After` |
| `503` | `{ "message": "<Servicio> no disponible", ... }` — un vecino no respondió (timeout de 5 s, conexión rechazada o `5xx`) |

Los `4xx` de los vecinos **se propagan con su status y su mensaje**: Distribución es un orquestador y el socio tiene que ver el error real del servicio dueño del dato. Eso mantiene separados el `400` de Identidad ("este documento no pasó la verificación") y su `503` ("no pudimos verificar"), que su README pide explícitamente no colapsar.

### `GET /health`

Verifica el servicio y la conexión a Redis (`PING`). No consulta a los seis vecinos a propósito: la salud de este contenedor no debe depender de ellos.

| | |
|---|---|
| Body | — |
| `200` | `{ "status": "ok" }` |
| `503` | `{ "status": "error", "redis": "unreachable" }` |

### `POST /cotizar`

Era `POST /distribucion/cotizar`. Orquesta Catálogo → Identidad → Cotización.

| | |
|---|---|
| Header | `X-Socio-Id`: uuid del socio. **Obligatorio.** |
| Body | `{ "nombre": string, "documento": string, "idProducto": string, "aceptaOpenData": boolean }` |
| `201` | la cotización creada |
| `400` | body inválido; o `Fallo en la verificación KYC` si Identidad rechaza el documento |
| `404` | `Producto de seguro con id <id> no encontrado` |
| `503` | `Catálogo no disponible`, `Identidad no disponible` o `Cotización no disponible` |

```bash
curl -X POST localhost:3000/cotizar \
  -H 'Content-Type: application/json' \
  -H 'X-Socio-Id: 123e4567-e89b-12d3-a456-426614174001' \
  -d '{
    "nombre": "Ana Gomez",
    "documento": "1020304050",
    "idProducto": "123e4567-e89b-12d3-a456-426614174000",
    "aceptaOpenData": true
  }'
```

```json
{
  "id": "123e4567-e89b-12d3-a456-426614174020",
  "estado": "PENDIENTE",
  "primaMensual": "85000.00",
  "sumaAsegurada": "5750000.00",
  "fechaEmision": "2026-11-11T00:00:00.000Z",
  "fechaVencimiento": "2026-11-26T00:00:00.000Z",
  "socioDistribucionId": "123e4567-e89b-12d3-a456-426614174001",
  "productoId": "123e4567-e89b-12d3-a456-426614174000",
  "suscripcionId": null,
  "clienteId": "123e4567-e89b-12d3-a456-426614174010"
}
```

Pasos, con el servicio dueño de cada uno:

1. `GET /productos/:id` en **catalogo** → el producto.
2. `POST /clientes/verificacion` en **identidad** → el cliente (get-or-create por documento, con el KYC de Terceros dentro).
3. `POST /cotizaciones` en **cotizacion**, con `X-Socio-Id` y `{productoId, sumaAseguradaMaxima, clienteId, documento, aceptaOpenData}`.

`sumaAseguradaMaxima` se reenvía **como string**, sin `parseFloat`: es un `numeric(14,2)` de Postgres y el cálculo de la prima lo hace Cotización. La consulta de **Open Data** ya no la hace Distribución (en el monolito era el paso 4 de `cotizar`): la hace Cotización a partir de `aceptaOpenData`.

### `POST /suscribir`

Era `POST /distribucion/suscribir`. Orquesta Cotización → Identidad → Suscripciones, con compensación.

| | |
|---|---|
| Header | `X-Socio-Id`: uuid del socio. **Obligatorio.** |
| Body | `{ "idCotizacion": string, "aceptado": boolean }` |
| `201` | la suscripción con su póliza |
| `400` | body inválido; `La cotización no fue aceptada por el cliente` si `aceptado` es `false`; `Cotización inválida o expirada` |
| `402` | `El pago fue rechazado` |
| `404` | `Cliente con id <id> no encontrado` |
| `503` | `Cotización no disponible`, `Identidad no disponible` o `Suscripciones no disponible` |

```bash
curl -X POST localhost:3000/suscribir \
  -H 'Content-Type: application/json' \
  -H 'X-Socio-Id: 123e4567-e89b-12d3-a456-426614174001' \
  -d '{"idCotizacion":"123e4567-e89b-12d3-a456-426614174020","aceptado":true}'
```

```json
{
  "suscripcionId": "123e4567-e89b-12d3-a456-426614174030",
  "estado": "ACEPTADA",
  "puntajeRiesgo": 80,
  "polizaId": "123e4567-e89b-12d3-a456-426614174040",
  "numeroPoliza": "POL-00000001",
  "estadoPoliza": "ACTIVA",
  "fechaInicioVigencia": "2026-11-11T00:00:00.000Z",
  "fechaFinVigencia": "2027-11-11T00:00:00.000Z",
  "cotizacionId": "123e4567-e89b-12d3-a456-426614174020",
  "clienteId": "123e4567-e89b-12d3-a456-426614174010"
}
```

Pasos:

1. Si `aceptado` es `false` → `400 'La cotización no fue aceptada por el cliente'` (mensaje literal del monolito).
2. `POST /cotizaciones/:id/validacion` en **cotizacion** → la cotización vigente. Su `400 'Cotización inválida o expirada'` se propaga. Esa llamada tiene un efecto de escritura heredado del monolito: si la cotización venció estando `PENDIENTE`, Cotización la marca `EXPIRADA`.
3. `GET /clientes/:clienteId` en **identidad** → el `documento`. En el monolito el cliente venía dentro de la entidad `Cotizacion`; ahora la cotización solo trae `clienteId`.
4. `POST /suscripciones` en **suscripciones**, con `{cotizacionId, clienteId, documento, primaMensual, sumaAsegurada}`. **Una sola llamada**: Suscripciones calcula el puntaje de riesgo, cobra la prima en Terceros y emite la póliza en Emisión.
5. Éxito → `PATCH /cotizaciones/:id/estado` con `{"estado":"ACEPTADA"}`.
6. Error en el paso 4 → **compensación**: `PATCH /cotizaciones/:id/estado` con `{"estado":"RECHAZADA"}` y se propaga el error original con su status.

Según el diagrama, Suscripciones no llama a Cotización ni a Identidad, y por eso Distribución resuelve antes la cotización y el documento. La compensación es exactamente la del monolito (`distribucion.service.ts:99-105`: rollback de la transacción y después `actualizarEstado(..., RECHAZADA)` fuera de ella), con una diferencia: el monolito aplanaba **todo** a un `400 'Fallo en suscripción/emisión: …'`, con lo que un pago rechazado y un body malo se veían igual. Aquí cada error conserva su status. Si la compensación misma falla, se registra en el log y no tapa el error original. No hay saga ni reintentos.

### `GET /siniestros/poliza/:numeroPoliza`

Era una ruta pública del módulo `siniestros` del monolito. Se expone **con la misma ruta** porque en microservicios el socio solo entra por Distribución, y se reenvía a `ms-siniestros`.

| | |
|---|---|
| Header | `X-Socio-Id`: uuid del socio. **Obligatorio.** |
| Param | `numeroPoliza`: número de póliza (p. ej. `POL-001`) |
| Body | — |
| `200` | arreglo de siniestros |
| `404` | `No se encontraron siniestros para la póliza <numeroPoliza>` |
| `503` | `Siniestros no disponible` |

```bash
curl localhost:3000/siniestros/poliza/POL-001 \
  -H 'X-Socio-Id: 123e4567-e89b-12d3-a456-426614174001'
```

La caché de Redis con TTL de 60 s que el monolito tenía en `siniestros.service.ts` **no se migra**: es táctica del ASR de Siniestros y le corresponde a ese servicio.

## Contrato que ya consumimos (no se toca)

De los README de los servicios ya migrados:

| Servicio | Llamada |
|---|---|
| catalogo | `GET /productos/:id` → `{id, nombre, ramo, sumaAseguradaMaxima}` (string); `404` |
| identidad | `POST /clientes/verificacion` `{nombre, documento}` → `200 {id, nombre, documento}`; `400` KYC, `503` Terceros |
| identidad | `GET /clientes/:id` → `200 {id, nombre, documento}`; `404` |
| cotizacion | `POST /cotizaciones` + `X-Socio-Id` obligatorio, body `{productoId, sumaAseguradaMaxima, clienteId, documento, aceptaOpenData}` → `201`; `400`; `503` |
| cotizacion | `POST /cotizaciones/:id/validacion` → `200`; `400 'Cotización inválida o expirada'` |
| cotizacion | `PATCH /cotizaciones/:id/estado` `{estado}` → `200`; `400`; `404` |

## Contratos pendientes

Estos tres servicios todavía no están migrados. Los contratos salen de cómo el monolito usaba sus services y **deben implementarse exactamente así**. Rutas REST sin prefijo de módulo, `POST` cuando el body lleva datos personales, y bodies y respuestas con IDs en vez de entidades completas.

### `ms-suscripciones` · `POST /suscripciones`

Reemplaza las tres llamadas en proceso que `DistribucionService.suscribirYEmitir` hacía dentro de una transacción de TypeORM: `suscripcionService.evaluarYCrear()`, `tercerosService.processPayment()` y `emisionService.emitirPoliza()`.

| | |
|---|---|
| Header | `X-Socio-Id`: uuid del socio. **Obligatorio.** |
| Body | `{ "cotizacionId": uuid, "clienteId": uuid, "documento": string, "primaMensual": string numérico, "sumaAsegurada": string numérico }` |
| `201` | `{ suscripcionId, estado, puntajeRiesgo, polizaId, numeroPoliza, estadoPoliza, fechaInicioVigencia, fechaFinVigencia, cotizacionId, clienteId }` |
| `400` | body inválido o `X-Socio-Id` ausente |
| `402` | `{ "message": "El pago fue rechazado", ... }` |
| `503` | Terceros (pagos) o Emisión no responden |

Lo que hace por dentro, copiado del monolito:

```
puntajeRiesgo = sumaAsegurada > 1000000 ? 80 : sumaAsegurada > 500000 ? 50 : 20
estado        = ACEPTADA                       // nunca rechaza
pago          = POST {TERCEROS_URL}/pagos/cobros {documento, monto: primaMensual}
poliza        = numeroPoliza 'POL-' + 8 dígitos, ACTIVA, vigencia hoy → +1 año
```

**No** devuelve `400` por cotización inválida ni por cliente sin asociar: Distribución ya resolvió las dos cosas antes de llamar (pasos 2 y 3 de `POST /suscribir`), y según el diagrama Suscripciones no llama a Cotización ni a Identidad.

`primaMensual` y `sumaAsegurada` viajan como **string** porque son `numeric(14,2)`; es también lo que espera `POST /pagos/cobros` de `ms-terceros` en su campo `monto`.

### `ms-siniestros` · `GET /siniestros/poliza/:numeroPoliza`

Reemplaza `siniestrosService.consultarPorPoliza(numeroPoliza)`, que en el monolito era la única ruta pública fuera de Distribución.

| | |
|---|---|
| Param | `numeroPoliza`: número de póliza |
| Body | — |
| `200` | `[{ id, descripcionEvento, montoReclamado: string, estado, polizaId, numeroPoliza }]` |
| `404` | `{ "message": "No se encontraron siniestros para la póliza <numeroPoliza>", ... }` |

La relación `@ManyToOne` hacia `Poliza` del monolito es aquí la columna `polizaId` (regla 3), y `numeroPoliza` se incluye en la respuesta para que el consumidor no tenga que volver a preguntar.

### `ms-auditoria` · `POST /eventos`

| | |
|---|---|
| Header | `X-Socio-Id`: uuid del socio. Opcional. |
| Body | `{ "socioId": uuid, "accion": string, "recurso": string, "resultado": string, "detalle"?: string, "fecha": ISO-8601 }` |
| `201` | `{ "id": uuid }` |
| `400` | body inválido |

El monolito **no tiene** ningún módulo, servicio, interceptor ni tabla de auditoría: este contrato es nuevo y sale del diagrama, donde el Validador socio registra en Auditoría los rechazos. `src/clients/auditoria.client.ts` ya está escrito pero **nadie lo invoca todavía** (ver TODO abajo).

## Qué no se migró

- **`Solventa`** (`entities/solventa.entity.ts`, `nit` + `razonSocial`): tenía cero uso en runtime. Estaba en el `TypeOrmModule.forFeature` de `distribucion.module.ts` y nada más — ningún repositorio la inyectaba, nadie la leía ni la escribía, y la tabla viene vacía tanto en `database/solventa.sql` como en `seed.sql`. No se creó ningún artefacto para ella.
- **El auto-create de socios.** `distribucion.service.ts:35-40` creaba y persistía un socio `'Mock Socio'` / `'IT'` con el id que llegara en el body cuando el `idSocio` no existía: un camino de escritura público con el que cualquiera podía acuñar socios. Aquí un socio desconocido es `403 'Socio no autorizado'`.
- **`polizas-exp`** (`GET /polizas`, `PATCH /polizas/:id/estado`): es el experimento de escalabilidad del ASR QS-004, con su propia conexión TypeORM contra otra base de datos y una tabla sin índices a propósito. No es una ruta de negocio del socio y vive en el repositorio paraguas.
- **`GET /`** → `'Hello World!'`: andamio de NestJS sin tocar.
- **La transacción de TypeORM** de `suscribirYEmitir`. La atomicidad que el monolito lograba con un solo `QueryRunner` sobre una sola base desaparece al separar los servicios; la reemplaza la compensación `RECHAZADA`.
- **La consulta de Open Data** (paso 4 de `cotizar`): ahora la hace `ms-cotizacion`.
- **La caché de siniestros** (Redis, TTL 60 s): táctica del ASR de Siniestros.

## ASR de escalabilidad · aislamiento de carga por socio (Ivonne)

Tácticas implementadas en este servicio. Cada una se apaga con una variable,
así la corrida **sin tácticas** del experimento usa la misma imagen:

| Táctica | Dónde | Apagar |
|---|---|---|
| Rate limit por socio: token bucket en Redis, `429` en el borde | `src/rate-limiter/` | `RATE_LIMIT_ENABLED=false` |
| Caché cache-aside de `POST /clientes/verificacion` de Identidad (TTL corto) | `src/cache-clientes/` | `CACHE_ENABLED=false` |
| Réplicas stateless detrás del ALB (`asg-distribucion`) | todo el estado vive en Redis | — |

**Rate limiter.** Cada socio tiene su propio bucket en Redis: `RATE_LIMIT_TPS`
tokens por segundo (10 por defecto) con ráfaga de `RATE_LIMIT_BURST` (20).
- **Por qué en Redis:** si el bucket estuviera en la memoria de cada réplica, con
  N réplicas el socio tendría N veces su cuota.
- **Por qué con un script Lua:** leer, recalcular y escribir el saldo es una sola
  operación atómica, y el reloj es el de Redis.
- **Cuota propia de un socio,** sin reiniciar: `HSET cuota:<socioId> tps 50 rafaga 100`.

El exceso recibe:

```
429 { "message": "Cuota de solicitudes excedida para el socio", "statusCode": 429 }
Retry-After: <s>   X-RateLimit-Limit: <tps>   X-RateLimit-Remaining: <tokens>
```

Si Redis no responde, `RATE_LIMIT_FAIL_OPEN=true` deja pasar (prioriza
disponibilidad) y `false` responde `503`.

**Caché de clientes.**
- **Por qué se puede cachear:** la verificación es un get-or-create por documento,
  así que el mismo documento siempre da el mismo cliente.
- **Clave y TTL:** la clave es el SHA-256 del documento y el TTL es `CACHE_TTL_S`
  (60 s por defecto).
- **Qué no se guarda:** los `400` de KYC ni los `503`.
- **Si Redis no responde:** se llama directo a Identidad.

En el diseño del equipo el socio se valida contra Redis (`socio:<id>`), no contra
Identidad. Por eso la llamada a Identidad que se cachea es la verificación del
cliente, que ocurre en cada cotización.

**Socios de carga.** `socios.seed.json` trae, además de Banco Aliado, 50 socios
`Socio Carga 01…50` con ids `00000000-0000-4000-8000-0000000000NN` para JMeter.

### `GET /metricas`

Contadores acumulados de la réplica que responde:
- `cacheHits`, `cacheMisses` y `cacheHitRatio`;
- `aceptadasPorSocio`, `rechazos429PorSocio` y sus totales;
- `cacheErrores` y `rateLimitErrores`.

Además, cada `METRICAS_INTERVALO_S` segundos cada réplica escribe en el log una
línea JSON con `"metrica":"distribucion"` con los contadores de esa ventana. Sirve
para sumar entre réplicas:

```bash
docker logs <contenedor> | grep '"metrica":"distribucion"'
```

## Tácticas de ASR que no se migraron

El andamio no trae lógica de ASRs. Están **deliberadamente ausentes**:

- **validación de scopes por socio y registro de los rechazos en Auditoría** — `src/validador-socio/validador-socio.guard.ts` solo comprueba que el socio exista (`TODO: ASR de seguridad, Martín`);
- **mTLS** — lo termina el gateway Nginx, que es el que inyecta `X-Socio-Id`;
- **lectura de secretos de Vault** — solo queda `VAULT_ADDR` declarado en `.env.example`;
- **caché, circuit breaker y reintentos** en los clientes HTTP. El mock del monolito los tenía con `opossum`; aquí solo queda el timeout de 5 s, que es obligatorio (regla 5). Consecuencia conocida: el `503 'Servicio Open Data no disponible'` de Cotización llega al socio como `503 'Cotización no disponible'`, porque cualquier `5xx` de un vecino se traduce a `<Servicio> no disponible`;
- **idempotencia** de `POST /cotizar` y `POST /suscribir`;
- **filtrado por pertenencia del socio**: nada impide todavía que un socio suscriba la cotización de otro, igual que en el monolito.
