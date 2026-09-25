import { Column, Entity } from "typeorm";
import { AppBaseEntity } from "../../database/base.entity";

@Entity("media")
export class Media extends AppBaseEntity {
  @Column({ type: "text" })
  url!: string;

  @Column({ type: "text", nullable: true })
  alt?: string | null;

  @Column({ type: "integer", nullable: true })
  width?: number | null;

  @Column({ type: "integer", nullable: true })
  height?: number | null;

  @Column({ type: "varchar", length: 100, nullable: true })
  mimeType?: string | null;
}
