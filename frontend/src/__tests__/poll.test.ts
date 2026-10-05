import { afterEach, describe, expect, it, vi } from 'vitest';
import { poll } from '../utils/poll';

const setOnline = (v: boolean) => Object.defineProperty(navigator, 'onLine', { value: v, configurable: true });

describe('poll', () => {
  afterEach(() => {
    vi.useRealTimers();
    setOnline(true);
  });

  it('never overlaps a slow call, and waits while offline', async () => {
    vi.useFakeTimers();
    let release!: () => void;
    const fn = vi.fn(() => new Promise<void>((r) => (release = r)));
    const stop = poll(fn, 1000);
    expect(fn).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5000); // still in flight: no pile-up
    expect(fn).toHaveBeenCalledTimes(1);

    release();
    await vi.advanceTimersByTimeAsync(1000);
    expect(fn).toHaveBeenCalledTimes(2);

    setOnline(false);
    release();
    await vi.advanceTimersByTimeAsync(5000);
    expect(fn).toHaveBeenCalledTimes(2);

    setOnline(true);
    window.dispatchEvent(new Event('online'));
    expect(fn).toHaveBeenCalledTimes(3);
    stop();
  });
});
