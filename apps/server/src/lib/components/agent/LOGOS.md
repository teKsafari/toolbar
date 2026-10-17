# Agent logos

`agent-logos.ts` inlines one SVG path per product so the capture page can show which agent wrote a comment for a person (D-208). Nothing is fetched at run time and no icon package is a dependency. The paths were copied once, on 2026-10-17.

| Key | Used for | Source | Licence of the drawing | Colour |
| --- | --- | --- | --- | --- |
| `claude` | Claude Code, Claude | Simple Icons 16.35.0, slug `claude` (source listed: claude.ai) | CC0 1.0 (Simple Icons) | `#D97757` |
| `openai` | Codex | Simple Icons 13.21.0, slug `openai` (source listed: openai.com/brand). Simple Icons removed it in v16 (simple-icons#13944) because OpenAI's permission was not obtained. | CC0 1.0 (Simple Icons 13.21.0) | black, drawn monochrome |
| `opencode` | opencode | Simple Icons 16.35.0, slug `opencode` (source listed: the `packages/identity/mark.svg` file in the opencode repository) | CC0 1.0 (Simple Icons) | black, drawn monochrome |
| `cursor` | Cursor | Simple Icons 16.35.0, slug `cursor` (source listed: cursor.com/brand) | CC0 1.0 (Simple Icons) | black, drawn monochrome |
| `vscode` | VS Code | Microsoft's Codicons, `src/icons/vscode.svg` in github.com/microsoft/vscode-codicons (Simple Icons dropped `visualstudiocode`) | CC BY 4.0, (c) Microsoft Corporation | `#007ACC` |
| `gemini` | Gemini CLI | Simple Icons 16.35.0, slug `googlegemini` (source listed: gemini.google.com) | CC0 1.0 (Simple Icons) | `#8E75B2` |
| `windsurf` | Windsurf (and Codeium) | Simple Icons 16.35.0, slug `windsurf` (guidelines: windsurf.com/brand) | CC0 1.0 (Simple Icons) | `#0B100F`, drawn monochrome |

## Trademarks

Each mark is a trademark of its owner: Claude of Anthropic PBC, OpenAI and Codex of OpenAI, opencode of its maintainers, Cursor of Anysphere, Visual Studio Code of Microsoft, Gemini of Google LLC, Windsurf of its owner. A CC0 or CC BY drawing grants no trademark rights. open-toolbar shows a mark only to name the product a person used to write a comment (nominative use), at its own proportions, without recolouring beyond the brand colour or a single monochrome ink, and without implying endorsement. Simple Icons dropped the OpenAI mark for want of OpenAI's permission, so read openai.com/brand before a public release; if OpenAI objects, drop `openai` from `KNOWN` in `agent-name.ts` and Codex falls back to the monogram.

CC BY 4.0 for the Codicons drawing needs attribution: this file is it.

## Colours

The tile is white in light (`#ffffff`) and `#1f1f1f` in dark, with a 1 px ring in `--nb-border`. A logo keeps its brand colour where that holds 3:1 against the tile (WCAG 1.4.11), else it takes the monochrome ink (`#111827` light, `#e6e6e6` dark). `logoColors` in `agent-name.ts` makes that choice and `apps/server/test/agent-name.test.ts` checks it.

## Updating

Copy the `d` attribute of the new SVG into `agent-logos.ts`, set `box` to its viewBox side, and update this table.
