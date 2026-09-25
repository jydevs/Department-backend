import { Column, Entity, Index } from "typeorm";
import { AppBaseEntity } from "../../database/base.entity";

@Entity("redirects")
@Index("uq_redirects_from_path", ["fromPath"], { unique: true })
export class Redirect extends AppBaseEntity {
  @Column({ type: "varchar", length: 500 })
  fromPath!: string;

  @Column({ type: "varchar", length: 1000 })
  toPath!: string;

  @Column({ type: "smallint", default: 301 })
  statusCode!: number; // 301 | 302

  @Column({ type: "boolean", default: true })
  isActive!: boolean;

  @Column({ type: "integer", default: 0 })
  hits!: number;
}
