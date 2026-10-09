import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from "typeorm";
import { v7 as uuidv7 } from "uuid";

@Entity("audit_logs")
@Index(["entityType", "entityId"])
@Index(["actorId", "createdAt"])
export class AuditLog {
  @PrimaryColumn({ type: "uuid", default: () => "gen_random_uuid()" }) // DB fallback for plain-object inserts; entities built with new/create() get a v7
  id: string = uuidv7();

  @Column({ type: "varchar", length: 20 })
  actorType!: string;

  @Column({ type: "uuid", nullable: true })
  actorId?: string | null;

  @Column({ type: "varchar", length: 80 })
  action!: string;

  @Column({ type: "varchar", length: 60 })
  entityType!: string;

  @Column({ type: "varchar", length: 64, nullable: true })
  entityId?: string | null;

  @Column({ type: "jsonb", nullable: true })
  diff?: unknown | null;

  @Column({ type: "varchar", length: 100, nullable: true })
  requestId?: string | null;

  @Column({ type: "varchar", length: 45, nullable: true })
  ip?: string | null;

  @CreateDateColumn({ type: "timestamptz", precision: 3 })
  createdAt!: Date;
}
