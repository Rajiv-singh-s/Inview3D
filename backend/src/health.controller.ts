import { Controller, Get } from '@nestjs/common';

/** Simple liveness endpoint used by Docker healthchecks and the frontend. */
@Controller('health')
export class HealthController {
  @Get()
  health() {
    return { status: 'ok', service: 'inview3d-backend', timestamp: new Date().toISOString() };
  }
}
