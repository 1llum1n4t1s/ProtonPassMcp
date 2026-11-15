#!/usr/bin/env node
import { t } from './i18n.mjs';

const [command, ...args] = process.argv.slice(2);

if (command === 'setup') {
  if (args.length === 1 && (args[0] === '--help' || args[0] === '-h')) {
    process.stdout.write(`${t('cli.setupHelp')}\n`);
  } else {
    const { runSetup } = await import('./setup.mjs');
    try {
      const result = await runSetup(args);
      process.stdout.write(`${result.message}\n`);
    } catch (error) {
      process.stderr.write(`${t('cli.setupFailed', { message: error instanceof Error ? error.message : t('cli.unknownError') })}\n`);
      process.exitCode = 1;
    }
  }
} else if (command === '--help' || command === '-h') {
  process.stdout.write(`${t('cli.mainHelp')}\n`);
} else if (command) {
  process.stderr.write(`${t('cli.unknownCommand', { command })}\n`);
  process.stderr.write(`${t('cli.usageHint')}\n`);
  process.exitCode = 1;
} else {
  await import('./server.mjs');
}
