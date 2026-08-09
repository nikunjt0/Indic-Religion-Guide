// Injectable time source so scheduling logic is deterministic under test.

export interface Clock {
  now(): number; // epoch ms
}

export const systemClock: Clock = {
  now: () => Date.now(),
};

export class FixedClock implements Clock {
  constructor(private ms: number) {}
  now(): number {
    return this.ms;
  }
  set(ms: number): void {
    this.ms = ms;
  }
  advance(deltaMs: number): void {
    this.ms += deltaMs;
  }
}
