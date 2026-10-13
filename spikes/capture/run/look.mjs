// Opens the lab and screenshots :100 so the action icon position can be read.
import { launch, shot, sleep } from './launch.mjs';
const { context } = await launch({ dpr: Number(process.env.DPR ?? 1) });
const page = context.pages()[0] ?? (await context.newPage());
await page.goto('http://localhost:5173/');
await sleep(1500);
console.log(shot(`look-dpr${process.env.DPR ?? 1}.png`));
await context.close();
