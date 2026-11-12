import { Controller, Get } from '@nestjs/common';
import { MetricasService } from './metricas.service';

/**
 * GET /metricas: contadores acumulados de la replica que responde (detras del
 * ALB cada llamada puede caer en una replica distinta). Sin guards a
 * proposito: es para el experimento, no para los socios. En AWS el ALB es
 * interno y el gateway no enruta esta ruta.
 */
@Controller('metricas')
export class MetricasController {
  constructor(private readonly metricasService: MetricasService) {}

  @Get()
  obtener() {
    return this.metricasService.acumulado();
  }
}
