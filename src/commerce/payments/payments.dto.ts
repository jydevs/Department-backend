import { createZodDto } from "nestjs-zod";
import { z } from "zod";

export interface WebhookAckDto {
  received: true;
}

export const mockPaymentSchema = z.object({
  reference: z.string().trim().min(1).max(80),
  status: z.enum(["approved", "declined", "voided", "error"]),
});
export class MockPaymentDto extends createZodDto(mockPaymentSchema) {}

export interface MockPaymentResultDto {
  reference: string;
  status: "approved" | "declined" | "voided" | "error";
  outcome: string;
}
