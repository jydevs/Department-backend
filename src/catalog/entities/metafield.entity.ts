import { Column, Entity, Index } from "typeorm";
import { AppBaseEntity } from "../../database/base.entity";

@Entity("metafields")
@Index(["ownerType", "ownerId", "namespace", "key"], { unique: true })
@Index(["ownerType", "ownerId"])
export class Metafield extends AppBaseEntity {
  @Column({ type: "varchar", length: 30 })
  ownerType!: string;

  @Column({ type: "uuid" })
  ownerId!: string;

  @Column({ type: "varchar", length: 60 })
  namespace!: string;

  @Column({ type: "varchar", length: 60 })
  key!: string;

  @Column({ type: "varchar", length: 30 })
  type!: string;

  @Column({ type: "text" })
  value!: string;
}
