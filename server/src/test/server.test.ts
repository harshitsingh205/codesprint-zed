import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it } from 'node:test';
import { createServer, parseSettings } from '../app';
import { DesktopNotifier } from '../core/notifier';
import { DEFAULT_SETTINGS } from '../core/settings';
import { defaultDataDir, FileStore, Store } from '../core/storage';
import { TimerService, Notifier } from '../core/timerService';
import { FakeClock, MemoryStore, MIN } from './helpers';

const T0 = new Date(2026, 10, 4, 10, 0, 0).getTime();

function harness(settings = { ...DEFAULT_SETTINGS }) {
  const clock = new FakeClock(T0);
  const notes: Array<[string, string]> = [];
  const notifier: Notifier = { notify: (t, b) => notes.push([t, b]) };
  const kv = new MemoryStore();
  const service = new TimerService(new Store(kv), () => settings, notifier, clock);
  const out: string[] = [];
  const server = createServer(service, () => settings, clock, (l) => out.push(l));
  let id = 0;
  const rpc = async (method: string, params?: unknown) => {
    id += 1;
    await server.handleLine(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
    return JSON.parse(out[out.length - 1]);
  };
  const call = async (name: string, args: unknown = {}) => {
    const res = await rpc('tools/call', { name, arguments: args });
    return res.result as { content: { text: string }[]; isError?: boolean };
  };
  return { clock, notes, kv, service, server, out, rpc, call };
}

describe('MCP protocol', () => {
  it('negotiates the protocol version and advertises capabilities', async () => {
    const { rpc } = harness();
    const res = await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'zed', version: '1' } });
    assert.equal(res.result.protocolVersion, '2025-03-26');
    assert.deepEqual(Object.keys(res.result.capabilities).sort(), ['prompts', 'tools']);
    assert.equal(res.result.serverInfo.name, 'codesprint');
    const fallback = await rpc('initialize', { protocolVersion: '1999-01-01' });
    assert.equal(fallback.result.protocolVersion, '2025-06-18');
  });

  it('lists tools with valid schemas and prompts', async () => {
    const { rpc } = harness();
    const tools = (await rpc('tools/list')).result.tools as Array<{ name: string; inputSchema: { type: string } }>;
    assert.ok(tools.length >= 8);
    for (const t of tools) {
      assert.match(t.name, /^codesprint_[a-z_]+$/);
      assert.equal(t.inputSchema.type, 'object');
    }
    const prompts = (await rpc('prompts/list')).result.prompts as Array<{ name: string }>;
    assert.deepEqual(prompts.map((p) => p.name).sort(), ['stats', 'status']);
  });

  it('answers errors without crashing and never replies to notifications', async () => {
    const { rpc, server, out } = harness();
    assert.equal((await rpc('nope')).error.code, -32601);
    await server.handleLine('not json');
    assert.equal(JSON.parse(out[out.length - 1]).error.code, -32700);
    const before = out.length;
    await server.handleLine(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }));
    assert.equal(out.length, before);
    assert.equal((await rpc('ping')).result !== undefined, true);
  });

  it('rejects unknown tools and prompts as invalid params', async () => {
    const { rpc } = harness();
    assert.equal((await rpc('tools/call', { name: 'x' })).error.code, -32602);
    assert.equal((await rpc('prompts/get', { name: 'x' })).error.code, -32602);
  });
});

describe('timer tools', () => {
  it('runs a full focus session, records it and notifies', async () => {
    const { call, clock, notes } = harness();
    assert.match((await call('codesprint_status')).content[0].text, /Focus - Ready/);
    assert.match((await call('codesprint_start')).content[0].text, /Started\.[\s\S]*Running/);
    clock.advance(10 * MIN);
    assert.match((await call('codesprint_status')).content[0].text, /15:00/);
    clock.advance(15 * MIN);
    const done = (await call('codesprint_status')).content[0].text;
    assert.match(done, /Short break - Ready/);
    assert.match(done, /Today: 25m/);
    assert.equal(notes.length, 1);
    assert.match(notes[0][0], /focus session complete/);
    assert.match((await call('codesprint_stats')).content[0].text, /Completed sessions: 1[\s\S]*Current streak:\s+1 day\b/);
  });

  it('pause and resume preserve remaining time; reset discards without counting', async () => {
    const { call, clock } = harness();
    await call('codesprint_start');
    clock.advance(5 * MIN);
    assert.match((await call('codesprint_pause')).content[0].text, /Paused\.[\s\S]*20:00/);
    clock.advance(60 * MIN);
    assert.match((await call('codesprint_resume')).content[0].text, /Resumed\.[\s\S]*20:00/);
    await call('codesprint_reset');
    assert.match((await call('codesprint_stats')).content[0].text, /Completed sessions: 0/);
  });

  it('reports no-ops plainly and validates input in-band', async () => {
    const { call } = harness();
    assert.match((await call('codesprint_pause')).content[0].text, /Nothing to pause/);
    const bad = await call('codesprint_switch_mode', { mode: 'nap' });
    assert.equal(bad.isError, true);
    assert.match((await call('codesprint_switch_mode', { mode: 'longBreak' })).content[0].text, /Switched to Long break/);
  });

  it('only clears data when explicitly confirmed', async () => {
    const { call } = harness();
    await call('codesprint_start');
    assert.equal((await call('codesprint_clear_data', { confirm: 'yes' })).isError, true);
    assert.match((await call('codesprint_clear_data', { confirm: true })).content[0].text, /cleared/);
    assert.match((await call('codesprint_status')).content[0].text, /Ready/);
  });

  it('credits a session that ended while no server was running', async () => {
    const { call, clock, kv } = harness();
    await call('codesprint_start');
    clock.advance(3 * 60 * MIN);
    const settings = { ...DEFAULT_SETTINGS };
    const service2 = new TimerService(new Store(kv), () => settings, { notify() {} }, clock);
    await service2.initialize();
    assert.equal(service2.history().totalSessions, 1);
    const again = new TimerService(new Store(kv), () => settings, { notify() {} }, clock);
    await again.initialize(); // idempotent
    assert.equal(again.history().totalSessions, 1);
  });

  it('suppresses notifications when disabled', async () => {
    const { call, clock, notes } = harness({ ...DEFAULT_SETTINGS, notifications: false });
    await call('codesprint_start');
    clock.advance(26 * MIN);
    await call('codesprint_status');
    assert.equal(notes.length, 0);
  });
});

describe('settings, storage and notifications', () => {
  it('parses extension settings defensively', () => {
    assert.deepEqual(parseSettings(undefined), DEFAULT_SETTINGS);
    assert.deepEqual(parseSettings('{{{'), DEFAULT_SETTINGS);
    assert.deepEqual(parseSettings('42'), DEFAULT_SETTINGS);
    assert.equal(parseSettings('{"focusMinutes":50,"dailyGoalMinutes":"x"}').focusMinutes, 50);
    assert.equal(parseSettings('{"focusMinutes":50,"dailyGoalMinutes":"x"}').dailyGoalMinutes, 120);
  });

  it('FileStore persists atomically and survives a corrupt file', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-'));
    const file = path.join(dir, 'nested', 'data.json');
    const store = new FileStore(file);
    await store.update('a', { n: 1 });
    assert.deepEqual(new FileStore(file).get('a'), { n: 1 });
    assert.deepEqual(fs.readdirSync(path.dirname(file)), ['data.json']); // no stray temp files
    fs.writeFileSync(file, '{broken');
    assert.equal(new FileStore(file).get('a'), undefined);
    await store.update('b', 2);
    assert.equal(new FileStore(file).get('b'), 2);
  });

  it('resolves per-platform data directories', () => {
    assert.equal(defaultDataDir({ CODESPRINT_DATA_DIR: '/x' }, 'linux'), '/x');
    assert.equal(defaultDataDir({ HOME: '/h' }, 'darwin'), path.join('/h', 'Library', 'Application Support', 'CodeSprint'));
    assert.equal(defaultDataDir({ HOME: '/h', XDG_DATA_HOME: '/xdg' }, 'linux'), path.join('/xdg', 'codesprint'));
    assert.equal(defaultDataDir({ APPDATA: 'C:\\A' }, 'win32'), path.join('C:\\A', 'CodeSprint'));
  });

  it('builds notification commands without a shell and escapes text', () => {
    const mac = new DesktopNotifier('darwin').buildCommand('T "q"', 'b\\x');
    assert.equal(mac[0], 'osascript');
    assert.match(mac[1][1], /with title "T \\"q\\""/);
    const lin = new DesktopNotifier('linux').buildCommand('--evil', 'body');
    assert.deepEqual(lin[1].slice(-3), ['--', '--evil', 'body']);
    const win = new DesktopNotifier('win32').buildCommand('t', 'b');
    assert.deepEqual(win[2], { CS_TITLE: 't', CS_BODY: 'b' });
    assert.doesNotThrow(() => new DesktopNotifier('linux').notify('x', 'y'));
  });
});
