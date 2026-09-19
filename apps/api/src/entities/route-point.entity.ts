import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Point } from 'geojson';
import { Route } from './route.entity';

// Ordered waypoints of a Route, used for k-means clustering / routing in AI Trip Planner (CAMP-6)
@Entity('route_points')
export class RoutePoint {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Route, (route) => route.points, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'route_id' })
  route: Route;

  @Column({ name: 'route_id' })
  routeId: string;

  @Column()
  sequence: number;

  @Column({ nullable: true })
  name?: string;

  @Index({ spatial: true })
  @Column({
    type: 'geometry',
    spatialFeatureType: 'Point',
    srid: 4326,
  })
  location: Point;
}
