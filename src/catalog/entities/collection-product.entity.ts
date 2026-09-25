import { Column, Entity, Index, JoinColumn, ManyToOne, Relation } from "typeorm";
import { AppBaseEntity } from "../../database/base.entity";
import { Collection } from "./collection.entity";
import { Product } from "./product.entity";

@Entity("collection_products")
@Index(["collectionId"])
@Index(["productId"])
@Index(["collectionId", "productId"], { unique: true })
export class CollectionProduct extends AppBaseEntity {
  @Column({ type: "uuid" })
  collectionId!: string;

  @ManyToOne(() => Collection, { onDelete: "CASCADE" })
  @JoinColumn({ name: "collection_id" })
  collection?: Relation<Collection>;

  @Column({ type: "uuid" })
  productId!: string;

  @ManyToOne(() => Product, { onDelete: "CASCADE" })
  @JoinColumn({ name: "product_id" })
  product?: Relation<Product>;

  @Column({ type: "integer" })
  position!: number;
}
