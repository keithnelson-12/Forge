declare module 'eventsource' {
  class EventSource {
    constructor(url: string, options?: { headers?: Record<string, string> });
    onopen: ((event: Event) => void) | null;
    onerror: ((event: unknown) => void) | null;
    onmessage: ((event: MessageEvent) => void) | null;
    readyState: number;
    url: string;
    close(): void;
    addEventListener(type: string, listener: (event: MessageEvent) => void): void;
    removeEventListener(type: string, listener: (event: MessageEvent) => void): void;
    static readonly CONNECTING: 0;
    static readonly OPEN: 1;
    static readonly CLOSED: 2;
  }
  export default EventSource;
}
