import { Column, Entity, Index, PrimaryGeneratedColumn } from "typeorm";

@Entity("roles")
@Index(["key"])
export class Role {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "varchar", length: 40, unique: true })
  key!: string;

  @Column({ type: "varchar", length: 255 })
  name!: string;

  @Column({ type: "text", array: true, default: "{}" })
  permissions!: string[];

  @Column({ type: "boolean", default: false })
  isSystem!: boolean;
}
