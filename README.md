# Magnet

Magnet is the host-agnostic plugin runtime used by Harbors-compatible Node.js applications. It
validates plugin manifests, loads plugin entry points, manages lifecycle transitions, isolates
plugin-owned storage, and exposes typed contracts for session and application hosts.

## Status

Magnet is an early standalone package. The public API is usable, but compatibility is not promised
before `1.0.0`.

## Requirements

- Node.js 22.13 or newer
- ESM (`"type": "module"`)

## Install

The package is not published to npm yet. After a registry release becomes available:

```sh
npm install @itharbors/magnet
```

## Plugin package contract

A plugin is an ESM npm package whose `main` points to built JavaScript under `dist` and whose
`ce-editor` field declares its runtime contract:

```json
{
  "name": "@example/hello-plugin",
  "version": "1.0.0",
  "type": "module",
  "main": "./main/dist/index.js",
  "ce-editor": {
    "schemaVersion": 1,
    "capabilities": [],
    "contribute": {
      "message": {
        "request": {
          "hello": ["greet"]
        }
      }
    }
  }
}
```

The entry module must define itself exactly once through the temporary definition bridge:

```js
editor.plugin.define({
  lifecycle: {
    load(runtime) {
      console.log(`Loaded with data at ${runtime.paths.data}`);
    },
  },
  methods: {
    greet(name) {
      return `Hello ${name}`;
    },
  },
});
```

## Host integration

```ts
import { PluginModule, type PluginRuntimeHost } from '@itharbors/magnet';

const plugins = new PluginModule();
await plugins.register('/absolute/path/to/plugin');
await plugins.load('/absolute/path/to/plugin', {
  scope: 'session',
  host: yourHost satisfies PluginRuntimeHost,
  paths: {
    roots: {
      applicationData: '/absolute/application-data',
      data: '/absolute/application-data/plugins/data',
      cache: '/absolute/application-data/plugins/cache',
      temp: '/absolute/application-data/plugins/temp',
    },
    legacyDataDirectories: [],
  },
});
```

The root export contains the runtime, lifecycle, storage, credentials, and host contracts. Manifest
parsing is also available from the narrow `@itharbors/magnet/manifest` export.

## Security boundaries

- Plugin entry points and panel assets must remain inside their package and point to built `dist`
  artifacts.
- Plugin storage uses owner hashes, private directory permissions where supported, and fail-closed
  checks against symlink and path-replacement attacks.
- Credential facades are capability-gated and revoked before plugin teardown.
- Loading plugin code executes third-party JavaScript in the host process. Magnet does not provide a
  sandbox; hosts must install and load only trusted plugins or isolate them in a separate process.

Report vulnerabilities according to [SECURITY.md](SECURITY.md).

## Development

```sh
npm ci
npm run check
```

`npm run check` runs formatting, linting, type checking, coverage-enforced tests, compilation,
manifest linting, tarball-content checks, and an installation/import smoke test in a temporary
consumer project.

## License

No open-source license has been granted yet. See the `UNLICENSED` package metadata.
