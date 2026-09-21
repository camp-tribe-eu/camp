import 'dotenv/config';
import { DataSource } from 'typeorm';
import { User } from './entities/user.entity';
import { CampingSpot } from './entities/camping-spot.entity';
import { Route } from './entities/route.entity';
import { RoutePoint } from './entities/route-point.entity';
import { Trip } from './entities/trip.entity';
import { TripStop } from './entities/trip-stop.entity';
import {
  FeaturedBlock,
  Guide,
  GuideTranslation,
  Language,
  LegalPage,
  LegalPageTranslation,
} from './entities/content.entity';
import {
  CamperType,
  CamperTypeTranslation,
  RentalCity,
  RentalCityTranslation,
} from './entities/rental.entity';
import { PhotoSubmission, Review } from './entities/moderation.entity';

export const AppDataSource = new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL ?? 'postgres://localhost:5432/camptribe_dev',
  entities: [
    User,
    CampingSpot,
    Route,
    RoutePoint,
    Trip,
    TripStop,
    // CAMP-89 editorial content, edited in Directus but owned by our migrations
    Language,
    Guide,
    GuideTranslation,
    LegalPage,
    LegalPageTranslation,
    FeaturedBlock,
    CamperType,
    CamperTypeTranslation,
    RentalCity,
    RentalCityTranslation,
    PhotoSubmission,
    Review,
  ],
  migrations: ['src/migrations/*.ts'],
  synchronize: false,
});
