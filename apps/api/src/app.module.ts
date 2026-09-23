import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
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

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
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
  providers: [AppService],
})
export class AppModule {}
