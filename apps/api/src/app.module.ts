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
import { Session } from './entities/session.entity';
import { AuthToken } from './entities/auth-token.entity';
import { ConsentRecord } from './entities/consent-record.entity';
import { TripStop } from './entities/trip-stop.entity';
import { SpotsModule } from './spots/spots.module';
import { RoutesModule } from './routes/routes.module';
import { TelemetryModule } from './telemetry/telemetry.module';
import { GuidesModule } from './guides/guides.module';
import { NavigationModule } from './navigation/navigation.module';
import { PagesModule } from './pages/pages.module';
import { AuthModule } from './auth/auth.module';
import { TripsModule } from './trips/trips.module';
import { HealthModule } from './health/health.module';
import { WarningsModule } from './warnings/warnings.module';
import { ClientError } from './entities/client-error.entity';
import { NotFoundHit } from './entities/not-found-hit.entity';
import { SpotTariff } from './entities/spot-tariff.entity';
import { BathingWater } from './entities/bathing-water.entity';
import {
  AirQualityModelled,
  AirQualityStation,
} from './entities/air-quality.entity';
import { DEFAULT_LIMIT } from './throttle';
import { ApiThrottlerGuard } from './throttle.guard';
import { loadMeasuredScoring } from './planner/scoring';
import { loadMeasuredHardConstraints } from './planner/hard-constraints';
import { loadMeasuredReasons } from './planner/reasons';

/**
 * 🔴 CAMP-262: built as this module LOADS. `loadMeasuredScoring()` checks the
 * scoring weights against the measured coverage table and throws on a weight
 * the data cannot carry, so an API built with one does not start. Nothing
 * injects the planner yet (the service is CAMP-246 and later); the value is
 * here so the check runs in the process that will serve it, and
 * planner/startup.spec.ts fails if it is removed. A value rather than a bare
 * call, so that the planner has something to take and a bare statement does
 * not run, and discard its result, every time this file is imported.
 */
export const SCORING = loadMeasuredScoring();

/**
 * 🔴 CAMP-246: the same for stage 1. A hard constraint that rejects by a
 * value we mostly do not have would reject most of the campsites and call it
 * choosiness; `loadMeasuredHardConstraints()` throws on one, so an API built
 * with it does not start. Loaded AFTER the scoring, so a table that breaks
 * both reports the formula first. planner/startup.spec.ts fails if the call
 * is removed.
 */
export const HARD_CONSTRAINTS = loadMeasuredHardConstraints();

/**
 * 🔴 CAMP-245: the same for "why this one". A reason that stands on a field
 * coverage.snapshot.json does not hold would be a sentence about a record we
 * never counted; `loadMeasuredReasons()` throws on one, so an API built with
 * it does not start. Loaded AFTER the other two, so a table that breaks more
 * than one reports the formula first. planner/startup.spec.ts fails if the
 * call is removed.
 */
export const REASONS = loadMeasuredReasons();

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
        Session,
        AuthToken,
        // CAMP-390: the journal of consents (GDPR Art. 7(1)), append-only.
        ConsentRecord,
        ClientError,
        NotFoundHit,
        SpotTariff,
        BathingWater,
        AirQualityStation,
        AirQualityModelled,
      ],
      synchronize: false,
    }),
    SpotsModule,
    // CAMP-3 / CAMP-45: campsites beside the stages of a curated route.
    RoutesModule,
    HealthModule,
    // CAMP-59: the route an uptime monitor calls. Exempt from the
    // rate limit, because a monitor polling every minute is the one
    // caller we want hitting us constantly.
    TelemetryModule,
    GuidesModule,
    NavigationModule,
    PagesModule,
    // CAMP-50: sessions, and the first routes whose answer depends on
    // who is asking.
    AuthModule,
    TripsModule,
    WarningsModule,
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
