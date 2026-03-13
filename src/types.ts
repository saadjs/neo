export interface StreamCollector {
  append(text: string): void;
  getContent(): string;
  clear(): void;
}

export function createStreamCollector(): StreamCollector {
  let buffer = "";
  return {
    append(text: string) {
      buffer += text;
    },
    getContent() {
      return buffer;
    },
    clear() {
      buffer = "";
    },
  };
}
