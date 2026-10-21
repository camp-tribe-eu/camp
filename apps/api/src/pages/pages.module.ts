import { Module } from '@nestjs/common';
import { PagesController } from './pages.controller';
import { PagesService } from './pages.service';
import { PostsController } from './posts.controller';

@Module({
  controllers: [PagesController, PostsController],
  providers: [PagesService],
})
export class PagesModule {}
