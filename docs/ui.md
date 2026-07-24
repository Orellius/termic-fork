# UI

## Conventions

- Colors are `@theme` CSS vars in `index.css`. Accent terracotta `#d97757`, dark surfaces `#0a0a0a`-`#181818`. Never hard-code hex outside `@theme`.
- Ink on a solid **status/accent fill** must come from that fill's own `-fg` token, never `text-white`. On a `--color-accent` fill (count badges, filled CTAs, review-comment buttons, editor search checkmark, toggle knobs on an accent track) use `--color-accent-fg`; on a `--color-ok` fill (the AgentsSection toggle tracks) use `--color-ok-fg`. Do not reuse one for the other: a theme may pair a light accent with a dark ok. The accent is not guaranteed dark (cobalt sky 1.9:1, matrix green 2.5:1, rosepine rose 1.7:1 against white), so light-accent themes override the token to a dark ink. `--color-accent-deep` stays dark in every theme, so white text on it is fine, which is why the `:hover` states that drop to accent-deep flip back to white.
- `CliIcon cli={...}` + `CLI_BRAND_COLOR[cli]` for claude/gemini/codex (orange/blue/green).
- Tooltips default `delay: 0`. Override per-call.
- `cn()` from `@/lib/utils` for class composition.
- All `<input>` and `<textarea>` get `spellCheck={false}` + `autoCorrect="off"` + `autoCapitalize="off"` + `autoComplete="off"`. Developer tool — paths and commands are never English words.

## Settings layout

Left rail + one content pane (`components/settings/Settings.tsx`). Rail order: General, Tasks, Notifications, Sandbox, CLI, Appearance, Agents & Terminals, Prompts, Shortcuts, then the per-project list.

Each page owns one domain, and a setting belongs to the page whose domain it changes, not the page that happened to be open when it was written. General is app-level only (repos directory, personal file-tree excludes, remote images in the markdown preview); it is deliberately short. A new setting that needs a fifth thing on General is a sign the domain wants its own rail item.

Sections share `Controls.tsx`: `Toggle`, `ListField`, `Block` (hairline + spacing), `SectionTitle`, and `useBackendSettings()`. Use the hook rather than calling `settingsLoad`/`settingsSave` directly: it caches the whole `Settings` object and merges patches into it, so one page saving one field cannot wipe another page's. Prefs (`store/prefs`) persist on change; backend `Settings` fields either persist on change through `patch()` or use an explicit Save button when the field is a multi-line list.

Deep links (`openSettings(tab, repoId, highlight)`) hard-code a tab name, so moving a setting between pages means updating its callers. Live ones: the markdown-preview banner (`general` + `load-remote-images`), the command palette's settings list, and the shortcuts help dialog.

### Experimental features

A feature is Experimental when it is off by default **because we are not yet confident in it**, with a stated way out. Off for safety (remote images), off for taste (copy on select), and off as policy (sandbox permission bypass) are none of them experimental: those defaults are permanent, and labelling them experimental makes the label meaningless.

It shows as a badge, on the rail item and next to the page title, not as a separate Labs page. The badge is dropped when the feature graduates: it survived a release with no bug reports against it and has e2e coverage. Graduating drops the badge and gets a changelog line; it does not move the page, because a settings page that moves twice is worse than one labelled honestly. A dedicated Experimental page only earns its place when several features qualify at once, which today they do not (the CLI is the only resident).

## Window chrome / drag

macOS overlay title bar, hidden title, 84px reserved left for traffic lights. Three drag mechanisms (each fails differently):

1. `data-tauri-drag-region` — primary (Tauri 2 JS handler)
2. `WebkitAppRegion: "drag"` — backup (native AppKit hint)
3. `onMouseDown → startDragging()` — escape hatch (imperative)

Opt-out with both `data-tauri-drag-region="false"` and `WebkitAppRegion: "no-drag"`. mousedown handler skips `button, input, [data-no-drag]`. `startDragging()` silently fails without `core:window:allow-start-dragging` in capabilities. No `user-select: none` on drag region — put it on inner text spans.

## Right-panel footer (Setup / Run / Terminal)

Three tabs. Setup + Run stream via `useScriptRuns`. Terminal is opt-in: click `+` → `useApp.enableFooterTerm(wsId)` → AuxTerminal mounts. RunToolbar: Open (expands `project.preview_url` with `$TERMIC_PORT`/`$CONDUCTOR_PORT`/`$PORT`/`$TERMIC_WORKSPACE_NAME`) + Run/Stop (SIGTERMs process group). Default: tab=Run, expanded.

`task_archive` sweeps `RUNNING_SCRIPTS` and SIGTERMs each before teardown.

## Settled detection / notifications

TerminalPane samples `term.buffer.active` every 3s, FNV-1a hashes the visible viewport, marks tab "settled" after 2 identical consecutive samples. Resets on user input. `markAttention(wsId, tabId, reason)` never marks the active tab in the active task. `useAttentionNotifier` suppresses OS notifications for every tab in the focused task. Desktop notifications off by default.
