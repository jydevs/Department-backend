import { Body, Controller, Get, HttpCode, Param, Post, Put } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { RequirePermissions } from "../common/auth/decorators";
import {
  PreviewEmailTemplateDto,
  TemplateKeyParamDto,
  TestSendEmailTemplateDto,
  UpdateEmailTemplateDto,
  type EmailTemplatePreviewResponse,
  type EmailTemplateResponse,
} from "./email-templates.dto";
import { EmailTemplatesService } from "./email-templates.service";

@Controller("admin/email-templates")
export class EmailTemplatesController {
  constructor(private readonly templates: EmailTemplatesService) {}

  @Get()
  @RequirePermissions("marketing:read")
  list(): Promise<EmailTemplateResponse[]> {
    return this.templates.list();
  }

  @Get(":key")
  @RequirePermissions("marketing:read")
  get(@Param() { key }: TemplateKeyParamDto): Promise<EmailTemplateResponse> {
    return this.templates.get(key);
  }

  @Put(":key")
  @RequirePermissions("marketing:write")
  update(@Param() { key }: TemplateKeyParamDto, @Body() body: UpdateEmailTemplateDto): Promise<EmailTemplateResponse> {
    return this.templates.update(key, body);
  }

  @Post(":key/preview")
  @HttpCode(200)
  @RequirePermissions("marketing:write")
  preview(@Param() { key }: TemplateKeyParamDto, @Body() body: PreviewEmailTemplateDto): Promise<EmailTemplatePreviewResponse> {
    return this.templates.preview(key, body);
  }

  @Post(":key/test-send")
  @HttpCode(202)
  @RequirePermissions("marketing:write")
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async testSend(@Param() { key }: TemplateKeyParamDto, @Body() body: TestSendEmailTemplateDto): Promise<void> {
    await this.templates.testSend(key, body.to);
  }
}
