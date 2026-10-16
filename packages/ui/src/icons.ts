// open-toolbar's icon set, drawn for this project: 24x24 grid, 2 px round strokes (D-175), no fills
// unless noted. Each icon is a list of SVG child elements as markup strings.

export const icons = {
  /** Product mark (D-083): a filled rectangle in the text colour. */
  logo: ['<rect x="2" y="7" width="20" height="10" fill="currentColor" stroke="none"/>'],
  screenshot: [
    '<path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2"/>',
    '<circle cx="12" cy="12" r="3"/>',
  ],
  record: ['<circle cx="12" cy="12" r="8.25"/>', '<circle cx="12" cy="12" r="3.5" fill="currentColor" stroke="none"/>'],
  replay: [
    '<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/>',
    '<path d="M4.5 4.5v3.75h3.75"/>',
    '<path d="M12 8.25V12l2.5 1.75"/>',
  ],
  link: [
    '<path d="M10 14a3.5 3.5 0 0 0 5 0l3-3a3.54 3.54 0 0 0-5-5l-1 1"/>',
    '<path d="M14 10a3.5 3.5 0 0 0-5 0l-3 3a3.54 3.54 0 0 0 5 5l1-1"/>',
  ],
  mic: [
    '<rect x="9" y="3" width="6" height="11" rx="3"/>',
    '<path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>',
  ],
  'mic-off': [
    '<path d="M15 9.5V6a3 3 0 0 0-5.6-1.5M9 9v2a3 3 0 0 0 4.6 2.5"/>',
    '<path d="M5.5 11a6.5 6.5 0 0 0 10.7 5M18.5 11a6.4 6.4 0 0 1-.4 2.2M12 17.5V21"/>',
    '<path d="m4 4 16 16"/>',
  ],
  monitor: ['<rect x="3" y="4.5" width="18" height="12" rx="2"/>', '<path d="M9 20.5h6M12 16.5v4"/>'],
  tab: ['<rect x="3" y="5" width="18" height="14" rx="2"/>', '<path d="M3 9h18M7 5v4"/>'],
  stop: ['<rect x="6.5" y="6.5" width="11" height="11" rx="2" fill="currentColor" stroke="none"/>'],
  pause: ['<path d="M9 6v12M15 6v12"/>'],
  play: ['<path d="M8 5.5v13l10-6.5z" fill="currentColor"/>'],
  select: ['<path d="M6 3.5 18 12l-5.25 1.25L10 18.5z"/>', '<path d="m13 13.5 4 5"/>'],
  pen: ['<path d="M4 20l1-4.5L15.5 5a2.1 2.1 0 0 1 3 3L8 18.5z"/>', '<path d="m13.5 7 3 3"/>'],
  rect: ['<rect x="4" y="5.5" width="16" height="13" rx="1.5"/>'],
  ellipse: ['<ellipse cx="12" cy="12" rx="8.5" ry="6.5"/>'],
  arrow: ['<path d="M5 19 19 5M10 5h9v9"/>'],
  line: ['<path d="M5 19 19 5"/>'],
  text: ['<path d="M5.5 6.5V5h13v1.5M12 5v14M9.5 19h5"/>'],
  blur: [
    '<circle cx="7" cy="7" r="1.25" fill="currentColor" stroke="none"/>',
    '<circle cx="12" cy="7" r="1.6" fill="currentColor" stroke="none"/>',
    '<circle cx="17" cy="7" r="1.25" fill="currentColor" stroke="none"/>',
    '<circle cx="7" cy="12" r="1.6" fill="currentColor" stroke="none"/>',
    '<circle cx="12" cy="12" r="2" fill="currentColor" stroke="none"/>',
    '<circle cx="17" cy="12" r="1.6" fill="currentColor" stroke="none"/>',
    '<circle cx="7" cy="17" r="1.25" fill="currentColor" stroke="none"/>',
    '<circle cx="12" cy="17" r="1.6" fill="currentColor" stroke="none"/>',
    '<circle cx="17" cy="17" r="1.25" fill="currentColor" stroke="none"/>',
  ],
  crop: ['<path d="M7 3v14h14"/>', '<path d="M3 7h14v14"/>'],
  undo: ['<path d="M9 14 4.5 9.5 9 5"/>', '<path d="M4.5 9.5H14a5.5 5.5 0 0 1 0 11h-3"/>'],
  redo: ['<path d="m15 14 4.5-4.5L15 5"/>', '<path d="M19.5 9.5H10a5.5 5.5 0 0 0 0 11h3"/>'],
  close: ['<path d="M6 6l12 12M18 6 6 18"/>'],
  check: ['<path d="m5 12.5 4.5 4.5L19 7.5"/>'],
  'chevron-down': ['<path d="m6.5 9.5 5.5 5.5 5.5-5.5"/>'],
  'chevron-right': ['<path d="m9.5 6.5 5.5 5.5-5.5 5.5"/>'],
  'arrow-left': ['<path d="M19 12H5M11 6l-6 6 6 6"/>'],
  more: [
    '<circle cx="6" cy="12" r="1.4" fill="currentColor" stroke="none"/>',
    '<circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/>',
    '<circle cx="18" cy="12" r="1.4" fill="currentColor" stroke="none"/>',
  ],
  home: ['<path d="M4 10.5 12 4l8 6.5V19a1.5 1.5 0 0 1-1.5 1.5H15v-6H9v6H5.5A1.5 1.5 0 0 1 4 19z"/>'],
  copy: ['<rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2"/>', '<path d="M15.5 8.5V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7.5a2 2 0 0 0 2 2h2.5"/>'],
  folder: ['<path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>'],
  trash: ['<path d="M4.5 7h15M10 7V4.5h4V7M6.5 7l1 13h9l1-13"/>', '<path d="M10.5 11v5.5M13.5 11v5.5"/>'],
  search: ['<circle cx="10.5" cy="10.5" r="6"/>', '<path d="m15 15 5 5"/>'],
  settings: [
    '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/>',
    '<circle cx="15" cy="7" r="2"/>',
    '<circle cx="9" cy="17" r="2"/>',
  ],
  comment: ['<path d="M4.5 6a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v8.5a2 2 0 0 1-2 2H11L6.5 20v-3.5h0a2 2 0 0 1-2-2z"/>'],
  plus: ['<path d="M12 5v14M5 12h14"/>'],
  warning: ['<path d="M12 4 2.75 19.5h18.5z"/>', '<path d="M12 10v4.5"/>', '<circle cx="12" cy="17" r=".9" fill="currentColor" stroke="none"/>'],
  info: ['<circle cx="12" cy="12" r="8.5"/>', '<path d="M12 11v5.5"/>', '<circle cx="12" cy="8" r=".9" fill="currentColor" stroke="none"/>'],
  console: ['<rect x="3" y="4.5" width="18" height="15" rx="2"/>', '<path d="m7 10 3 2.5L7 15M12.5 15h4.5"/>'],
  network: ['<path d="M7 4v13M4 14l3 3 3-3M17 20V7M14 10l3-3 3 3"/>'],
  user: ['<circle cx="12" cy="8.5" r="3.75"/>', '<path d="M4.5 20a7.5 7.5 0 0 1 15 0"/>'],
  external: ['<path d="M13.5 4.5H19.5V10.5M19.5 4.5 11 13"/>', '<path d="M17 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 4 18.5v-10A1.5 1.5 0 0 1 5.5 7H10"/>'],
  spinner: ['<path d="M12 3.5a8.5 8.5 0 1 1-8.5 8.5" />'],
  timer: ['<circle cx="12" cy="13" r="7.5"/>', '<path d="M12 9v4l2.5 1.5M9.5 2.75h5"/>'],
  clock: ['<circle cx="12" cy="12" r="8.5"/>', '<path d="M12 7.5V12l3 2"/>'],
  help: ['<circle cx="12" cy="12" r="8.5"/>', '<path d="M9.75 9.5a2.4 2.4 0 0 1 4.65.75c0 1.6-2.4 2-2.4 3.5"/>', '<circle cx="12" cy="16.75" r=".9" fill="currentColor" stroke="none"/>'],
  /** Video camera: the action icon while recording (J-033). */
  camera: ['<rect x="3" y="6.5" width="12.5" height="11" rx="2"/>', '<path d="m15.5 10.5 5-3v9l-5-3z"/>'],
  globe: ['<circle cx="12" cy="12" r="8.5"/>', '<path d="M3.5 12h17M12 3.5c2.3 2.4 3.4 5.2 3.4 8.5s-1.1 6.1-3.4 8.5c-2.3-2.4-3.4-5.2-3.4-8.5S9.7 5.9 12 3.5z"/>'],
  eye: ['<path d="M2.75 12S6 5.75 12 5.75 21.25 12 21.25 12 18 18.25 12 18.25 2.75 12 2.75 12z"/>', '<circle cx="12" cy="12" r="2.75"/>'],
  power: ['<path d="M12 3.5V11"/>', '<path d="M7.2 6.3a7.5 7.5 0 1 0 9.6 0"/>'],
  logout: ['<path d="M14 4.5h3.5a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H14"/>', '<path d="M10 16.5 5.5 12 10 7.5M5.5 12h10"/>'],
  keyboard: ['<rect x="2.75" y="6" width="18.5" height="12" rx="2"/>', '<path d="M6.5 10h.01M10 10h.01M14 10h.01M17.5 10h.01M8 14h8"/>'],
  book: ['<path d="M5 4.5h9.5a3 3 0 0 1 3 3v12h-10A2.5 2.5 0 0 1 5 17z"/>', '<path d="M5 17a2.5 2.5 0 0 1 2.5-2.5h10"/>'],
  bug: ['<rect x="7.5" y="8" width="9" height="11.5" rx="4.5"/>', '<path d="M9.5 8a2.5 2.5 0 0 1 5 0M12 12v7.5M3.5 13h4M16.5 13h4M4.5 8.5l3 1.5M19.5 8.5l-3 1.5M4.5 18.5l3-1.5M19.5 18.5l-3-1.5"/>'],
  grip: ['<circle cx="9" cy="7" r="1.2" fill="currentColor" stroke="none"/>', '<circle cx="15" cy="7" r="1.2" fill="currentColor" stroke="none"/>', '<circle cx="9" cy="12" r="1.2" fill="currentColor" stroke="none"/>', '<circle cx="15" cy="12" r="1.2" fill="currentColor" stroke="none"/>', '<circle cx="9" cy="17" r="1.2" fill="currentColor" stroke="none"/>', '<circle cx="15" cy="17" r="1.2" fill="currentColor" stroke="none"/>'],
  'mic-denied': ['<rect x="9" y="3" width="6" height="11" rx="3"/>', '<path d="M5.5 11a6.5 6.5 0 0 0 9 6M12 17.5V21"/>', '<path d="M17 15.5l4 4M21 15.5l-4 4"/>'],
  // reviewer toolbar (Part 2)
  list: ['<path d="M9 6.5h11M9 12h11M9 17.5h11"/>', '<circle cx="4.5" cy="6.5" r="1" fill="currentColor" stroke="none"/>', '<circle cx="4.5" cy="12" r="1" fill="currentColor" stroke="none"/>', '<circle cx="4.5" cy="17.5" r="1" fill="currentColor" stroke="none"/>'],
  send: ['<path d="M4 11.5 20 4l-6.5 16-2.5-6.5z"/>', '<path d="m11 13.5 9-9.5"/>'],
  'eye-off': ['<path d="M9.9 6a9.6 9.6 0 0 1 2.1-.25C18 5.75 21.25 12 21.25 12a16 16 0 0 1-2.6 3.4M6.4 7.4A15.5 15.5 0 0 0 2.75 12S6 18.25 12 18.25a9.3 9.3 0 0 0 4.4-1.1"/>', '<path d="M10.1 10.1a2.75 2.75 0 0 0 3.8 3.8M4 4l16 16"/>'],
  freehand: ['<path d="M3.5 16.5c2-4.5 4-7 5.5-7s1 4.5 3 4.5 3-6.5 5-6.5 2.5 3 3.5 4.5"/>'],
  pin: ['<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/>', '<circle cx="12" cy="10" r="2.25"/>'],
  trace: ['<circle cx="5" cy="17" r="2"/>', '<circle cx="12" cy="7" r="2"/>', '<circle cx="19" cy="14" r="2"/>', '<path d="m6.2 15.3 4.6-6.6M13.6 8.4l4 4.2"/>'],
} as const satisfies Record<string, readonly string[]>;

export type IconName = keyof typeof icons;
export const iconNames = Object.keys(icons) as IconName[];

/** Standalone SVG markup, for places that are not Svelte (extension action icon, favicons). */
export function iconSvg(name: IconName, { size = 24, color = 'currentColor', stroke = 2 } = {}): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" ` +
    `stroke="${color}" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round">${icons[name].join('')}</svg>`
  );
}
