import type {RemotionManagerApi} from '../shared/types';

declare global {
  interface Window {
    remotionManager: RemotionManagerApi;
  }
}

export {};
