import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { CubeController } from './cube.controller';
import { CubeService } from './cube.service';

/**
 * Cube capture ingestion + face delivery. Faces are held in memory (six small
 * images) and written straight to the project's output directory.
 */
@Module({
  imports: [
    MulterModule.register({
      limits: { fileSize: 15 * 1024 * 1024, files: 6 },
    }),
  ],
  controllers: [CubeController],
  providers: [CubeService],
})
export class CubeModule {}
