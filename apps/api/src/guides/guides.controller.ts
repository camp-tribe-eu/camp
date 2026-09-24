import { Controller, Get, Param } from '@nestjs/common';
import { GuidesService } from './guides.service';

// CAMP-66.
@Controller('guides')
export class GuidesController {
  constructor(private readonly guides: GuidesService) {}

  @Get()
  list() {
    return this.guides.list();
  }

  @Get(':slug')
  bySlug(@Param('slug') slug: string) {
    return this.guides.bySlug(slug);
  }
}
