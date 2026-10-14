// Icons the capture page needs beyond packages/ui/src/icons.ts. Same grid and stroke rules:
// 24x24, round 1.75 px strokes, drawn for this project. Merge into the shared set later if
// another area wants them.

export const viewerIcons = {
  'skip-back': ['<path d="M11 7.5 6.5 12l4.5 4.5"/>', '<path d="M17.5 7.5 13 12l4.5 4.5"/>'],
  'skip-forward': ['<path d="m13 7.5 4.5 4.5-4.5 4.5"/>', '<path d="M6.5 7.5 11 12l-4.5 4.5"/>'],
  volume: ['<path d="M4.5 9.5h3l4-3.5v12l-4-3.5h-3z"/>', '<path d="M15 9.5a3.5 3.5 0 0 1 0 5M17.5 7a7 7 0 0 1 0 10"/>'],
  'volume-off': ['<path d="M4.5 9.5h3l4-3.5v12l-4-3.5h-3z"/>', '<path d="m15.5 9.5 5 5M20.5 9.5l-5 5"/>'],
  fullscreen: ['<path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15"/>'],
  download: ['<path d="M12 4v11"/>', '<path d="m7.5 10.5 4.5 4.5 4.5-4.5"/>', '<path d="M5 19.5h14"/>'],
  share: ['<path d="M12 15V4"/>', '<path d="M8 7.5 12 4l4 3.5"/>', '<path d="M7 11H5.5v8.5h13V11H17"/>'],
  'chevron-down': ['<path d="m6.5 9.5 5.5 5.5 5.5-5.5"/>'],
  'chevron-right': ['<path d="m9.5 6.5 5.5 5.5-5.5 5.5"/>'],
  'chevron-left': ['<path d="M14.5 6.5 9 12l5.5 5.5"/>'],
  'chevron-up': ['<path d="m6.5 14.5 5.5-5.5 5.5 5.5"/>'],
  smile: ['<circle cx="12" cy="12" r="8.25"/>', '<path d="M8.75 14a4 4 0 0 0 6.5 0"/>', '<path d="M9.25 9.75h.01M14.75 9.75h.01" stroke-width="2.5"/>'],
  paperclip: ['<path d="m19 11.5-6.9 6.9a4.6 4.6 0 0 1-6.5-6.5l7.4-7.4a3 3 0 0 1 4.3 4.3l-7.3 7.3a1.5 1.5 0 0 1-2.1-2.1l6.6-6.6"/>'],
  send: ['<path d="M4.5 12 19.5 4.5 15 19.5l-3-6z"/>', '<path d="m12 13.5 7.5-9"/>'],
  'panel-right': ['<rect x="3.5" y="4.5" width="17" height="15" rx="2"/>', '<path d="M14.5 4.5v15"/>'],
  'panel-left': ['<rect x="3.5" y="4.5" width="17" height="15" rx="2"/>', '<path d="M9.5 4.5v15"/>'],
  move: ['<path d="M4 7.5a1.5 1.5 0 0 1 1.5-1.5h4l2 2h7a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z"/>', '<path d="M10 13h5.5M13.5 11l2 2-2 2"/>'],
  edit: ['<path d="M15.5 5 19 8.5 9 18.5H5.5V15z"/>', '<path d="m13 7.5 3.5 3.5"/>'],
  resolve: ['<circle cx="12" cy="12" r="8.25"/>', '<path d="m8.5 12.25 2.5 2.5 4.5-5"/>'],
  reply: ['<path d="M9.5 8 5 12.5 9.5 17"/>', '<path d="M5 12.5h9a5 5 0 0 1 5 5V19"/>'],
  shield: ['<path d="M12 3.5 5 6v5.5c0 4.25 3 7.5 7 9 4-1.5 7-4.75 7-9V6z"/>', '<path d="m9.25 12 2 2 3.5-3.75"/>'],
  globe: ['<circle cx="12" cy="12" r="8.25"/>', '<path d="M3.75 12h16.5M12 3.75c2.25 2.25 3.25 5 3.25 8.25S14.25 18 12 20.25C9.75 18 8.75 15.25 8.75 12S9.75 6 12 3.75z"/>'],
  lock: ['<rect x="5.5" y="10.5" width="13" height="9.5" rx="2"/>', '<path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>'],
  clock: ['<circle cx="12" cy="12" r="8.25"/>', '<path d="M12 7.5V12l3 2"/>'],
  captions: ['<rect x="3.5" y="5.5" width="17" height="13" rx="2"/>', '<path d="M10.5 10.5a2 2 0 1 0 0 3M16.5 10.5a2 2 0 1 0 0 3"/>'],
  speed: ['<path d="M5 17a8 8 0 1 1 14 0"/>', '<path d="m12 13 3.5-4"/>'],
  layers: ['<path d="m12 4 8.5 4.5L12 13 3.5 8.5z"/>', '<path d="m3.5 12.5 8.5 4.5 8.5-4.5"/>'],
  figma: ['<rect x="7.5" y="3.5" width="9" height="5.75" rx="2.875"/>', '<path d="M12 9.25v5.75H10.4a2.875 2.875 0 1 1 0-5.75z"/>', '<circle cx="14.6" cy="12.125" r="2.875"/>', '<path d="M12 15v2.6a2.875 2.875 0 1 1-2.875-2.6z"/>'],
  agent: ['<rect x="5" y="8" width="14" height="11" rx="3"/>', '<path d="M12 4.5V8M9.5 13h.01M14.5 13h.01" stroke-width="2.25"/>', '<path d="M3 13v2M21 13v2"/>'],
  pointer: ['<path d="M6 3.5 18 12l-5.25 1.25L10 18.5z" fill="currentColor"/>'],
  expand: ['<path d="M9 4.5H4.5V9M15 4.5h4.5V9M19.5 15v4.5H15M9 19.5H4.5V15"/>'],
  filter: ['<path d="M4.5 6h15l-5.5 6.5V18l-4 1.5v-7z"/>'],
  menu: ['<path d="M4.5 7h15M4.5 12h15M4.5 17h15"/>'],
  bubble: ['<path d="M5 5.5h14a1.5 1.5 0 0 1 1.5 1.5v8.5a1.5 1.5 0 0 1-1.5 1.5H10l-4.5 3.5V17H5a1.5 1.5 0 0 1-1.5-1.5V7A1.5 1.5 0 0 1 5 5.5z" fill="currentColor"/>'],
} as const;

export type ViewerIconName = keyof typeof viewerIcons;

/**
 * Glyphs for the eight reaction keys (D-029: stored by key, drawn by us, no emoji characters).
 * Each glyph has a fill colour and SVG children on a 24x24 grid.
 */
export const reactionGlyphs = {
  'thumbs-up': { label: 'Thumbs up', color: '#e0a100', svg: ['<path d="M8 10.5v9H5a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1z" fill="currentColor"/>', '<path d="M8 10.5 11.5 4c1.4 0 2.5 1.1 2.5 2.5V9.5h4.25a1.75 1.75 0 0 1 1.7 2.2l-1.75 6.5a1.75 1.75 0 0 1-1.7 1.3H8z" fill="currentColor"/>'] },
  'thumbs-down': { label: 'Thumbs down', color: '#8a8478', svg: ['<g transform="rotate(180 12 12)"><path d="M8 10.5v9H5a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1z" fill="currentColor"/><path d="M8 10.5 11.5 4c1.4 0 2.5 1.1 2.5 2.5V9.5h4.25a1.75 1.75 0 0 1 1.7 2.2l-1.75 6.5a1.75 1.75 0 0 1-1.7 1.3H8z" fill="currentColor"/></g>'] },
  heart: { label: 'Heart', color: '#e0402f', svg: ['<path d="M12 19.5s-7.5-4.4-7.5-9.75A4.25 4.25 0 0 1 12 7.25a4.25 4.25 0 0 1 7.5 2.5c0 5.35-7.5 9.75-7.5 9.75z" fill="currentColor"/>'] },
  laugh: { label: 'Laugh', color: '#e0a100', svg: ['<circle cx="12" cy="12" r="8.5" fill="currentColor"/>', '<path d="M7.75 12.75h8.5a4.25 4.25 0 0 1-8.5 0z" fill="#fff" stroke="#fff" stroke-width="0.5"/>', '<path d="m8 9 2 1-2 1M16 9l-2 1 2 1" stroke="#fff" stroke-width="1.5"/>'] },
  party: { label: 'Celebrate', color: '#7a4fd6', svg: ['<path d="M4 20 8.5 8.5l7 7z" fill="currentColor"/>', '<path d="M14 4.5v2M18.5 6l-1.5 1.5M19.5 10.5h-2M12 8.5l1-1" stroke="currentColor"/>'] },
  eyes: { label: 'Looking', color: '#3446cf', svg: ['<ellipse cx="8.5" cy="12" rx="3.5" ry="5" fill="#fff" stroke="currentColor"/>', '<ellipse cx="15.5" cy="12" rx="3.5" ry="5" fill="#fff" stroke="currentColor"/>', '<circle cx="9.5" cy="13" r="1.75" fill="currentColor"/>', '<circle cx="16.5" cy="13" r="1.75" fill="currentColor"/>'] },
  check: { label: 'Done', color: '#1b7d51', svg: ['<circle cx="12" cy="12" r="8.5" fill="currentColor"/>', '<path d="m8.25 12.25 2.5 2.5 5-5.25" stroke="#fff" stroke-width="2"/>'] },
  question: { label: 'Question', color: '#1676a8', svg: ['<circle cx="12" cy="12" r="8.5" fill="currentColor"/>', '<path d="M9.75 9.5a2.25 2.25 0 1 1 3.25 2c-.75.4-1 .9-1 1.75" stroke="#fff" stroke-width="1.75"/>', '<path d="M12 16.25h.01" stroke="#fff" stroke-width="2.5"/>'] },
} as const;
