import { Column, Entity, Index } from "typeorm";
import { VersionedEntity } from "../../database/base.entity";

@Entity("locations")
@Index(["isDefault"], { unique: true, where: '"isDefault" = true' })
export class Location extends VersionedEntity {
  @Column({ type: "varchar", length: 255 })
  name!: string;

  @Column({ type: "boolean", default: false })
  isDefault!: boolean;

  @Column({ type: "boolean", default: true })
  isActive!: boolean;
}
