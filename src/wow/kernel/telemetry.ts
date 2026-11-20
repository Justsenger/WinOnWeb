// The underlying sampler owns its timer and starts it on first subscription.
export class Telemetry<T> {
  private listeners = new Set<(value: T) => void>();
  private stop?: () => void;
  constructor(private sample: (emit: (value: T) => void) => () => void) {}
  subscribe(listener: (value: T) => void) {
    this.listeners.add(listener);
    this.stop ??= this.sample((value) => {
      for (const emit of this.listeners) emit(value);
    });
    return () => {
      this.listeners.delete(listener);
      if (!this.listeners.size) {
        this.stop?.();
        this.stop = undefined;
      }
    };
  }
}
