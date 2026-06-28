# Modern Editor for Grav 2.0 (Admin Next)

A modern visual WYSIWYG editor (powered by [TinyMCE](https://www.tiny.cloud/)) for the page content field, fully compatible with **Admin Next** (the brand-new admin interface for Grav 2.0).

<img width="1364" height="765" alt="image" src="https://github.com/user-attachments/assets/7037738e-7c78-40a3-8574-b968940ddb41" />

## License & Third-Party Components

This plugin is licensed under the GNU General Public License v2.0 or later (GPLv2+).

**Note about TinyMCE:** This plugin loads TinyMCE 7 from a public CDN (jsdelivr.net). TinyMCE 7 is licensed under GPLv2+. This project is also licensed under GPLv2+ to ensure full compatibility with TinyMCE's licensing requirements and to avoid any legal ambiguity.

---

## Installation

1. **If you have a previous version of this plugin installed** (e.g., named `tinymce-editor`), **please uninstall it first** to avoid conflicts:
   Delete the directory `user/plugins/tinymce-editor/` (or uninstall it via Admin Next).
2. Extract the contents of this plugin into `user/plugins/modern-editor/` (the directory should contain `modern-editor.php` directly).
3. Clear your Grav cache:
   ```bash
   bin/grav clear-cache
   ```
4. **Log out and log back in** to Admin Next. *Important:* Admin Next loads the list of available custom field Web Components only once per session upon login. If you stay in the old session, it might not register the new plugin field.
5. Navigate to Admin Next → Plugins and ensure that **Modern Editor** is enabled.
6. Open any page to edit: the "Content" field will now show the visual WYSIWYG editor instead of the default Markdown editor!

No `composer install` or `npm install` is required; the visual editor is loaded directly from jsDelivr CDN on the fly in the administrator's browser.

---

## Disclaimer

This software is provided **"AS IS"**, without any warranty. While it has been tested and reasonable efforts are made to ensure security and reliability, no guarantees are provided. As an open project, anyone may contribute or report issues, but this does not imply endorsement or liability from the maintainers.

**You use this software entirely at your own risk.** The authors and contributors are not liable for any damages, data loss, or unexpected behavior resulting from its use, modification, or distribution. Always review and test the code independently before deploying it in critical or production environments.

## How Field Overrides Work (No Theme Modifications Required)

Grav resolves page blueprints (the schemas defining edit fields) by merging YAML files from multiple directories using the standard `@extends` mechanism via the `blueprints://pages` stream. A blueprint file can extend an existing page template (e.g., `default`, `item`, `blog`) and override specific fields, leaving everything else intact.

At startup (during the `onGetPageBlueprints` event), this plugin:

1. **Scans the active theme templates** (all `.html.twig` files inside the theme's `templates/` folder, excluding utility layouts like `error`, `modular`, `partials`, and `forms`).
2. **Dynamically generates override files in the cache** (`cache/modern-editor/blueprints/pages/`). For each discovered template, a small YAML file is created to extend it and override only the `content` field to be of type `moderneditor`.
3. **Registers the generated cache folder** within the `blueprints://pages` stream, so Grav merges it automatically just as if you had written it by hand inside your theme.

**The result:** The visual editor automatically appears on **all** current and future page templates of your active theme without requiring any manual editing or template copying. If you change plugin options (height, toolbar, etc.) from Admin Next, the cached files are automatically regenerated upon the next page load.

If you wish to **exclude** the editor from a specific template or customize it differently on a per-template basis, you can manually create a high-priority file at `blueprints/pages/<templatename>.yaml` inside this plugin. (The directory is created empty, ready for advanced overrides).

---

## Troubleshooting & Diagnostics

If the editor does not appear, follow these steps:

1. **Clear cache + Log out and log back in** (see Installation steps 3 & 4). This resolves the vast majority of issues because it forces the regeneration of blueprints and clears Admin Next's field cache.
2. **Check if the cached blueprints are being generated** via SSH/FTP:
   ```bash
   user/cache/modern-editor/blueprints/pages/
   ```
   You should see a `.yaml` file for each page template of your theme (e.g., `default.yaml`, `item.yaml`, etc.). Open one to verify it contains `type: moderneditor` under `content`. If the folder is empty or doesn't exist, the `onGetPageBlueprints` event is not firing in your setup.
3. **Inspect the resolved blueprint via API.** In your browser console on the Admin Next edit page:
   ```javascript
   fetch(window.__GRAV_API_SERVER_URL + (window.__GRAV_API_PREFIX || '/api/v1') + '/blueprints/pages/default', {
     headers: { 'X-API-Token': window.__GRAV_API_TOKEN || '' }
   }).then(r => r.json()).then(j => console.log(JSON.stringify(j, null, 2)));
   ```
   *(Replace `default` with the actual page template name if necessary).*
   Look for the `content` field inside `tabs.fields.content.fields.content`: it must report `"type": "moderneditor"`.
4. **Inspect the browser console (F12)** on the edit page for JavaScript errors and check the Network tab to ensure that requests to `cdn.jsdelivr.net/npm/tinymce` are succeeding. If the blueprint API reports `moderneditor` but the field does not load, the issue lies in the Custom Element registration rather than the blueprint merge.

---

## Configuration

From Admin Next → Plugins → Modern Editor, you can easily customize:
- **Editor Script Source**: Choose between **Cloud CDN (jsDelivr)** and **Local (Self-hosted)**. If **Local** is selected, the plugin will load TinyMCE directly from your server without making external CDN calls.
- **Local TinyMCE Version**: Specify the version of TinyMCE to download for self-hosting (default: `7.4.0`).
- **Local Status / Update**: A custom status card displaying whether the local assets are present, which version is currently installed, and provides a direct, secure action button to download, reinstall, or manually upgrade the editor's version.
- **Editor Height**: The height in pixels of the visual editing canvas.
- **Menubar Visibility**: Show or hide the top menu bar (File, Edit, Insert, etc.).
- **Active Plugins**: Space-separated list of TinyMCE plugins to load.
- **Toolbar Configuration**: Complete layout of buttons and groupings.

---

## Local Self-Hosting (Offline Mode)

If your Grav installation runs in a private network, or if you prefer not to rely on third-party CDNs (jsDelivr) for privacy/compliance reasons, you can enable local mode:

1. Go to Admin Next → Plugins → **Modern Editor**.
2. Change **Editor Script Source** to **Local (Self-hosted)**.
3. Keep the default **Local TinyMCE Version** (e.g. `7.4.0`), or write any valid version you wish to target.
4. The system will **automatically download, extract, and verify** the specified TinyMCE Community edition ZIP package on the fly when the admin panel loads.
5. Alternatively, you can click the **"Download Local TinyMCE Now"** button in the status message to trigger the download process immediately.
6. Once completed, a confirmation notice will appear, and you will see: `🟢 Local TinyMCE is installed (v7.4.0)`.

*Requirement:* Your web server must have the PHP `curl` and `ZipArchive` extensions enabled to download and unzip the community files.

---

## Known Limitations

- **HTML Content**: The content exchanged with the form is **HTML**, not Markdown.
- **Modular Templates**: Modular page templates (inside the theme's `templates/modular/` directory) are excluded from automatic generation. To use the editor there, add a manual override blueprint.

---

## Maintainer & Author

- **Author**: PeopleInside
- **GitHub Repository**: [https://github.com/PeopleInside/modern-editor](https://github.com/PeopleInside/modern-editor)

---

## License

This project is licensed under the  GNU General Public License v2.0 or later (GPLv2+) - see the [LICENSE](LICENSE) file for details.
