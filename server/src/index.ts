#!/usr/bin/env node
import * as path from 'node:path';
import { createServer, parseSettings } from './app';
import { DesktopNotifier } from './core/notifier';
import { defaultDataDir, FileStore, Store } from './core/storage';
import { TimerService } from './core/timerService';

async function main(): Promise<void> {
  const settings = parseSettings(process.env.CODESPRINT_SETTINGS);
  const store = new Store(new FileStore(path.join(defaultDataDir(), 'data.json')));
  const service = new TimerService(store, () => settings, new DesktopNotifier());
  await service.initialize();
  const server = createServer(service, () => settings);
  await server.listen();
  service.dispose();
}

main().catch((e: unknown) => {
  process.stderr.write(`[codesprint] fatal: ${(e as Error).stack ?? String(e)}\n`);
  process.exit(1);
});
