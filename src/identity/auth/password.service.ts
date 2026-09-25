import { Injectable } from "@nestjs/common";
import { hash, verify } from "argon2";

/**
 * Password hashing with argon2id (memory 19MiB, t=2, p=1).
 * Timing-safe comparison prevents guessing attacks.
 */
@Injectable()
export class PasswordService {
  async hash(password: string): Promise<string> {
    return hash(password, {
      memoryCost: 19 * 1024,
      timeCost: 2,
      parallelism: 1,
      type: 2, // argon2id
      raw: false,
    });
  }

  async verify(password: string, hash: string): Promise<boolean> {
    try {
      return await verify(hash, password);
    } catch {
      return false;
    }
  }
}
