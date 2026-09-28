import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { debounce } from "../src/web/ui/debounce";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("debounce", () => {
  it("runs once after a burst of calls settles", () => {
    const action = vi.fn();
    const debounced = debounce(action, 300);
    for (let i = 0; i < 5; i++) {
      debounced.schedule();
      vi.advanceTimersByTime(100);
    }
    expect(action).not.toHaveBeenCalled();
    vi.advanceTimersByTime(300);
    expect(action).toHaveBeenCalledTimes(1);
  });

  it("flush runs a pending call immediately, once, and does nothing when idle", () => {
    const action = vi.fn();
    const debounced = debounce(action, 300);
    debounced.flush();
    expect(action).not.toHaveBeenCalled();
    debounced.schedule();
    debounced.flush();
    expect(action).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    expect(action).toHaveBeenCalledTimes(1);
  });

  it("cancel drops a pending call", () => {
    const action = vi.fn();
    const debounced = debounce(action, 300);
    debounced.schedule();
    debounced.cancel();
    vi.advanceTimersByTime(1000);
    expect(action).not.toHaveBeenCalled();
  });
});
