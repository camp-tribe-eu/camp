import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ContactController } from './contact.controller';
import { ContactService } from './contact.service';

// «Write to us»: one open POST, no table. The sender is the account mailer
// (`MAILER`, exported by AuthModule) — the same SMTP server, the same boot
// line, no second configuration.
@Module({
  imports: [AuthModule],
  controllers: [ContactController],
  providers: [ContactService],
})
export class ContactModule {}
