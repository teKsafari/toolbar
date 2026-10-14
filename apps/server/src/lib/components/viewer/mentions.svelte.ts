// Text being written with @mentions (J-135). The field shows "@Name"; on send the picked names
// become `@[Name](user:<id>)`, the form the server and the renderer understand.
const MENTION = /@\[([^\]]{1,80})\]\(user:([0-9a-f-]{36})\)/g;

export class MentionDraft {
  text = $state('');
  picked = new Map<string, string>();

  constructor(markdown = '') {
    this.load(markdown);
  }

  load(markdown: string) {
    this.picked.clear();
    this.text = markdown.replace(MENTION, (_, name: string, id: string) => {
      this.picked.set(name, id);
      return `@${name}`;
    });
  }

  pick(name: string, id: string) {
    this.picked.set(name, id);
  }

  toMarkdown(): string {
    const names = [...this.picked.keys()].sort((a, b) => b.length - a.length);
    let out = this.text;
    names.forEach((name, i) => {
      out = out.split(`@${name}`).join(`\u0000${i}\u0000`);
    });
    return out.replace(/\u0000(\d+)\u0000/g, (_, i: string) => {
      const name = names[Number(i)]!;
      return `@[${name}](user:${this.picked.get(name)})`;
    });
  }

  mentionIds(): string[] {
    return [...new Set([...this.toMarkdown().matchAll(MENTION)].map((m) => m[2]!))];
  }

  clear() {
    this.text = '';
    this.picked.clear();
  }
}
