import { Controller, Get } from '@nestjs/common';

import { WarningsService } from './warnings.service';

@Controller('warnings')
export class WarningsController {
  constructor(private readonly warnings: WarningsService) {}

  /**
   * CAMP-302: знімок попереджень, без геометрії.
   *
   * 🔴 Віддається те, що лежить у памʼяті, із ЙОГО часом зняття. Тут
   * немає жодного звернення до MeteoAlarm: 27 фідів тягне фоновий
   * оновлювач раз на пʼять хвилин, а не кожен відвідувач.
   */
  @Get()
  current() {
    return this.warnings.current();
  }
}
