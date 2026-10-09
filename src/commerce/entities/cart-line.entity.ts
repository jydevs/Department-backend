import { Check, Column, Entity, Index, JoinColumn, ManyToOne, Relation } from "typeorm";
import { AppBaseEntity } from "../../database/base.entity";
import { Variant } from "../../catalog/entities/variant.entity";
import { Cart } from "./cart.entity";

@Check("chk_cart_lines_quantity", "\"quantity\" >= 1 AND \"quantity\" <= 20")
@Entity("cart_lines")
@Index(["cartId", "variantId"], { unique: true })
@Index(["variantId"])
export class CartLine extends AppBaseEntity {
  @Column({ type: "uuid" })
  cartId!: string;

  @ManyToOne(() => Cart, { onDelete: "CASCADE" })
  @JoinColumn({ name: "cart_id" })
  cart?: Relation<Cart>;

  @Column({ type: "uuid" })
  variantId!: string;

  @ManyToOne(() => Variant, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "variant_id" })
  variant?: Relation<Variant>;

  @Column({ type: "integer" })
  quantity!: number;
}
