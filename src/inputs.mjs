import { z } from 'zod';

// pass-cliはRustのchars().count()でUnicodeコードポイント数を数える。
export const reason = z.string().trim().min(5)
  .refine(value => [...value].length <= 300, '理由は300文字以内で指定してください。')
  .describe('アクセスが必要な具体的なユーザー依頼・目的（最大300文字）');

export const field = z.string().min(1).max(100)
  .regex(/^[^\u0000-\u001f\u007f-\u009f]+$/, 'フィールド名に制御文字は使用できません。')
  .describe('pass-cliのフィールド名。空白・日本語・セクション名を含めて指定可能。');
