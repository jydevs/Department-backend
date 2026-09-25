import { Column, Entity, Index, JoinColumn, ManyToOne, Relation } from "typeorm";
import { AppBaseEntity } from "../../database/base.entity";
import { Product } from "./product.entity";
import { Media } from "./media.entity";

@Entity("product_media")
@Index(["productId"])
@Index(["mediaId"])
@Index(["productId", "mediaId"], { unique: true })
export class ProductMedia extends AppBaseEntity {
  @Column({ type: "uuid" })
  productId!: string;

  @ManyToOne(() => Product, { onDelete: "CASCADE" })
  @JoinColumn({ name: "product_id" })
  product?: Relation<Product>;

  @Column({ type: "uuid" })
  mediaId!: string;

  @ManyToOne(() => Media, { onDelete: "CASCADE" })
  @JoinColumn({ name: "media_id" })
  media?: Relation<Media>;

  @Column({ type: "uuid", nullable: true })
  variantId?: string | null;

  @Column({ type: "integer" })
  position!: number;
}
