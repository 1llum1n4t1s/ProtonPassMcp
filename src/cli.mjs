#!/usr/bin/env node

const [command, ...args] = process.argv.slice(2);

if (command === 'setup') {
  if (args.length === 1 && (args[0] === '--help' || args[0] === '-h')) {
    process.stdout.write(`Proton Pass CLIセットアップ

使用方法:
  proton-pass-mcp setup [--force] [--install-dir <directory>]

オプション:
  --force                    既存CLIがあってもstable版を再導入
  --install-dir <directory>  CLIの配置先を指定
  -h, --help                 このヘルプを表示
`);
  } else {
    const { runSetup } = await import('./setup.mjs');
    try {
      const result = await runSetup(args);
      process.stdout.write(`${result.message}\n`);
    } catch (error) {
      process.stderr.write(`Proton Pass CLIのセットアップに失敗しました: ${error instanceof Error ? error.message : '不明なエラー'}\n`);
      process.exitCode = 1;
    }
  }
} else if (command === '--help' || command === '-h') {
  process.stdout.write(`Proton Pass MCP

使用方法:
  proton-pass-mcp              MCPサーバーをstdioで起動
  proton-pass-mcp setup        公式のProton Pass CLIを安全に導入
  proton-pass-mcp setup --help セットアップのオプションを表示
`);
} else if (command) {
  process.stderr.write(`不明なコマンドです: ${command}\n`);
  process.stderr.write('使用方法は proton-pass-mcp --help で確認できます。\n');
  process.exitCode = 1;
} else {
  await import('./server.mjs');
}
