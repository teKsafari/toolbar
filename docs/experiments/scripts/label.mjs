import fs from 'node:fs';
const [n, label, ...notes] = process.argv.slice(2);
if (!['changed', 'error', 'dead', 'stuck', 'silent'].includes(label)) throw new Error('bad label');
fs.appendFileSync('/home/dev/nuru-exp/exp2/labels.jsonl', JSON.stringify({ n: Number(n), label, notes: notes.join(' '), at: new Date().toISOString() }) + '\n');
console.log('labelled', n, label);
