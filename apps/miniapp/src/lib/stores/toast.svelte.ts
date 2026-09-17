/**
 * ARCH §11: "The Mini App shows a toast for every non-2xx." One store, one visible toast at a
 * time; the message is already localized by the server (errors) or by `t()` (confirmations).
 */
export interface Toast {
  id: number;
  kind: 'error' | 'success';
  message: string;
}

class ToastStore {
  current = $state<Toast | null>(null);
  private counter = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;

  show(kind: Toast['kind'], message: string, durationMs = kind === 'error' ? 5000 : 2500): void {
    this.counter += 1;
    this.current = { id: this.counter, kind, message };
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.dismiss(), durationMs);
  }

  error(error: unknown): void {
    this.show('error', error instanceof Error ? error.message : String(error));
  }

  success(message: string): void {
    this.show('success', message);
  }

  dismiss(): void {
    this.current = null;
  }
}

export const toasts = new ToastStore();
