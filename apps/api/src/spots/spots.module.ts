import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SpotsController } from './spots.controller';
import { SpotsService } from './spots.service';
import { MapQueryService } from './map.service';
import { OwnerListingController } from './owner-listing.controller';
import { OwnerListingService } from './owner-listing.service';
import { SpotClaimController } from './spot-claim.controller';
import { SpotClaimService } from './spot-claim.service';

@Module({
  // CAMP-51: заявка на володіння шле лист, і MAILER живе в AuthModule.
  imports: [AuthModule],
  controllers: [SpotsController, SpotClaimController, OwnerListingController],
  providers: [
    SpotsService,
    MapQueryService,
    SpotClaimService,
    OwnerListingService,
  ],
  exports: [
    SpotsService,
    MapQueryService,
    SpotClaimService,
    OwnerListingService,
  ],
})
export class SpotsModule {}
