import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { User } from './entities/user.entity';
import { CampingSpot } from './entities/camping-spot.entity';
import { Route } from './entities/route.entity';
import { RoutePoint } from './entities/route-point.entity';
import { Trip } from './entities/trip.entity';
import { TripStop } from './entities/trip-stop.entity';
import { SpotsModule } from './spots/spots.module';
import { TelemetryModule } from './telemetry/telemetry.module';
import { GuidesModule } from './guides/guides.module';
import { ClientError } from './entities/client-error.entity';
import { DEFAULT_LIMIT } from './throttle';
import { ApiThrottlerGuard } from './throttle.guard';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),

    // CAMP-69. The numbers and the reasoning live in throttle.ts, so a
    // test can assert them without booting Nest.
    ThrottlerModule.forRoot([DEFAULT_LIMIT]),
    TypeOrmModule.forRoot({
      type: 'postgres',
      url:
        process.env.DATABASE_URL ?? 'postgres://localhost:5432/camptribe_dev',
      entities: [
        User,
        CampingSpot,
        Route,
        RoutePoint,
        Trip,
        TripStop,
        ClientError,
      ],
      synchronize: false,
    }),
    SpotsModule,
    TelemetryModule,
    GuidesModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // 🔴 Global, not per-controller. A limit you have to remember to add
    // is a limit the next route will not have — and the next route is
    // exactly the one somebody will hammer. Routes that need something
    // other than the default say so with @Throttle; the rest inherit.
    { provide: APP_GUARD, useClass: ApiThrottlerGuard },
  ],
})
export class AppModule {}
