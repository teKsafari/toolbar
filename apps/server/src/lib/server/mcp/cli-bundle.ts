// The CLI bundle (packages/cli/dist/open-toolbar.mjs) the server hands out at /cli/open-toolbar.mjs, with install
// scripts at /cli/install.sh and /cli/install.ps1 (J-155). Looked up at runtime: CLI_BUNDLE_PATH,
// the repo checkout (dev), or ./cli/open-toolbar.mjs next to server.js (container).
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

function candidates(): string[] {
  const c = [resolve(process.cwd(), '../../packages/cli/dist/open-toolbar.mjs'), resolve(process.cwd(), 'cli/open-toolbar.mjs'), resolve(process.cwd(), 'packages/cli/dist/open-toolbar.mjs')];
  return process.env.CLI_BUNDLE_PATH ? [process.env.CLI_BUNDLE_PATH, ...c] : c;
}

export async function cliBundlePath(): Promise<string | null> {
  for (const p of candidates()) if ((await stat(p).catch(() => null))?.isFile()) return p;
  return null;
}

export async function cliBundleAvailable(): Promise<boolean> {
  return (await cliBundlePath()) !== null;
}

export async function cliBundle(): Promise<Buffer | null> {
  const p = await cliBundlePath();
  return p ? readFile(p) : null;
}

export function installSh(server: string): string {
  return `#!/bin/sh
# Installs the open-toolbar CLI from ${server} into ~/.local/bin (needs Node.js 24 or newer).
set -eu
command -v node >/dev/null 2>&1 || { echo "open-toolbar needs Node.js 24 or newer: https://nodejs.org" >&2; exit 1; }
major=$(node -p 'process.versions.node.split(".")[0]')
[ "$major" -ge 24 ] || { echo "open-toolbar needs Node.js 24 or newer (found $(node -v))" >&2; exit 1; }
dir="\${TOOLBAR_INSTALL_DIR:-$HOME/.local/bin}"
mkdir -p "$dir"
curl -fsSL "${server}/cli/open-toolbar.mjs" -o "$dir/open-toolbar"
chmod +x "$dir/open-toolbar"
echo "Installed $dir/open-toolbar"
case ":$PATH:" in *":$dir:"*) ;; *) echo "Add $dir to your PATH to run open-toolbar." ;; esac
echo "Next: open-toolbar login --server ${server}"
`;
}

export function installPs1(server: string): string {
  return `# Installs the open-toolbar CLI from ${server} (needs Node.js 24 or newer).
$ErrorActionPreference = 'Stop'
$dir = Join-Path $env:LOCALAPPDATA 'open-toolbar'
New-Item -ItemType Directory -Force -Path $dir | Out-Null
Invoke-WebRequest -UseBasicParsing '${server}/cli/open-toolbar.mjs' -OutFile (Join-Path $dir 'open-toolbar.mjs')
Set-Content -Path (Join-Path $dir 'open-toolbar.cmd') -Value '@node "%~dp0open-toolbar.mjs" %*'
$path = [Environment]::GetEnvironmentVariable('Path', 'User')
if (-not ($path -split ';' | Where-Object { $_ -eq $dir })) { [Environment]::SetEnvironmentVariable('Path', "$path;$dir", 'User') }
Write-Host "Installed $dir\\open-toolbar.cmd. Open a new terminal, then: open-toolbar login --server ${server}"
`;
}
