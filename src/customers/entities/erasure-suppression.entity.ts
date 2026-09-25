import { Column, CreateDateColumn, Entity, PrimaryColumn } from "typeorm";

/**
 * Habeas Data suppression list: sha256 of the normalised e-mail of every erased customer (never the address itself).
 * The CSV importer and the storefront registration refuse to recreate a customer whose hash is here.
 */
@Entity("erasure_suppressions")
export class ErasureSuppression {
  @PrimaryColumn({ type: "uuid", default: () => "gen_random_uuid()" })
  id!: string;

  @Column({ type: "char", length: 64, unique: true })
  emailHash!: string;

  @CreateDateColumn({ type: "timestamptz", precision: 3 })
  createdAt!: Date;
}
