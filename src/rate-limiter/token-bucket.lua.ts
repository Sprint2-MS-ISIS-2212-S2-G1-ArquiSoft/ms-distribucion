/**
 * Token bucket por socio, atomico dentro de Redis.
 *
 *   KEYS[1] = ratelimit:<socioId>  estado del bucket (tokens, ts)
 *   KEYS[2] = cuota:<socioId>      cuota propia opcional (hash tps, rafaga)
 *   ARGV[1] = tps por defecto      ARGV[2] = rafaga por defecto
 *   -> { permitido (1|0), tokensRestantes, tpsAplicado }
 *
 * Es en Redis y no en memoria pq hay varias replicas de Distribucion detras
 * del ALB (asg-distribucion 2..4). Un bucket por replica le daria al socio N
 * veces su cuota. Por que Lua: leer, recalcular y escribir tiene que ser una
 * sola operacion, si no dos replicas leen el mismo saldo y las dos lo gastan.
 * Usa el reloj de Redis (TIME) para que todas las replicas compartan la misma
 * referencia de tiempo aunque sus relojes difieran.
 */
export const TOKEN_BUCKET_LUA = `
local rate = tonumber(ARGV[1])
local burst = tonumber(ARGV[2])
local propia = redis.call('HMGET', KEYS[2], 'tps', 'rafaga')
if propia[1] then rate = tonumber(propia[1]) end
if propia[2] then burst = tonumber(propia[2]) end

local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
local data = redis.call('HMGET', KEYS[1], 'tokens', 'ts')
local tokens = tonumber(data[1])
local ts = tonumber(data[2])
if tokens == nil then
  tokens = burst
  ts = now
end
local elapsed = now - ts
if elapsed < 0 then elapsed = 0 end
tokens = math.min(burst, tokens + (elapsed * rate / 1000))
local allowed = 0
if tokens >= 1 then
  tokens = tokens - 1
  allowed = 1
end
redis.call('HSET', KEYS[1], 'tokens', tostring(tokens), 'ts', tostring(now))
redis.call('PEXPIRE', KEYS[1], math.ceil(burst / rate * 1000) + 1000)
return {allowed, tostring(tokens), tostring(rate)}
`;
