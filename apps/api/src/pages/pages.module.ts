import { Module } from '@nestjs/common';
import { LegalController } from './legal.controller';
import { LegalService } from './legal.service';
import { PagesController } from './pages.controller';
import { PagesService } from './pages.service';
import { PostsController } from './posts.controller';

@Module({
  controllers: [PagesController, PostsController, LegalController],
  providers: [PagesService, LegalService],
})
export class PagesModule {}
