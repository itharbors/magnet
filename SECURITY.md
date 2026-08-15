# Security Policy

## Supported versions

Magnet is pre-1.0. Security fixes are provided on the latest release only.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability. Use GitHub's private vulnerability
reporting for `itharbors/magnet`. Include affected versions, impact, reproduction steps, and any
suggested mitigation.

## Runtime trust model

Magnet validates package structure and narrows host capabilities, but it does not sandbox plugin
JavaScript. Loading a plugin grants code execution in the selected host process. Applications must
establish plugin provenance and trust before calling `PluginModule.load`, or isolate plugin execution
in a separate process with an application-specific protocol.
