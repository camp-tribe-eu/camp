import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { NewsletterController } from './newsletter.controller';
import { NewsletterService } from './newsletter.service';

// Підписка на листи: одна відкрита POST, два GET із токеном, одна таблиця
// (`newsletter_subscribers`, НЕ в Directus). Відправник — той самий `MAILER`,
// що в акаунтних листах і «Write to us» (його експортує AuthModule).
@Module({
  imports: [AuthModule],
  controllers: [NewsletterController],
  providers: [NewsletterService],
})
export class NewsletterModule {}
