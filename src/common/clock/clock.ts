import { Global, Injectable, Module } from "@nestjs/common";

/** Inject instead of calling `new Date()` in domain code: scheduled publishing, expiries and token TTLs stay testable. */
@Injectable()
export class Clock {
  now(): Date {
    return new Date();
  }
}

@Global()
@Module({ providers: [Clock], exports: [Clock] })
export class ClockModule {}
