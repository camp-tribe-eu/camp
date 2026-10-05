import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Session } from '../entities/session.entity';
import { User } from '../entities/user.entity';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { ViewerMiddleware } from './viewer.middleware';

@Module({
  imports: [TypeOrmModule.forFeature([User, Session])],
  controllers: [AuthController],
  providers: [AuthService, ViewerMiddleware],
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
