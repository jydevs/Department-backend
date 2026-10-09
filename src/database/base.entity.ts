import { v7 as uuidv7 } from "uuid";
import { CreateDateColumn, PrimaryColumn, UpdateDateColumn, VersionColumn } from "typeorm";

/**
 * uuid v7 primary key (time-ordered: index-friendly and usable for keyset pagination)
 * + timestamptz audit columns with millisecond precision, so JS `Date` cursors round-trip exactly.
 */
export abstract class AppBaseEntity {
  @PrimaryColumn({ type: "uuid", default: () => "gen_random_uuid()" }) // DB fallback for plain-object inserts; entities built with new/create() get a v7
  id: string = uuidv7();

  @CreateDateColumn({ type: "timestamptz", precision: 3 })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz", precision: 3 })
  updatedAt!: Date;
}

/**
 * Opt-in optimistic locking. NOTE: TypeORM only bumps `version` through `save()`;
 * money / stock code must use `UPDATE … WHERE id = $1 AND version = $2` and check the affected-row count.
 */
export abstract class VersionedEntity extends AppBaseEntity {
  @VersionColumn()
  version!: number;
}

/** Opt-in soft delete (keeps history for orders / customers). Use `softRemove` / `restore`. */
export { DeleteDateColumn } from "typeorm";
