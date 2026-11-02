import {
  BadRequestException,
  Controller,
  Get,
  Header,
  Query,
} from '@nestjs/common';

import { parseRefs } from './frames';
import { FramesService } from './frames.service';

@Controller('webcams')
export class FramesController {
  constructor(private readonly frames: FramesService) {}

  /**
   * CAMP-190: the frame addresses for the cameras a campsite page shows.
   *
   * 🔴 THE PAGE IS STATIC AND THIS ROUTE IS WHY IT CAN STAY STATIC. Windy
   * says an image address is good for 15 minutes; a page lives for days.
   * The browser asks here when the reader reaches the panel.
   *
   * 🔴 `Cache-Control: no-store`. The only clock that may age an address
   * is FRAME_CACHE_MS in `frames.ts`. A browser or an edge holding this
   * answer for a few minutes would add to that age and hand the reader an
   * address closer to its end than the number we proved.
   */
  @Get('frames')
  @Header('Cache-Control', 'no-store')
  one(@Query('refs') refs?: string) {
    const parsed = parseRefs(refs);
    if (!parsed)
      throw new BadRequestException('refs: one to three numeric camera ids');
    return this.frames.frames(parsed);
  }
}
