import { Column, Entity } from "typeorm";
import { AppBaseEntity } from "../../database/base.entity";

@Entity("roles")
export class Role extends AppBaseEntity {
  @Column({ type: "varchar", length: 40, unique: true })
  key!: string;

  @Column({ type: "varchar", length: 255 })
  name!: string;

  @Column({ type: "text", array: true, default: "{}" })
  permissions!: string[];

  @Column({ type: "boolean", default: false })
  isSystem!: boolean;
}
