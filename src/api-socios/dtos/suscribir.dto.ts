import { IsBoolean, IsNotEmpty, IsString } from 'class-validator';

/**
 * Cuerpo de POST /suscribir.
 *
 * Copia literal de SuscribirDto del monolito
 * (src/modules/distribucion/dtos/suscribir.dto.ts). No llevaba socio y sigue
 * sin llevarlo: ahora el socio viene en el header X-Socio-Id, asi que esta
 * ruta gana una identidad de socio que el monolito no tenia.
 */
export class SuscribirDto {
  @IsString()
  @IsNotEmpty()
  idCotizacion!: string;

  @IsBoolean()
  aceptado!: boolean;
}
