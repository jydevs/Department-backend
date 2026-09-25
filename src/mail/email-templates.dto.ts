import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import { TEMPLATE_KEYS } from "./default-templates";

export const keyParamSchema = z.object({ key: z.enum(TEMPLATE_KEYS as [string, ...string[]]) });
export class TemplateKeyParamDto extends createZodDto(keyParamSchema) {}

export const MAX_SUBJECT = 255;
export const MAX_BODY_HTML = 100_000;
export const MAX_BODY_TEXT = 50_000;

const updateSchema = z.strictObject({
  subject: z.string().trim().min(1).max(MAX_SUBJECT),
  bodyHtml: z.string().min(1).max(MAX_BODY_HTML),
  bodyText: z.string().min(1).max(MAX_BODY_TEXT),
  isActive: z.boolean(),
});
export class UpdateEmailTemplateDto extends createZodDto(updateSchema) {}

const previewSchema = z.strictObject({
  data: z.record(z.string().max(60), z.unknown()).optional(),
});
export class PreviewEmailTemplateDto extends createZodDto(previewSchema) {}

const testSendSchema = z.strictObject({ to: z.email().max(255) });
export class TestSendEmailTemplateDto extends createZodDto(testSendSchema) {}

export interface EmailTemplateResponse {
  key: string;
  subject: string;
  bodyHtml: string;
  bodyText: string;
  isActive: boolean;
  variables: string[];
  updatedAt: Date;
}

export interface EmailTemplatePreviewResponse {
  subject: string;
  bodyHtml: string;
  bodyText: string;
}
