import type { WinCommandHandler } from '../types';
import { magnifierController } from './magnifier-app';
import { touchKeyboardController } from './touch-keyboard-app';

export const APP_COMMANDS: Record<string, WinCommandHandler> = {
  fullscreen: (shell) => {
    shell.toggleFullscreen();
  },
  'touch-keyboard': () => {
    touchKeyboardController.open();
  },
  magnifier: () => {
    magnifierController.open();
  },
};
