import type {ForgeConfig} from '@electron-forge/shared-types';
import {MakerSquirrel} from '@electron-forge/maker-squirrel';
import {MakerZIP} from '@electron-forge/maker-zip';
import {VitePlugin} from '@electron-forge/plugin-vite';
import path from 'node:path';

const config: ForgeConfig = {
  outDir: process.env.REMOTION_MANAGER_OUT_DIR || 'out',
  packagerConfig: {
    asar: true,
    executableName: 'RemotionProjectManager',
    download: {
      cacheRoot: path.resolve('.build-tools', 'electron-cache'),
    },
  },
  rebuildConfig: {},
  makers: [
    new MakerSquirrel({
      name: 'RemotionProjectManager',
      setupExe: 'RemotionProjectManager-Setup.exe',
    }),
    new MakerZIP({}, ['win32']),
  ],
  plugins: [
    new VitePlugin({
      build: [
        {
          entry: 'src/main/index.ts',
          config: 'vite.main.config.ts',
          target: 'main',
        },
        {
          entry: 'src/preload.ts',
          config: 'vite.preload.config.ts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.ts',
        },
      ],
    }),
  ],
};

export default config;
