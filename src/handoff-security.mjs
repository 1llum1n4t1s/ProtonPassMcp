import { lstat, mkdir, open, readdir, readFile, rmdir } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { APP_ID, FILE_PATTERN, SESSION_PATTERN, regular, removeFile } from './handoff-protocol.mjs';

const execute = promisify(execFile);
const aclCode = `$ErrorActionPreference='Stop'; try {
$p=$env:PROTON_HANDOFF_ACL_PATH; $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User;
$drive=New-Object IO.DriveInfo([IO.Path]::GetPathRoot($p)); if ($drive.DriveType -ne [IO.DriveType]::Fixed) { throw 'unsafe' };
$ancestor=(New-Object IO.DirectoryInfo($p)).Parent; while ($null -ne $ancestor) { if (!$ancestor.Exists -or (($ancestor.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)) { throw 'unsafe' }; $ancestor=$ancestor.Parent };
if (![IO.Directory]::Exists($p)) { $a=New-Object Security.AccessControl.DirectorySecurity; $a.SetOwner($sid); $a.SetAccessRuleProtection($true,$false); $r=New-Object Security.AccessControl.FileSystemAccessRule($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow'); $a.AddAccessRule($r); (New-Object IO.DirectoryInfo($p)).Create($a) }
$d=New-Object IO.DirectoryInfo($p); if (($d.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'unsafe' }; $a=$d.GetAccessControl();
$rules=@($a.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]));
if (!$a.AreAccessRulesProtected -or $a.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid.Value -or $rules.Count -eq 0) { throw 'unsafe' };
foreach ($r in $rules) { if ($r.IdentityReference.Value -ne $sid.Value -or $r.AccessControlType -ne 'Allow' -or $r.FileSystemRights -ne [Security.AccessControl.FileSystemRights]::FullControl -or $r.InheritanceFlags -ne ([Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [Security.AccessControl.InheritanceFlags]::ObjectInherit) -or $r.PropagationFlags -ne [Security.AccessControl.PropagationFlags]::None) { throw 'unsafe' } }; [Console]::Out.Write('OK')
} catch { exit 1 }`;
export function minimalEnvironment() {
  const env = {};
  for (const key of ['SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'HOME', 'USERPROFILE']) if (process.env[key]) env[key] = process.env[key];
  return env;
}
export async function checkAncestors(directory) {
  if (typeof directory !== 'string' || !path.isAbsolute(directory) || path.normalize(directory) !== directory || directory.startsWith('\\\\') || directory.startsWith('//') || directory === path.parse(directory).root) throw new Error('unsafe');
  let current = path.dirname(directory);
  for (;;) {
    const stat = await lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('unsafe');
    if (current === path.parse(current).root) break;
    current = path.dirname(current);
  }
}
export async function protectDirectory(directory, signal) {
  await checkAncestors(directory);
  if (process.platform === 'win32') {
    const systemRoot = process.env.SystemRoot;
    if (!systemRoot || !/^[A-Za-z]:\\Windows$/i.test(systemRoot)) throw new Error('systemroot');
    const result = await execute(path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', aclCode], { shell: false, windowsHide: true, timeout: 15000, maxBuffer: 4096, signal, env: { ...minimalEnvironment(), PROTON_HANDOFF_ACL_PATH: directory } });
    if (result.stdout !== 'OK') throw new Error('acl');
  } else {
    try { await mkdir(directory, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  const stat = await lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (process.platform !== 'win32' && (stat.uid !== process.getuid() || (stat.mode & 0o777) !== 0o700))) throw new Error('unsafe');
}
export async function writePrivate(file, value) {
  const handle = await open(file, 'wx', 0o600);
  try {
    const stat = await handle.stat();
    if (!regular(stat) || (process.platform !== 'win32' && (stat.uid !== process.getuid() || (stat.mode & 0o777) !== 0o600))) throw new Error('unsafe');
    await handle.writeFile(value, 'utf8');
    return stat;
  } finally { await handle.close(); }
}
export async function marker(directory, data, create = true) {
  const file = path.join(directory, '.handoff-owner.json');
  if (create) {
    try { await writePrivate(file, JSON.stringify(data)); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  const stat = await lstat(file);
  if (!regular(stat)) throw new Error('marker');
  const actual = JSON.parse(await readFile(file, 'utf8'));
  if (actual.app !== APP_ID || (data.pid !== undefined && actual.pid !== data.pid)) throw new Error('marker');
  return actual;
}
export async function sweepSession(directory, all = false) {
  await checkAncestors(directory);
  const stat = await lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || !SESSION_PATTERN.test(path.basename(directory))) throw new Error('session');
  let failed = false;
  for (const name of await readdir(directory)) {
    const match = FILE_PATTERN.exec(name);
    if (match && (all || Number(match[1]) <= Date.now())) {
      try { await removeFile(path.join(directory, name)); } catch { failed = true; }
    }
  }
  if (failed) throw new Error('cleanup');
}
export async function sweepOldSessions(root) {
  for (const name of await readdir(root)) {
    if (!SESSION_PATTERN.test(name)) continue;
    const directory = path.join(root, name);
    await protectDirectory(directory);
    const data = await marker(directory, { app: APP_ID }, false);
    let alive = true;
    if (!Number.isInteger(data.pid) || data.pid <= 0) throw new Error('marker');
    try { process.kill(data.pid, 0); } catch (error) { if (error.code === 'ESRCH') alive = false; }
    await sweepSession(directory, !alive);
    if (!alive && (await readdir(directory)).every(name => name === '.handoff-owner.json')) {
      await removeFile(path.join(directory, '.handoff-owner.json'));
      await rmdir(directory);
    }
  }
}
