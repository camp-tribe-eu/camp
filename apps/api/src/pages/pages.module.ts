import { Module } from '@nestjs/common';
import { LegalController } from './legal.controller';
import { LegalService } from './legal.service';
import { PagesController } from './pages.controller';
import { PagesService } from './pages.service';
import { PostsController } from './posts.controller';
import { SiteSettingsController } from './site-settings.controller';
import { SiteSettingsService } from './site-settings.service';

@Module({
  controllers: [
    PagesController,
    PostsController,
    LegalController,
    SiteSettingsController,
  ],
  providers: [PagesService, LegalService, SiteSettingsService],
})
export class PagesModule {}
