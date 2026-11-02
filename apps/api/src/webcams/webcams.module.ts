import { Module } from '@nestjs/common';

import { FramesController } from './frames.controller';
import { FramesService } from './frames.service';

@Module({
  controllers: [FramesController],
  providers: [FramesService],
})
export class WebcamsModule {}
