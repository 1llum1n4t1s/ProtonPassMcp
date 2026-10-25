import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { APP_ID } from './handoff-protocol.mjs';
import { marker, protectDirectory, sweepSession } from './handoff-security.mjs';

async function run(directory) {
  await protectDirectory(directory);
  await marker(directory, { app: APP_ID });
  let stopping = false;
  // 親の終了後に通知パイプが閉じても、回収の再試行を継続する。
  process.stdout.on('error', () => {});
  let running = Promise.resolve();
  const sweep = (all) => {
    running = running.catch(() => {}).then(() => sweepSession(directory, all));
    return running;
  };
  let notified = false;
  const failed = () => {
    if (!notified) { notified = true; process.stdout.write('HANDOFF_CLEANUP_FAILED_V1\n'); }
  };
  const timer = setInterval(() => { void sweep(stopping).then(() => { if (stopping) process.exit(0); }).catch(failed); }, 250);
  process.stdin.resume();
  process.stdin.on('end', () => {
    stopping = true;
    void sweep(true).then(() => { clearInterval(timer); process.exit(0); }).catch(failed);
  });
  process.stdout.write('HANDOFF_READY_V1\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  run(process.argv[2]).catch(() => { process.exitCode = 1; });
}
