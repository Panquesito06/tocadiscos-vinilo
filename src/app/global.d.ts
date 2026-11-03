import type { AppState } from '../core/types';

declare global {
  interface Window {
    /** Ganchos para pruebas end-to-end; los define `startApp`. */
    __tocadiscos?: {
      audioState(): string | null;
      positionSec(): number;
      state(): AppState;
      flush(): Promise<void>;
    };
  }
}

export {};
