# Changelog

## v2.0.0
- **New**: when "local" (self-hosted) mode is active, the two markdown helper libraries (`marked` and `turndown`, used for markdown↔HTML conversion) are now downloaded and self-hosted alongside TinyMCE, avoiding their previously-hardcoded jsDelivr CDN calls entirely. Both are MIT licensed, so self-hosting them raises no licensing concern (unlike TinyMCE, see `NOTICE.md`); if the local copies are missing or a download fails, the editor gracefully falls back to loading them from the CDN. "Remove offline files" now also cleans up these self-hosted copies.
- **Removed dead/legacy code**: the classic `?action=download_tinymce|check_updates|remove_tinymce_local|get_config|get_status` query-string handlers (~350 lines in `onPagesInitialized`) have been deleted. They duplicated logic already implemented once in `downloadTinyMceAction()` / `checkUpdatesAction()` / `removeTinyMceLocalAction()` / `getStatusData()` / `getConfigData()`, were unreachable given this plugin's Grav >=2.0.0/Admin Next-only requirement, carried the auth-bypass vulnerability described below, and were triggered via plain GET links with no CSRF protection. The Admin Next status-card UI already talks to the REST API (`/modern-editor/status|config|download|check-updates|remove`, POST + token-authenticated) directly and needed no changes.
- **Security fix (critical): unauthenticated action bypass.** The classic `?action=download_tinymce|check_updates|remove_tinymce_local|get_config|get_status` handlers contained a fallback (`if (!$isAuthorized && $this->isAdminContext()) { $isAuthorized = true; }`) that granted authorization based solely on the request's URL path starting with the admin route — with no check that the visitor was actually logged in. This allowed **any unauthenticated request** to trigger destructive/expensive actions (delete the local TinyMCE install, force a re-download/extraction from the npm registry, read plugin config). This entire code path has now been removed (see above).
- Removed a dead/misleading `ZipArchive` availability check in the download routine that was never actually used (extraction uses `PharData` for the npm `.tgz` tarball) and could needlessly block updates on servers without the optional zip extension.
- Added support for **TinyMCE 8.0**: local downloads now fetch the release tarball from the npm registry instead of Tiny's account-gated download portal, which no longer reliably serves 8.x packages.
- **Fixed critical bug**: an "auto-heal" routine ran on every plain admin page load (any request without `?action=`) and silently re-downloaded/overwrote the local TinyMCE files with a hardcoded `7.4.0` whenever the installed version differed from it. This caused a freshly installed update (e.g. to `8.0.0`) to be immediately downgraded back to `7.4.0` on the very next page view/refresh, both in the browser and on disk. The routine now only auto-installs the default version when nothing is installed at all, and never touches an existing installation regardless of its version.
- Added a version-based cache-busting query string (`?v=<version>`) to the local editor script URL, and included the installed TinyMCE version in the cached page-blueprint hash, so the Admin content editor and the browser both pick up a newly installed version immediately instead of serving a stale cached copy/URL.

## v1.1.9
- Fixed custom admin paths and dynamic route detection for all admin panels (e.g. `/grav-admin`, `/panel`, `/control`).
- Resolved non-JSON/HTML redirect responses gracefully to prevent `SyntaxError: Unexpected token <` in browser console.
- Robust URL suffix matching fallback inside field Web Components.

## v1.1.8
- Security fix

- ## v1.1.6
- Security fix

## v1.1.6

- **License Change**: Changed license from MIT to GNU General Public License v2.0 or later (GPLv2+) for full compatibility with TinyMCE 7's licensing requirements.
- Updated `blueprints.yaml` to reflect the new GPL license.
- Updated `README.md` with new licensing information.

## v1.1.5
* Added full support for **Local Self-Hosting (Offline Mode)**, allowing the editor to be loaded directly from the local server without any external CDN calls.
* Removed unrequested TinyMCE version selection; the editor is now streamlined to use standard stable v7.4.0 with an integrated automatic downloader.
* Added a dedicated dynamic **status card** in the Admin panel that shows the local TinyMCE version currently in use.
* Added a **Check for Updates** (Verifica aggiornamenti) button that queries the npm registry live for the latest stable TinyMCE version.
* Integrated an **Update Now** button in the status card to easily download and extract newer TinyMCE versions.
* Improved Web Component behavior in `moderneditor.js` to dynamically fetch the plugin configurations and source selection asynchronously via a custom JSON endpoint in PHP.

## v1.1.0
* Hid the TinyMCE 7 "Get all features" promotion button.
* Fully translated all developer comments, user-facing loading/error states, and code annotations from Italian to English.
* Completely translated, updated, and modernized the `README.md` in English.
* Handed over maintainership/authorship details to PeopleInside.

## v1.0.0
* Renamed plugin from `tinymce-editor` to `modern-editor` to avoid collision with GPM plugins of the same name.
* Changed the "content" field override mechanism from runtime PHP rewrite to dynamic file-based blueprint generation via `onGetPageBlueprints` conforming to Grav's standard `@extends` system.
* Overrides are now automatically generated for EVERY template in the active theme, rather than just the default.
* Visual editor (TinyMCE via CDN) integrated as a Custom Field using a Web Component for Admin Next.
* No manual theme changes are required.
