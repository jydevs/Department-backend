import { Global, Module } from "@nestjs/common";
import { Env, loadEnv } from "./env";

/** Injection token for the validated environment: `@Inject(ENV) private readonly env: Env`. */
export const ENV = Symbol("ENV");

@Global()
@Module({
  providers: [{ provide: ENV, useFactory: (): Env => loadEnv() }],
  exports: [ENV],
})
export class AppConfigModule {}
