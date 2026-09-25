import { Column, Entity, Index, JoinColumn, ManyToOne, Relation } from "typeorm";
import { AppBaseEntity } from "../../database/base.entity";
import { Product } from "./product.entity";

@Entity("product_options")
@Index(["productId"])
@Index(["productId", "name"], { unique: true })
export class ProductOption extends AppBaseEntity {
  @Column({ type: "uuid" })
  productId!: string;

  @ManyToOne(() => Product, { onDelete: "CASCADE" })
  @JoinColumn({ name: "product_id" })
  product?: Relation<Product>;

  @Column({ type: "varchar", length: 255 })
  name!: string;

  @Column({ type: "integer" })
  position!: number;
}
