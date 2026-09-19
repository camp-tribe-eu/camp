import 'dotenv/config';
import { DataSource } from 'typeorm';
import { User } from './entities/user.entity';
import { CampingSpot } from './entities/camping-spot.entity';
import { Route } from './entities/route.entity';
import { RoutePoint } from './entities/route-point.entity';
import { Trip } from './entities/trip.entity';
import { TripStop } from './entities/trip-stop.entity';

export const AppDataSource = new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL ?? 'postgres://localhost:5432/camptribe_dev',
  entities: [User, CampingSpot, Route, RoutePoint, Trip, TripStop],
  migrations: ['src/migrations/*.ts'],
  synchronize: false,
});
