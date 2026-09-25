import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { TaxSetting } from "../entities";
import { DatabaseModule } from "../../database/database.module";
import { TaxesController } from "./taxes.controller";
import { TaxesService } from "./taxes.service";

@Module({
  imports: [TypeOrmModule.forFeature([TaxSetting]), DatabaseModule],
  controllers: [TaxesController],
  providers: [TaxesService],
  exports: [TaxesService],
})
export class TaxesModule {}
