/**
 * The environment a test passes to Chromium. Playwright writes a launch's `env` into the trace,
 * and the configs keep traces of failed tests, so `{ ...process.env }` put every secret the
 * runner had (API keys, tokens) into trace.zip. Only names on this list reach the browser.
 */
const KEEP = [
  'PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'LC_ALL', 'TZ', 'TZDIR', 'TMPDIR',
  'LOCALE_ARCHIVE', 'LD_LIBRARY_PATH', 'NIX_LD', 'NIX_LD_LIBRARY_PATH',
  'XDG_RUNTIME_DIR', 'XDG_DATA_DIRS', 'XDG_CONFIG_DIRS', 'XCURSOR_PATH',
  'FONTCONFIG_FILE', 'FONTCONFIG_PATH', 'GTK_PATH', 'NO_AT_BRIDGE', 'PULSE_SERVER',
];

export function browserEnv(display: string): Record<string, string> {
  const env: Record<string, string> = { DISPLAY: display };
  for (const name of KEEP) {
    const v = process.env[name];
    if (v !== undefined) env[name] = v;
  }
  return env;
}
