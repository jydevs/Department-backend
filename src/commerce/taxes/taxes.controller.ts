import { Body, Controller, Get, Put } from "@nestjs/common";
import { RequirePermissions } from "../../common/auth/decorators";
import { TaxesService } from "./taxes.service";
import { UpdateTaxDto, type TaxSettingsDto } from "./taxes.dto";

@Controller("admin/taxes")
export class TaxesController {
  constructor(private readonly taxes: TaxesService) {}

  @Get()
  @RequirePermissions("shipping:read")
  get(): Promise<TaxSettingsDto> {
    return this.taxes.get();
  }

  @Put()
  @RequirePermissions("settings:write")
  update(@Body() body: UpdateTaxDto): Promise<TaxSettingsDto> {
    return this.taxes.update(body);
  }
}
