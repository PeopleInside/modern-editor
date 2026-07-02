# Changelog

## v1.1.9
- Fixed a bug where the plugin status card or the config/CDN fallback fails with a 404 error when Grav's admin path is customized from its default ('/admin') to a custom route.
- Robustified custom admin path detection inside `getAdminPath()` in both field elements to dynamically find and match standard administrative segments (such as `/plugins`, `/pages`, `/dashboard`, etc.) in the URL pathname.
- Resolved an issue where local self-hosted mode loaded TinyMCE from the CDN fallback during page editing because config requests could not reach the customized admin endpoint.

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
