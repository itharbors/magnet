import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  PluginModule,
  type ApplicationPluginRuntimeHost,
  type CredentialProfile,
  type PluginCredentialVault,
  type PluginPathRoots,
  type PluginRuntimeHost,
} from '../src/index.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
});

function temporaryDirectory(prefix = 'magnet-runtime-'): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

function roots(root: string): PluginPathRoots {
  fs.mkdirSync(root, { recursive: true });
  return {
    applicationData: root,
    data: path.join(root, 'plugins', 'data'),
    cache: path.join(root, 'plugins', 'cache'),
    temp: path.join(root, 'plugins', 'temp'),
  };
}

interface PluginFixtureOptions {
  name?: string;
  code?: string;
  capabilities?: string[];
  contribute?: Record<string, unknown>;
  main?: string;
  panelHtml?: boolean;
}

function createPlugin(
  root: string,
  directoryName: string,
  options: PluginFixtureOptions = {},
): string {
  const directory = path.join(root, directoryName);
  const main = options.main ?? './main/dist/index.js';
  fs.mkdirSync(path.join(directory, 'main', 'dist'), { recursive: true });
  if (options.panelHtml) {
    fs.mkdirSync(path.join(directory, 'panel.demo', 'dist'), { recursive: true });
    fs.writeFileSync(path.join(directory, 'panel.demo', 'dist', 'index.html'), '<main>demo</main>');
  }
  fs.writeFileSync(
    path.join(directory, 'package.json'),
    JSON.stringify({
      name: options.name ?? `@example/${directoryName}`,
      version: '1.0.0',
      type: 'module',
      main,
      'ce-editor': {
        schemaVersion: 1,
        ...(options.capabilities ? { capabilities: options.capabilities } : {}),
        ...(options.contribute ? { contribute: options.contribute } : {}),
      },
    }),
  );
  if (main === './main/dist/index.js') {
    fs.writeFileSync(
      path.join(directory, 'main', 'dist', 'index.js'),
      options.code ?? 'editor.plugin.define({ methods: {} });',
    );
  }
  return directory;
}

function sessionHost(module: PluginModule) {
  const host = {
    sessionId: 'test-session',
    application: { request: vi.fn(async () => 'application-result') },
    plugin: {
      define: vi.fn(),
      getInfo: (name: string) => module.getInfo(name),
      listLoaded: () => module.listLoaded(),
      listRegistered: () => module.listRegistered(),
      callPlugin: (name: string, method: string, ...args: unknown[]) =>
        module.callPlugin(name, method, ...args),
    },
    panel: {
      register: vi.fn(),
      unregister: vi.fn(),
      getInfo: vi.fn(() => ({ title: 'Demo' })),
      getRegistration: vi.fn(() => ({ owner: '@example/demo' })),
      list: vi.fn(() => ['@example/demo.main']),
    },
    menu: {
      attach: vi.fn(),
      detach: vi.fn(),
      setDefaults: vi.fn(),
      clearDefaults: vi.fn(),
      reset: vi.fn(),
      getState: vi.fn(() => ({ tree: [] })),
    },
    message: {
      registerRequest: vi.fn(),
      registerBroadcast: vi.fn(),
      unregisterRequest: vi.fn(),
      unregisterBroadcast: vi.fn(),
      request: vi.fn(async () => 'message-result'),
      broadcast: vi.fn(),
    },
  } satisfies PluginRuntimeHost;
  return host;
}

function loadOptions(module: PluginModule, root: string, credentials?: PluginCredentialVault) {
  return {
    scope: 'session' as const,
    host: sessionHost(module),
    paths: { roots: roots(path.join(root, 'application-data')), legacyDataDirectories: [] },
    ...(credentials ? { credentials } : {}),
  };
}

function profile(id = 'credential-1'): CredentialProfile {
  return {
    id,
    label: 'Example',
    metadata: {},
    createdAt: '2026-08-15T00:00:00.000Z',
    updatedAt: '2026-08-15T00:00:00.000Z',
  };
}

describe('PluginModule registration', () => {
  it('rejects missing packages, entries, and invalid panel artifacts', async () => {
    const root = temporaryDirectory();
    const module = new PluginModule();
    const missingPackage = path.join(root, 'missing');
    fs.mkdirSync(missingPackage);
    await expect(module.register(missingPackage)).rejects.toThrow(/no package\.json/);

    const missingEntry = createPlugin(root, 'missing-entry', { main: './main/dist/missing.js' });
    await expect(module.register(missingEntry)).rejects.toThrow(/main file does not exist/);

    const missingPanel = createPlugin(root, 'missing-panel', {
      contribute: { panel: { demo: { entry: './panel.demo/dist/index.html' } } },
    });
    await expect(module.register(missingPanel)).rejects.toThrow(/panel.*does not exist/);

    const sourcePanel = createPlugin(root, 'source-panel', {
      contribute: { panel: { demo: { entry: './panel.demo/src/index.html' } } },
    });
    await expect(module.register(sourcePanel)).rejects.toThrow(/dist index\.html/);
  });

  it('records source identity, ignores duplicate paths, and resolves info by name or path', async () => {
    const root = temporaryDirectory();
    const pluginPath = createPlugin(root, 'metadata', { panelHtml: true });
    const module = new PluginModule();
    await module.register(pluginPath, {
      kind: 'builtin',
      source: { scope: 'kit', kitId: 'example', kitVersion: '2.0.0' },
    });
    await module.register(pluginPath);

    expect(module.listRegistered()).toEqual([path.resolve(pluginPath)]);
    expect(module.getInfo('@example/metadata')).toMatchObject({
      kind: 'builtin',
      source: { scope: 'kit', kitId: 'example', kitVersion: '2.0.0' },
    });
    expect(module.getInfo(pluginPath)?.name).toBe('@example/metadata');
    expect(module.getInfo('@example/unknown')).toBeUndefined();
  });
});

describe('PluginModule lifecycle', () => {
  it('requires registration and exactly one definition while restoring the global bridge', async () => {
    const root = temporaryDirectory();
    const module = new PluginModule();
    const unregistered = createPlugin(root, 'unregistered');
    await expect(module.load(unregistered, loadOptions(module, root))).rejects.toThrow(
      /not registered/,
    );

    const noDefinition = createPlugin(root, 'no-definition', { code: 'export const value = 1;' });
    await module.register(noDefinition);
    const originalEditor = { preserved: true };
    Object.defineProperty(globalThis, 'editor', {
      value: originalEditor,
      configurable: true,
      writable: true,
    });
    await expect(module.load(noDefinition, loadOptions(module, root))).rejects.toThrow(
      /did not call/,
    );
    expect((globalThis as { editor?: unknown }).editor).toBe(originalEditor);

    const duplicate = createPlugin(root, 'duplicate-definition', {
      code: 'editor.plugin.define({}); editor.plugin.define({});',
    });
    await module.register(duplicate);
    await expect(module.load(duplicate, loadOptions(module, root))).rejects.toThrow(
      /more than once/,
    );
    Reflect.deleteProperty(globalThis, 'editor');
  });

  it('loads idempotently, dispatches methods, and requires unload before unregister', async () => {
    const root = temporaryDirectory();
    const pluginPath = createPlugin(root, 'callable', {
      code: `
        let loads = 0;
        editor.plugin.define({
          lifecycle: { load() { loads += 1; } },
          methods: { greet(name) { return 'Hello ' + name; }, loads() { return loads; } },
        });
      `,
    });
    const module = new PluginModule();
    await module.register(pluginPath);
    const options = loadOptions(module, root);
    await module.load(pluginPath, options);
    await module.load(pluginPath, options);

    expect(module.listLoaded()).toEqual(['@example/callable']);
    expect(module.callPlugin('@example/callable', 'greet', 'Magnet')).toBe('Hello Magnet');
    expect(module.callPlugin('@example/callable', 'loads')).toBe(1);
    expect(() => module.callPlugin('@example/callable', 'missing')).toThrow(
      /Available: greet, loads/,
    );
    expect(() => module.unregister(pluginPath)).toThrow(/must be unloaded/);

    await module.unload(pluginPath);
    await module.unload(pluginPath);
    module.unregister(pluginPath);
    module.unregister(pluginPath);
    expect(module.listRegistered()).toEqual([]);
  });

  it('attaches and detaches contributions across loaded plugins', async () => {
    const root = temporaryDirectory();
    const eventsKey = `__magnetEvents${Date.now()}`;
    (globalThis as Record<string, unknown>)[eventsKey] = [];
    const observer = createPlugin(root, 'observer', {
      code: `
        editor.plugin.define({ lifecycle: {
          attach(name) { globalThis.${eventsKey}.push('attach:' + name); },
          detach(name) { globalThis.${eventsKey}.push('detach:' + name); },
        }});
      `,
      contribute: { menu: [{ id: 'observer' }] },
    });
    const subject = createPlugin(root, 'subject', {
      code: `
        editor.plugin.define({ lifecycle: {
          attach(name) { globalThis.${eventsKey}.push('subject-attach:' + name); },
        }});
      `,
      contribute: { menu: [{ id: 'subject' }] },
    });
    const module = new PluginModule();
    await module.register(observer);
    await module.register(subject);
    await module.load(observer, loadOptions(module, root));
    await module.load(subject, loadOptions(module, root));
    await module.unload(subject);

    expect((globalThis as unknown as Record<string, string[]>)[eventsKey]).toEqual([
      'attach:@example/subject',
      'subject-attach:@example/observer',
      'detach:@example/subject',
    ]);
    Reflect.deleteProperty(globalThis, eventsKey);
  });

  it('cleans up failed loads and reports combined lifecycle cleanup failures', async () => {
    const root = temporaryDirectory();
    const pluginPath = createPlugin(root, 'failed-load', {
      code: `editor.plugin.define({ lifecycle: {
        load() { throw new Error('load failed'); },
        unload() { throw new Error('unload failed'); },
      }});`,
    });
    const module = new PluginModule();
    await module.register(pluginPath);

    const error = await module.load(pluginPath, loadOptions(module, root)).catch((cause) => cause);
    expect(error).toBeInstanceOf(AggregateError);
    expect(error.errors).toHaveLength(2);
    expect(error.cause).toMatchObject({ message: 'unload failed' });
    expect(module.listLoaded()).toEqual([]);
  });
});

describe('session runtime capabilities', () => {
  it('forwards host APIs while enforcing owner delegation and default-menu boundaries', async () => {
    const root = temporaryDirectory();
    const pluginPath = createPlugin(root, 'runtime-api', {
      code: `
        let runtime;
        editor.plugin.define({
          lifecycle: { load(next) { runtime = next; } },
          methods: {
            exercise() {
              runtime.application.request('@example/app', 'ping', 1);
              runtime.plugin.getInfo('@example/runtime-api');
              runtime.plugin.listLoaded();
              runtime.plugin.listRegistered();
              runtime.panel.register('@example/runtime-api.main', '/panel.js', { minWidth: 10 });
              runtime.panel.unregister('@example/runtime-api.main');
              runtime.panel.getInfo('@example/runtime-api.main');
              runtime.panel.getRegistration('@example/runtime-api.main');
              runtime.panel.list();
              runtime.menu.attach('@example/runtime-api', {});
              runtime.menu.detach('@example/runtime-api');
              runtime.menu.reset();
              runtime.menu.getState();
              runtime.message.registerRequest('@example/runtime-api', 'ping', () => 'pong');
              runtime.message.registerBroadcast('@example/runtime-api', 'changed', () => {});
              runtime.message.unregisterRequest('@example/runtime-api', 'ping');
              runtime.message.unregisterBroadcast('@example/runtime-api', 'changed');
              runtime.message.request('@example/peer', 'ping');
              runtime.message.broadcast('changed');
              return runtime.paths;
            },
            impersonate() { return runtime.menu.attach('@example/other', {}); },
            setDefaults() { return runtime.menu.setDefaults([]); },
          },
        });
      `,
    });
    const module = new PluginModule();
    await module.register(pluginPath);
    const options = loadOptions(module, root);
    await module.load(pluginPath, options);
    const result = module.callPlugin('@example/runtime-api', 'exercise');

    expect((result as { data: string }).data).toContain(path.join('plugins', 'data'));
    expect(options.host.panel.register).toHaveBeenCalledWith(
      '@example/runtime-api.main',
      '/panel.js',
      { minWidth: 10 },
      '@example/runtime-api',
    );
    expect(() => module.callPlugin('@example/runtime-api', 'impersonate')).toThrow(
      /cannot register/,
    );
    expect(() => module.callPlugin('@example/runtime-api', 'setDefaults')).toThrow(/cannot set/);
  });

  it('allows framework delegate plugins to act for another owner', async () => {
    const root = temporaryDirectory();
    const menuPlugin = createPlugin(root, 'menu-delegate', {
      name: '@itharbors/menu',
      code: `
        let runtime;
        editor.plugin.define({
          lifecycle: { load(next) { runtime = next; } },
          methods: { attach() { runtime.menu.attach('@example/other', {}); runtime.menu.setDefaults([]); runtime.menu.clearDefaults(); } },
        });
      `,
    });
    const module = new PluginModule();
    await module.register(menuPlugin, { kind: 'builtin' });
    const options = loadOptions(module, root);
    await module.load(menuPlugin, options);
    module.callPlugin('@itharbors/menu', 'attach');

    expect(options.host.menu.attach).toHaveBeenCalledWith('@example/other', {});
    expect(options.host.menu.setDefaults).toHaveBeenCalledWith([]);
    expect(options.host.menu.clearDefaults).toHaveBeenCalledOnce();
  });

  it('injects and revokes credentials only for a declared capability', async () => {
    const root = temporaryDirectory();
    const credential = profile();
    const credentials: PluginCredentialVault = {
      capability: vi.fn(async () => ({ mode: 'local' as const, status: 'available' as const })),
      available: vi.fn(async () => true),
      list: vi.fn(async () => [credential]),
      get: vi.fn(async () => ({ profile: credential, secret: 'secret' })),
      put: vi.fn(async () => credential),
      delete: vi.fn(async () => undefined),
    };
    const capable = createPlugin(root, 'credentials', {
      capabilities: ['credentials'],
      code: `
        let vault;
        editor.plugin.define({
          lifecycle: { load(runtime) { vault = runtime.credentials; } },
          methods: {
            vault() { return vault; },
            exercise() { return Promise.all([vault.capability(), vault.available(), vault.list(), vault.get('credential-1'), vault.put({ label: 'x', metadata: {}, secret: 's' }), vault.delete('credential-1')]); },
          },
        });
      `,
    });
    const module = new PluginModule();
    await module.register(capable);
    await module.load(capable, loadOptions(module, root, credentials));
    const vault = module.callPlugin('@example/credentials', 'vault') as PluginCredentialVault;
    await module.callPlugin('@example/credentials', 'exercise');
    await module.unload(capable);

    expect(await vault.available()).toBe(false);
    await expect(vault.list()).rejects.toMatchObject({ code: 'CREDENTIAL_OPERATION_FAILED' });

    const incapable = createPlugin(root, 'no-credentials', {
      code: `let present; editor.plugin.define({ lifecycle: { load(runtime) { present = 'credentials' in runtime; } }, methods: { present() { return present; } } });`,
    });
    await module.register(incapable);
    await module.load(incapable, loadOptions(module, root, credentials));
    expect(module.callPlugin('@example/no-credentials', 'present')).toBe(false);
  });
});

describe('application runtime capabilities', () => {
  it('binds services to the plugin owner and permits only server message routes', async () => {
    const root = temporaryDirectory();
    const pluginPath = createPlugin(root, 'application-plugin', {
      code: `
        let runtime;
        editor.plugin.define({
          lifecycle: { load(next) { runtime = next; } },
          methods: {
            exercise() {
              runtime.service.register('cache', { ok: true });
              runtime.service.get('cache');
              runtime.service.unregister('cache');
              runtime.menu.attach('@example/application-plugin', {});
              runtime.menu.detach('@example/application-plugin');
              runtime.menu.getState();
              runtime.message.registerRequest('@example/application-plugin', 'ping', () => 'pong', 'server', ['ping']);
              runtime.message.registerBroadcast('@example/application-plugin', 'changed', () => {}, undefined, ['changed']);
              runtime.message.unregisterRequest('@example/application-plugin', 'ping');
              runtime.message.unregisterBroadcast('@example/application-plugin', 'changed');
              runtime.message.request('@example/peer', 'ping');
              runtime.message.broadcast('changed');
              return runtime.host.mode;
            },
            browserRoute() { runtime.message.registerRequest('@example/application-plugin', 'bad', () => {}, 'browser'); },
            panelMethod() { runtime.message.registerRequest('@example/application-plugin', 'bad', () => {}, 'server', ['panel.open']); },
          },
        });
      `,
    });
    const module = new PluginModule();
    const host: ApplicationPluginRuntimeHost = {
      plugin: {
        define: vi.fn(),
        getInfo: (name) => module.getInfo(name),
        listLoaded: () => module.listLoaded(),
        listRegistered: () => module.listRegistered(),
        callPlugin: (name, method, ...args) => module.callPlugin(name, method, ...args),
      },
      menu: {
        attach: vi.fn(),
        detach: vi.fn(),
        getState: vi.fn(() => ({ tree: [] })),
      },
      message: {
        registerRequest: vi.fn(),
        registerBroadcast: vi.fn(),
        unregisterRequest: vi.fn(),
        unregisterBroadcast: vi.fn(),
        request: vi.fn(async () => undefined),
        broadcast: vi.fn(),
      },
      service: {
        register: vi.fn(),
        unregister: vi.fn(),
        get: vi.fn(() => undefined),
      },
      host: {
        mode: 'desktop',
        notifications: {
          create: vi.fn(),
          list: vi.fn(),
          markRead: vi.fn(),
          markAllRead: vi.fn(),
          remove: vi.fn(),
        },
      },
    };
    await module.register(pluginPath);
    await module.load(pluginPath, {
      scope: 'application',
      host,
      paths: { roots: roots(path.join(root, 'application-data')), legacyDataDirectories: [] },
    });

    expect(module.callPlugin('@example/application-plugin', 'exercise')).toBe('desktop');
    expect(host.service.register).toHaveBeenCalledWith('@example/application-plugin', 'cache', {
      ok: true,
    });
    expect(host.message.registerRequest).toHaveBeenCalledWith(
      '@example/application-plugin',
      'ping',
      expect.any(Function),
      'server',
      ['ping'],
    );
    expect(() => module.callPlugin('@example/application-plugin', 'browserRoute')).toThrow(
      /only server/,
    );
    expect(() => module.callPlugin('@example/application-plugin', 'panelMethod')).toThrow(
      /only server/,
    );
  });
});
