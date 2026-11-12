import { IsBoolean, IsNotEmpty, IsString } from 'class-validator';

/**
 * Cuerpo de POST /cotizar.
 *
 * Copia de CotizarDto del monolito
 * (src/modules/distribucion/dtos/cotizar.dto.ts) SIN el campo idSocio: la
 * identidad del socio ya no la afirma el llamante en el body, sale del header
 * X-Socio-Id que inyecta el gateway desde el certificado mTLS.
 *
 * En el monolito estos decoradores no se ejecutaban nunca porque su main.ts
 * no registraba ningun ValidationPipe; aqui si, como en los demas
 * microservicios ya migrados.
 */
export class CotizarDto {
  @IsString()
  @IsNotEmpty()
  nombre!: string;

  @IsString()
  @IsNotEmpty()
  documento!: string;

  @IsString()
  @IsNotEmpty()
  idProducto!: string;

  /** Si el socio autoriza consultar Open Data. Lo consume Cotizacion. */
  @IsBoolean()
  aceptaOpenData!: boolean;
}
