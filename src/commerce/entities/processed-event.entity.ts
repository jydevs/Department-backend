import { Column, Entity, Index } from "typeorm";
import { AppBaseEntity } from "../../database/base.entity";

@Entity("processed_events")
@Index(["provider", "eventId"], { unique: true })
export class ProcessedEvent extends AppBaseEntity {
  @Column({ type: "varchar", length: 20 })
  provider!: string;

  @Column({ type: "varchar", length: 120 })
  eventId!: string;

  @Column({ type: "timestamptz", precision: 3, default: () => "now()" })
  processedAt!: Date;
}
