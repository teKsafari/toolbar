# Transcription test clips

Two read-speech clips from **FLEURS** (Few-shot Learning Evaluation of Universal Representations of Speech), used by the transcription tests in `apps/server/test/transcribe*.test.ts`.

- Dataset: `google/fleurs`, https://huggingface.co/datasets/google/fleurs
- Paper: Alexis Conneau, Min Ma, Simran Khanuja, Yu Zhang, Vera Axelrod, Siddharth Dalmia, Jason Riesa, Clara Rivera, Ankur Bapna. "FLEURS: Few-shot Learning Evaluation of Universal Representations of Speech." IEEE SLT 2022. https://arxiv.org/abs/2205.12446
- License: Creative Commons Attribution 4.0 International (CC BY 4.0), https://creativecommons.org/licenses/by/4.0/

Changes: each clip was re-encoded from the dataset's 16 kHz WAV to WebM/Opus, 48 kHz mono at 32 kbps, the format the browser extension records. Nothing else was changed.

| File | FLEURS config, split, id | Source file | Length | Size |
|---|---|---|---|---|
| `fleurs-sw_ke-1999.webm` | `sw_ke` (Kenyan Swahili), test, 1999 | `10013269209685538610.wav` | 18.0 s | 70 KB |
| `fleurs-en_us-1904.webm` | `en_us`, test, 1904 | `1003119935936341070.wav` | 10.6 s | 41 KB |

Reference transcripts (from FLEURS, unchanged):

- `fleurs-sw_ke-1999.webm`: "Katika miaka yote ya 1960, Brzezinski alimfanyia kazi John F. Kennedy kama mshauri wake na pia utawala wa Lyndon B. Johnson."
- `fleurs-en_us-1904.webm`: "However, due to the slow communication channels, styles in the west could lag behind by 25 to 30 year."

The English reference says "year" where the speaker says "years"; models that write "years" are right.
