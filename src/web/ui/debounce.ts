// Runs `action` once, `delay` ms after the last schedule(); flush() runs a
// pending call immediately (used on "change", when editing is finished).
export function debounce(action: () => void, delay: number): { schedule(): void; flush(): void; cancel(): void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const cancel = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  return {
    schedule() {
      cancel();
      timer = setTimeout(() => {
        timer = null;
        action();
      }, delay);
    },
    flush() {
      if (timer === null) return;
      cancel();
      action();
    },
    cancel,
  };
}
