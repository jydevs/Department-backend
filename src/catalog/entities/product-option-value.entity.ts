import { Column, Entity, Index, JoinColumn, ManyToOne, Relation } from "typeorm";
import { AppBaseEntity } from "../../database/base.entity";
import { ProductOption } from "./product-option.entity";

@Entity("product_option_values")
@Index(["optionId"])
@Index(["optionId", "value"], { unique: true })
export class ProductOptionValue extends AppBaseEntity {
  @Column({ type: "uuid" })
  optionId!: string;

  @ManyToOne(() => ProductOption, { onDelete: "CASCADE" })
  @JoinColumn({ name: "option_id" })
  option?: Relation<ProductOption>;

  @Column({ type: "varchar", length: 255 })
  value!: string;

  @Column({ type: "integer" })
  position!: number;
}
