import { Column, Entity, Index, OneToMany, Relation } from "typeorm";
import { AppBaseEntity } from "../../database/base.entity";
import type { CartLine } from "./cart-line.entity";

@Entity("carts")
@Index(["expiresAt"])
export class Cart extends AppBaseEntity {
  @Column({ type: "char", length: 64, unique: true })
  tokenHash!: string;

  @Column({ type: "varchar", length: 3, default: "COP" })
  currency!: string;

  @Column({ type: "varchar", length: 40, nullable: true })
  discountCode?: string | null;

  @Column({ type: "timestamptz", precision: 3 })
  expiresAt!: Date;

  @Column({ type: "uuid", nullable: true })
  convertedOrderId?: string | null;

  @OneToMany("CartLine", (line: CartLine) => line.cart)
  lines?: Relation<CartLine[]>;
}
