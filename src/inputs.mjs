import { z } from 'zod';

export const id = z.string().min(1).max(512).regex(/^[A-Za-z0-9_+=-]+$/);

// pass-cliはRustのchars().count()でUnicodeコードポイント数を数える。
export const reason = z.string().trim().min(5)
  .refine(value => [...value].length <= 300, 'The reason must be at most 300 characters.')
  .describe('The concrete user request or purpose that requires access (max 300 characters).');

export const field = z.string().min(1).max(100)
  .regex(/^[^\u0000-\u001f\u007f-\u009f]+$/, 'Field names must not contain control characters.')
  .describe('The pass-cli field name. May include spaces, non-ASCII characters, and section names.');
