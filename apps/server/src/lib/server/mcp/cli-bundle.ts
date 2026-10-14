// The CLI bundle (packages/cli/dist/nib.mjs) the server hands out at /cli/nib.mjs, with install
// scripts at /cli/install.sh and /cli/install.ps1 (J-155). Looked up at runtime: CLI_BUNDLE_PATH,
// the repo checkout (dev), or ./cli/nib.mjs next to server.js (container).
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

function candidates(): string[] {
  const c = [resolve(process.cwd(), '../../packages/cli/dist/nib.mjs'), resolve(process.cwd(), 'cli/nib.mjs'), resolve(process.cwd(), 'packages/cli/dist/nib.mjs')];
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
# Installs the nib CLI from ${server} into ~/.local/bin (needs Node.js 24 or newer).
set -eu
command -v node >/dev/null 2>&1 || { echo "nib needs Node.js 24 or newer: https://nodejs.org" >&2; exit 1; }
major=$(node -p 'process.versions.node.split(".")[0]')
[ "$major" -ge 24 ] || { echo "nib needs Node.js 24 or newer (found $(node -v))" >&2; exit 1; }
dir="\${NIB_INSTALL_DIR:-$HOME/.local/bin}"
mkdir -p "$dir"
curl -fsSL "${server}/cli/nib.mjs" -o "$dir/nib"
chmod +x "$dir/nib"
echo "Installed $dir/nib"
case ":$PATH:" in *":$dir:"*) ;; *) echo "Add $dir to your PATH to run nib." ;; esac
echo "Next: nib login --server ${server}"
`;
}

export function installPs1(server: string): string {
  return `# Installs the nib CLI from ${server} (needs Node.js 24 or newer).
$ErrorActionPreference = 'Stop'
$dir = Join-Path $env:LOCALAPPDATA 'nib'
New-Item -ItemType Directory -Force -Path $dir | Out-Null
Invoke-WebRequest -UseBasicParsing '${server}/cli/nib.mjs' -OutFile (Join-Path $dir 'nib.mjs')
Set-Content -Path (Join-Path $dir 'nib.cmd') -Value '@node "%~dp0nib.mjs" %*'
$path = [Environment]::GetEnvironmentVariable('Path', 'User')
if (-not ($path -split ';' | Where-Object { $_ -eq $dir })) { [Environment]::SetEnvironmentVariable('Path', "$path;$dir", 'User') }
Write-Host "Installed $dir\\nib.cmd. Open a new terminal, then: nib login --server ${server}"
`;
}
