import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthToken } from '../entities/auth-token.entity';
import { Session } from '../entities/session.entity';
import { User } from '../entities/user.entity';
import { AccountRightsController } from './account-rights.controller';
import { AccountSettingsController } from './account-settings.controller';
import { AccountRightsService } from './account-rights.service';
import { AccountService, MAILER } from './account.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { mailBootLine, mailerFrom } from './mail';
import { ViewerMiddleware } from './viewer.middleware';

@Module({
  imports: [TypeOrmModule.forFeature([User, Session, AuthToken])],
  controllers: [
    AuthController,
    AccountRightsController,
    AccountSettingsController,
  ],
  providers: [
    AuthService,
    ViewerMiddleware,
    AccountService,
    // CAMP-229 (3/3): export (Art. 15) and erasure (Art. 17).
    AccountRightsService,
    {
      // 🔴 Decided once, at boot, and SAID. The mail provider is not set up
      // yet (CAMP-110), so in a deployment nobody configured, sign-up and the
      // two letter forms answer 503 — and this line is what makes the reason
      // obvious, in the same spirit as the build-token line in main.ts.
      provide: MAILER,
      useFactory: () => {
        const result = mailerFrom(process.env);
        console.log(mailBootLine(result, process.env.MAIL_PROVIDER));
        return result.mailer;
      },
    },
  ],
  exports: [AuthService],
})
export class AuthModule implements NestModule {
  /**
   * 🔴 Applied to '*', every route, on purpose.
   *
   * The alternative — listing the routes that need a viewer — is a list
   * that the next authenticated route will not be on, and the failure is
   * silent: `viewer` is undefined, `denyReason` reads it as anonymous,
   * and the owner of a trip gets 401 on their own data. Resolving for
   * everybody costs one indexed lookup, and only when a bearer token is
   * actually present: `parseBearer` returns null for the public
   * traffic that is the overwhelming majority, and `resolveViewer`
   * leaves immediately on null without touching the database.
   */
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(ViewerMiddleware).forRoutes('*');
  }
}
