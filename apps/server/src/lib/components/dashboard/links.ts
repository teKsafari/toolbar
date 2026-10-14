// Links the help menu (J-170) and empty states point at. No chat launcher, no pricing (skip list).
export const REPO_URL = 'https://github.com/Heracraft/toolbar';
export const HELP_LINKS = {
  docs: `${REPO_URL}/tree/main/docs`,
  repo: REPO_URL,
  issues: `${REPO_URL}/issues`,
  install: '/settings/browsers',
} as const;
