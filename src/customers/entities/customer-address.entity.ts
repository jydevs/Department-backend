import { Column, Entity, Index, JoinColumn, ManyToOne, Relation } from "typeorm";
import { AppBaseEntity } from "../../database/base.entity";
import { Customer } from "./customer.entity";

/** Max 10 per customer (validated by the service). */
@Entity("customer_addresses")
@Index(["customerId"])
export class CustomerAddress extends AppBaseEntity {
  @Column({ type: "uuid" })
  customerId!: string;

  @ManyToOne(() => Customer, (c) => c.addresses, { onDelete: "CASCADE" })
  @JoinColumn({ name: "customer_id" })
  customer?: Relation<Customer>;

  @Column({ type: "varchar", length: 40, nullable: true })
  label?: string | null;

  @Column({ type: "boolean", default: false })
  isDefault!: boolean;

  @Column({ type: "varchar", length: 120 })
  fullName!: string;

  @Column({ type: "varchar", length: 30 })
  phone!: string;

  @Column({ type: "varchar", length: 60 })
  department!: string;

  @Column({ type: "varchar", length: 80 })
  city!: string;

  @Column({ type: "varchar", length: 200 })
  address1!: string;

  @Column({ type: "varchar", length: 200, nullable: true })
  address2?: string | null;

  @Column({ type: "varchar", length: 12, nullable: true })
  postalCode?: string | null;

  @Column({ type: "varchar", length: 4, nullable: true })
  documentType?: string | null;

  @Column({ type: "varchar", length: 20, nullable: true })
  documentNumber?: string | null;
}
