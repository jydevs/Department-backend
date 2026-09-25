import { Module } from "@nestjs/common";
import { CartModule } from "./cart/cart.module";
import { CheckoutModule } from "./checkout/checkout.module";
import { DiscountsModule } from "./discounts/discounts.module";
import { OrdersLifecycleModule } from "./orders/orders-lifecycle.module";
import { OrdersModule } from "./orders/orders.module";
import { PaymentsModule } from "./payments/payments.module";
import { PricingModule } from "./pricing/pricing.module";
import { ShippingModule } from "./shipping/shipping.module";
import { TaxesModule } from "./taxes/taxes.module";

/** Commerce: pricing, carts, checkout + payments (Wompi), orders (admin), shipping, discounts, taxes. */
@Module({
  imports: [PricingModule, CartModule, CheckoutModule, PaymentsModule, OrdersLifecycleModule, OrdersModule, ShippingModule, DiscountsModule, TaxesModule],
})
export class CommerceModule {}
