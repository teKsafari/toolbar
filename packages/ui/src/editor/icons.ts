// Extra line icons the editor needs, drawn on the same 24 px grid as ../icons.ts.
// The merge step may move them into the shared set.
import { icons } from '../icons.ts';

export const editorIcons = {
  paperclip: ['<path d="M19 11.5 12.1 18.4a4.5 4.5 0 0 1-6.4-6.4l7.2-7.2a3 3 0 0 1 4.25 4.25l-7.1 7.1a1.5 1.5 0 0 1-2.1-2.1L14.5 7.5"/>'],
  chevron: ['<path d="m6.5 9.5 5.5 5.5 5.5-5.5"/>'],
  sparkle: ['<path d="M12 3.5c.6 3.9 2.6 5.9 6.5 6.5-3.9.6-5.9 2.6-6.5 6.5-.6-3.9-2.6-5.9-6.5-6.5 3.9-.6 5.9-2.6 6.5-6.5z"/>', '<path d="M18.5 15.5v4M16.5 17.5h4"/>'],
  issue: ['<circle cx="12" cy="12" r="8.25"/>', '<circle cx="12" cy="12" r="2" fill="currentColor" stroke="none"/>'],
  merge: ['<circle cx="7" cy="5.5" r="2"/>', '<circle cx="7" cy="18.5" r="2"/>', '<circle cx="17" cy="18.5" r="2"/>', '<path d="M7 7.5v9M7 9.5c0 4 10 2.5 10 7"/>'],
  hash: ['<path d="M5 9h14M5 15h14M10 4.5 8.5 19.5M15.5 4.5 14 19.5"/>'],
  plug: ['<path d="M9 3.5V8M15 3.5V8M6.5 8h11v3a5.5 5.5 0 0 1-11 0zM12 16.5v4"/>'],
  bold: ['<path d="M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z"/>'],
  'file-text': ['<path d="M6 3.5h8l4 4v13H6z"/>', '<path d="M14 3.5v4h4M9 12h6M9 15.5h6"/>'],
  'save-later': ['<rect x="4" y="4" width="16" height="16" rx="2.5"/>', '<path d="M8.5 4v5h7V4M8 20v-6h8v6"/>'],
} as const;

export type EditorIconName = keyof typeof editorIcons | keyof typeof icons;

export function iconParts(name: EditorIconName): readonly string[] {
  return (editorIcons as Record<string, readonly string[]>)[name] ?? (icons as Record<string, readonly string[]>)[name] ?? [];
}
