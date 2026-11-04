# @schovest/pi-sudo-helper

[![npm version](https://img.shields.io/npm/v/@schovest/pi-sudo-helper.svg)](https://www.npmjs.com/package/@schovest/pi-sudo-helper)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Sudo password helper for the [Pi coding agent](https://github.com/badlogic/pi-mono). When the
agent runs a `sudo` command through the bash tool, a masked password dialog pops up; the
password is injected via `SUDO_ASKPASS` + a FIFO in `/dev/shm` (tmpfs) — it never touches
disk, process arguments, or the agent's context.

## Install

```sh
pi install npm:@schovest/pi-sudo-helper
```

Restart your Pi session.

## How it works

1. On every bash `tool_call`, the command is scanned for `sudo` usage
2. A `sudo -n true` precheck skips the dialog while the sudo timestamp is still valid
3. A FIFO + askpass script are created under `/dev/shm` (permissions `0600` / `0700`)
4. A masked password dialog takes over input; the typed password is XOR-encrypted in memory
5. On submit, only the **first** `sudo` is rewritten to `SUDO_ASKPASS='<script>' sudo -A`;
   nested sudos run as root and no longer need a password, so one authentication covers
   `sudo bash -c '…'` wrapping arbitrary inner commands
6. Temp resources are cleaned up when the tool call finishes

### Input timeout

The password dialog cancels itself automatically after **120 seconds** without input, so a
forgotten dialog can never block the session indefinitely. A timed-out dialog blocks the
tool call with an explanatory reason (the command is not executed and left unmodified);
just re-issue the command to try again.

### Reactive failure hints

No standing prompt is injected. If a sudo command fails and the original command shows a
structural problem (multiple bare `sudo`s, `sudo -n` probing, double-quoted
`sudo bash -c "…"`), the tool result gets a short hint appended — the error snippet plus a
suggestion to use `sudo bash -c '<entire command>'` with single quotes. Well-formed
commands that fail for their own reasons stay silent.

## Security

- **Never persisted** — the FIFO lives on `/dev/shm` tmpfs, pure RAM
- **Never visible to `ps` / `/proc`** — the password travels through a kernel pipe, not
  argv or environ
- **Never exposed to the agent** — the session records the original command; the agent
  only sees the command and its result
- **Never a plain string in the heap** — keystrokes are XOR-encrypted into a `SecureBuffer`
  with a random per-byte key; plaintext exists only inside a `Buffer` for the duration of a
  single `write()` and is zero-filled immediately after
- **Wiped after use** — buffers are physically zeroed, temp files unlinked

## License

MIT
