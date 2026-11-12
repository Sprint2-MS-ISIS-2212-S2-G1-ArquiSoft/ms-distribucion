import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );
  await app.listen(process.env.PORT ?? 3000);

  // Detras del ALB (idle timeout de 60 s) el keep-alive de Node tiene que ser
  // mayor: si no, el ALB reutiliza conexiones que Node ya cerro y aparecen
  // 502 esporadicos bajo carga, que ensucian las metricas del experimento.
  const servidor = app.getHttpServer();
  servidor.keepAliveTimeout = 65_000;
  servidor.headersTimeout = 66_000;
}
bootstrap();
