<?php

namespace Grav\Plugin;

use Grav\Common\Plugin;
use Grav\Common\Grav;
use RocketTheme\Toolbox\Event\Event;

/*
 * Modern Editor Plugin for Grav 2.0
 *
 * Replaces the default "content" page field (default markdown editor)
 * with a visual WYSIWYG editor (TinyMCE), integrated as a Custom Field for
 * Admin Next using a Web Component (admin-next/fields/moderneditor.js).
 *
 * HOW THE "CONTENT" FIELD OVERRIDE WORKS (without modifying the theme):
 *
 * Grav resolves page blueprints via the standard "@extends" mechanism
 * + the blueprints://pages stream, which merges files from multiple
 * sources (core, theme, plugins). For each page template defined by the
 * active theme (default.html.twig, item.html.twig, etc.), this plugin
 * dynamically generates (at cache://blueprints/modern-editor/pages/)
 * a small YAML file that extends that template and overrides only the
 * "content" field in the Content tab. The generated folder is
 * registered in the blueprints://pages stream via onGetPageBlueprints,
 * so Grav finds it and merges it as it would with a handwritten file
 * in the theme.
 *
 * This way, the editor appears on ANY theme template, even if new
 * templates are added in the future, without requiring the user to write
 * or copy anything manually.
 */

class ModernEditorPlugin extends Plugin
{
    /** @var string Path (stream) where the override blueprints are generated */
    protected $generatedPath = 'cache://modern-editor/blueprints/pages';

    /*
     * Pinned versions of the two small MIT-licensed markdown helper
     * libraries (markdown <-> HTML conversion) used by the editor's
     * markdown mode. Both are MIT-licensed (see NOTICE.md), so
     * self-hosting them under "local" mode raises no license concern —
     * unlike TinyMCE, MIT only requires keeping the copyright/license
     * notice in the distributed file, which npm's published builds
     * already include. Keep these in sync with the CDN fallback URLs
     * hardcoded in admin-next/fields/moderneditor.js.
     */
    private const MARKED_VERSION = '12.0.0';
    private const TURNDOWN_VERSION = '7.1.3';

    /*
     * Required so Grav can find ModernEditorApiController (classes/ dir),
     * used by the Grav 2.0 / Admin2 REST API integration below.
     */
    public function autoload(): \Composer\Autoload\ClassLoader
    {
        return require __DIR__ . '/vendor/autoload.php';
    }

    public static function getSubscribedEvents(): array
    {
        return [
            'onPluginsInitialized' => ['onPluginsInitialized', -100],
        ];
    }

    public function onPluginsInitialized(): void
    {
        if (!$this->config->get('plugins.modern-editor.enabled')) {
            return;
        }

        $this->enable([
            'onGetPageBlueprints' => ['onGetPageBlueprints', 0],
            'onBlueprintCreated' => ['onBlueprintCreated', 0],
            'onAssetsInitialized' => ['onAssetsInitialized', 0],
            // Grav 2.0 / Admin2: real REST endpoints. This is the correct
            // replacement for the old ?action=get_status/get_config query
            // params, which never reach PHP under Admin2 (it's a decoupled
            // SPA served by its own thin wrapper — see onApiRegisterRoutes()).
            'onApiRegisterRoutes' => ['onApiRegisterRoutes', 0],
        ]);
    }

    /*
     * Registers /modern-editor/status, /modern-editor/config,
     * /modern-editor/download, /modern-editor/check-updates and
     * /modern-editor/remove on the Grav API plugin (Grav 2.0+ / Admin2),
     * which is the only supported way to trigger these actions — the
     * classic ?action=... query-string handlers that used to also serve
     * these requests have been removed (see NOTICE below / CHANGELOG).
     */
    public function onApiRegisterRoutes(Event $event): void
    {
        $routes = $event['routes'];
        $controller = \Grav\Plugin\ModernEditor\ModernEditorApiController::class;

        $routes->get('/modern-editor/status', [$controller, 'status']);
        $routes->get('/modern-editor/config', [$controller, 'config']);
        $routes->post('/modern-editor/download', [$controller, 'download']);
        $routes->post('/modern-editor/check-updates', [$controller, 'checkUpdates']);
        $routes->post('/modern-editor/remove', [$controller, 'remove']);
    }

    /*
     * Handle custom backend action triggers when pages and user session are fully initialized.
     */
    /*
     * Generates (if necessary) the override blueprints for each template
     * of the active theme, then registers the generated folder as an
     * additional page blueprint source.
     */
    public function onGetPageBlueprints(Event $event): void
    {
        $types = $event['types'] ?? $event->types ?? null;
        if (!$types) {
            return;
        }

        $this->generateOverrideBlueprints();

        // Register the generated folder first (per-template override),
        // then the plugin's static folder (any manual extensions
        // added by advanced users, see blueprints/pages/).
        $types->scanBlueprints($this->generatedPath);
        $types->scanBlueprints('plugin://' . $this->name . '/blueprints');
    }

    /*
     * Scans page templates (.html.twig) available in the active theme
     * and core, and generates an override file for each, saving it in
     * cache. They are regenerated only if missing or if the plugin's
     * configuration has changed (via a version/hash control file).
     */
    private function generateOverrideBlueprints(): void
    {
        $grav = Grav::instance();
        /** @var \Grav\Common\Filesystem\Locator $locator */
        $locator = $grav['locator'];

        $targetDir = $locator->findResource($this->generatedPath, true, true);
        if (!is_dir($targetDir)) {
            @mkdir($targetDir, 0775, true);
        }

        // NOTE: the installed local TinyMCE version must be part of this
        // hash. buildOverrideYaml() bakes the editor_url (which now
        // includes a "?v=<version>" cache-buster, see getEditorScriptUrl())
        // directly into the cached YAML file. Without the version here,
        // updating TinyMCE (e.g. 7.4.0 -> 8.0.0) would not trigger a
        // regeneration, so pages would keep serving the stale cached
        // editor_url pointing at the previous version indefinitely.
        $cfgHash = md5(json_encode([
            $this->config->get('plugins.modern-editor.height'),
            $this->config->get('plugins.modern-editor.menubar'),
            $this->config->get('plugins.modern-editor.plugins'),
            $this->config->get('plugins.modern-editor.toolbar'),
            $this->config->get('plugins.modern-editor.editor_source'),
            $this->getInstalledTinyMCEVersion(),
        ]));

        $hashFile = $targetDir . '/.config-hash';
        $needsRegen = !file_exists($hashFile) || trim((string) @file_get_contents($hashFile)) !== $cfgHash;

        $templates = $this->discoverPageTemplates($locator);

        foreach ($templates as $templateName) {
            $targetFile = $targetDir . '/' . $templateName . '.yaml';
            if (!$needsRegen && file_exists($targetFile)) {
                continue;
            }
            file_put_contents($targetFile, $this->buildOverrideYaml($templateName));
        }

        if ($needsRegen) {
            @file_put_contents($hashFile, $cfgHash);
        }
    }

    /*
     * Finds available page template names (.html.twig) by scanning
     * the active theme and Grav core. Modular/partials/error are excluded
     * because they do not represent "normal" editable pages.
     *
     * @return string[] List of template names, e.g. ['default', 'item', 'blog']
     */
    private function discoverPageTemplates($locator): array
    {
        $names = [];
        $dirs = [];

        // Active theme.
        $themeTemplates = $locator->findResource('theme://templates', true, true);
        if ($themeTemplates && is_dir($themeTemplates)) {
            $dirs[] = $themeTemplates;
        }

        // Page templates added by other plugins.
        foreach ((array) $locator->findResources('theme://templates') as $dir) {
            if (is_dir($dir)) {
                $dirs[] = $dir;
            }
        }

        $exclude = ['error', 'modular', 'partials', 'forms'];

        foreach (array_unique($dirs) as $dir) {
            $files = @glob($dir . '/*.html.twig') ?: [];
            foreach ($files as $file) {
                $base = basename($file, '.html.twig');
                if (in_array($base, $exclude, true)) {
                    continue;
                }
                // Excludes modular templates (convention: inside a
                // "modular/" subdirectory), which are handled separately.
                if (str_contains($file, '/modular/')) {
                    continue;
                }
                $names[$base] = true;
            }
        }

        // Always guarantee at least "default", even if the theme doesn't
        // explicitly expose it as a physical file.
        $names['default'] = true;

        return array_keys($names);
    }

    /*
     * Builds the YAML content of a single override file.
     */
    private function buildOverrideYaml(string $templateName): string
    {
        $height = (int) $this->config->get('plugins.modern-editor.height', 500);
        $menubar = $this->config->get('plugins.modern-editor.menubar', false) ? 'true' : 'false';

        $plugins = $this->yamlString((string) $this->config->get(
            'plugins.modern-editor.plugins',
            'lists link image table code fullscreen searchreplace media'
        ));

        $toolbar = $this->yamlString((string) $this->config->get(
            'plugins.modern-editor.toolbar',
            'undo redo | blocks | bold italic underline forecolor backcolor | alignleft aligncenter alignright alignjustify | bullist numlist | link image media table | code fullscreen'
        ));

        $editorUrl = $this->getEditorScriptUrl();
        $editorUrlYaml = $this->yamlString($editorUrl);

        return <<<YAML
# Automatically generated by Modern Editor — do not modify by hand,
# it will be overwritten. To customize, change the plugin's settings
# in Admin Next, or add a manual override in
# blueprints/pages/{$templateName}.yaml inside this plugin.
'@extends':
  type: {$templateName}
  context: blueprints://pages

form:
  fields:
    tabs:
      type: tabs
      fields:
        content:
          type: tab
          fields:
            content:
              type: moderneditor
              height: {$height}
              menubar: {$menubar}
              plugins: {$plugins}
              toolbar: {$toolbar}
              editor_url: {$editorUrlYaml}
YAML;
    }

    private function yamlString(string $value): string
    {
        return "'" . str_replace("'", "''", $value) . "'";
    }

    /*
     * Handles injecting local status HTML in our plugin's settings blueprint.
     * Fallback for classic admin (Grav 1.7): directly rewrites the "content" field.
     */
    public function onBlueprintCreated(Event $event): void
    {
        $blueprint = $event['blueprint'] ?? null;
        $type = $event['type'] ?? '';

        if (!$blueprint) {
            return;
        }

        // If it is our plugin configuration blueprint, inject the status dynamically!
        if ($blueprint->get('form/fields/local_status') !== null || $type === 'plugins/modern-editor' || $type === 'plugins/modern-editor/modern-editor' || $type === 'modern-editor') {
            $fields = $blueprint->get('form/fields');
            if (is_array($fields)) {
                $statusHtml = $this->getLocalStatusHtml();
                if (isset($fields['local_status'])) {
                    $fields['local_status']['type'] = 'moderneditorstatus';
                    $fields['local_status']['content'] = $statusHtml;
                }
                $blueprint->set('form/fields', $fields);
            }
            return;
        }

        if ($type !== '' && !str_starts_with($type, 'pages/') && $type !== 'pages') {
            return;
        }

        $fields = $blueprint->get('form/fields');
        if (!is_array($fields)) {
            return;
        }

        // 1. If 'content' field exists and is not 'moderneditor', convert it
        if (isset($fields['content']) && is_array($fields['content']) && ($fields['content']['type'] ?? null) !== 'moderneditor') {
            $fields['content'] = array_merge($fields['content'], [
                'type' => 'moderneditor',
                'height' => $this->config->get('plugins.modern-editor.height', '500'),
                'menubar' => (bool) $this->config->get('plugins.modern-editor.menubar', false),
                'plugins' => $this->config->get('plugins.modern-editor.plugins'),
                'toolbar' => $this->config->get('plugins.modern-editor.toolbar'),
                'editor_url' => $this->getEditorScriptUrl(),
            ]);
        }

        // 2. Recursively find and update any 'moderneditor' fields with the active config settings
        $this->updateModernEditorFields($fields);

        $blueprint->set('form/fields', $fields);
    }

    /*
     * Recursively updates all fields of type 'moderneditor' with current config values.
     */
    private function updateModernEditorFields(array &$fields): void
    {
        foreach ($fields as $key => &$field) {
            if (!is_array($field)) {
                continue;
            }

            if (($field['type'] ?? null) === 'moderneditor') {
                $field['editor_url'] = $this->getEditorScriptUrl();
                $field['height'] = $this->config->get('plugins.modern-editor.height', '500');
                $field['menubar'] = (bool) $this->config->get('plugins.modern-editor.menubar', false);
                $field['plugins'] = $this->config->get('plugins.modern-editor.plugins');
                $field['toolbar'] = $this->config->get('plugins.modern-editor.toolbar');
            }

            if (isset($field['fields']) && is_array($field['fields'])) {
                $this->updateModernEditorFields($field['fields']);
            }
        }
    }

    /*
     * Determines current local status HTML to display in the plugin admin panel.
     */
    /*
     * Detects the language the ADMIN PANEL is displayed in, which is not
     * necessarily the same as the site's content language returned by
     * $grav['language']->getActive() (that one reflects the language of
     * the page being edited / the site's default, e.g. "en" for an
     * English-authored site, even if the admin user has their own admin
     * UI set to Italian — exactly the mismatch that made the status card
     * render in English despite the rest of the admin being in Italian).
     * Priority: the logged-in admin user's own language preference (Grav
     * 2.0 stores this on the user account), then the browser's
     * Accept-Language header, then finally the site's content language.
     */
    private function getUiLanguage(?string $override = null): string
    {
        // Explicit, manually-chosen setting (plugins.modern-editor.ui_language,
        // see blueprints.yaml) always wins. Auto-detecting Admin Next's own
        // UI language proved unreliable across different Grav 2.0 builds —
        // this manual setting is the one thing guaranteed to work regardless
        // of how (or whether) a given installation exposes it.
        $configuredLang = (string) $this->config->get('plugins.modern-editor.ui_language', 'auto');
        if ($configuredLang === 'it' || $configuredLang === 'en') {
            return $configuredLang;
        }

        // "Auto" mode from here on: best-effort detection, still fully
        // Grav-side. The REST API requests (Admin2's own decoupled
        // /api/v1/... routes, see ModernEditorApiController) run in a
        // lighter request lifecycle that may not register every service
        // the same way a normal Twig-rendered admin page load does, so the
        // client passes along the value already computed on page load
        // (see onAssetsInitialized / window.__MODERN_EDITOR_ADMIN_LANG__)
        // to guarantee both contexts agree.
        if ($override === 'it' || $override === 'en') {
            return $override;
        }

        // $grav['language']->getActive() is the SAME value Grav itself
        // uses to translate this plugin's own blueprint field labels
        // (PLUGIN_MODERN_EDITOR.* keys) and the rest of the admin UI
        // ("Dashboard/Configurazione/Pagine..."). Since that's demonstrably
        // what's already rendering correctly, it must be the primary,
        // authoritative source here too — not a secondary guess as before.
        if (isset($this->grav['language'])) {
            $active = $this->grav['language']->getActive();
            if (!empty($active)) {
                return (string) $active;
            }
        }

        // Fallbacks below only matter for Grav/Admin builds where the
        // above isn't available; still purely Grav-side (admin account /
        // session), never the browser.
        $admin = $this->grav['admin'] ?? null;
        if ($admin) {
            if (method_exists($admin, 'getLanguage')) {
                $adminLang = $admin->getLanguage();
                if (!empty($adminLang)) {
                    return (string) $adminLang;
                }
            }
            if (!empty($admin->language ?? null)) {
                return (string) $admin->language;
            }
        }

        $user = $this->grav['user'] ?? null;
        if ($user && !empty($user->language)) {
            return (string) $user->language;
        }

        $session = $this->grav['session'] ?? null;
        if ($session && !empty($session->admin_lang ?? null)) {
            return (string) $session->admin_lang;
        }

        return 'en';
    }

    public function downloadTinyMceAction(string $version, ?string $langOverride = null): array
    {
        if (!preg_match('/^[0-9]+\.[0-9]+\.[0-9]+$/', $version)) {
            $version = '7.4.0';
        }

        $success = $this->downloadAndExtractTinyMCE($version);

        if ($success && isset($this->grav['session'])) {
            $this->grav['session']->modern_editor_latest_version = null;
        }

        $lang = $this->getUiLanguage($langOverride);

        return [
            'status' => $success ? 'success' : 'error',
            'message' => $success
                ? ($lang === 'it' ? "TinyMCE v{$version} è stato scaricato ed estratto con successo localmente!" : "TinyMCE v{$version} has been successfully downloaded and extracted locally!")
                : ($lang === 'it' ? "Impossibile scaricare TinyMCE v{$version}. Controlla i dettagli dell'errore." : "Failed to download TinyMCE v{$version}. Check error details."),
            'html' => $this->getLocalStatusHtml($langOverride)
        ];
    }

    public function checkUpdatesAction(?string $langOverride = null): array
    {
        $lang = $this->getUiLanguage($langOverride);
        $latestVersion = $this->fetchLatestTinyMCEVersion();
        $pluginDir = $this->grav['locator']->findResource('plugin://' . $this->name, true, true);
        $localJs = $pluginDir . '/assets/tinymce/tinymce.min.js';
        $versionFile = $pluginDir . '/assets/tinymce/.version';
        $isInstalled = file_exists($localJs);
        $installedVersion = $isInstalled && file_exists($versionFile) ? trim((string) @file_get_contents($versionFile)) : null;

        if ($latestVersion) {
            if (isset($this->grav['session'])) {
                $this->grav['session']->modern_editor_latest_version = $latestVersion;
            }

            if ($installedVersion === $latestVersion) {
                $msg = $lang === 'it'
                    ? "La versione locale di TinyMCE è già aggiornata alla versione più recente: v{$installedVersion}!"
                    : "The local version of TinyMCE is already updated to the latest version: v{$installedVersion}!";
            } else {
                $msg = $lang === 'it'
                    ? "È disponibile un aggiornamento! Nuova versione: v{$latestVersion}. Usa il pulsante nella scheda di stato per scaricarla."
                    : "An update is available! New version: v{$latestVersion}. Use the button in the status card to download it.";
            }
            $status = 'success';
        } else {
            $msg = $lang === 'it'
                ? "Impossibile verificare gli aggiornamenti di TinyMCE in questo momento."
                : "Unable to check for TinyMCE updates at this moment.";
            $status = 'error';
        }

        // Also check the markdown helper libraries, but only when local
        // mode is active (they're irrelevant in CDN mode, so skip the
        // extra network calls in that case).
        $editorSource = $this->config->get('plugins.modern-editor.editor_source', 'local');
        if ($editorSource === 'local' && isset($this->grav['session'])) {
            $latestMarked = $this->fetchLatestNpmVersion('marked');
            $latestTurndown = $this->fetchLatestNpmVersion('turndown');
            if ($latestMarked) {
                $this->grav['session']->modern_editor_latest_marked_version = $latestMarked;
            }
            if ($latestTurndown) {
                $this->grav['session']->modern_editor_latest_turndown_version = $latestTurndown;
            }
        }

        return ['status' => $status, 'message' => $msg, 'html' => $this->getLocalStatusHtml($langOverride)];
    }

    public function removeTinyMceLocalAction(?string $langOverride = null): array
    {
        $lang = $this->getUiLanguage($langOverride);
        $pluginDir = $this->grav['locator']->findResource('plugin://' . $this->name, true, true);
        $targetDir = $pluginDir . '/assets/tinymce';
        $vendorDir = $pluginDir . '/assets/vendor';
        $errorFile = $pluginDir . '/.download-error';

        if (file_exists($errorFile)) {
            @unlink($errorFile);
        }

        if (is_dir($targetDir)) {
            $this->recursiveRmdir($targetDir);
        }

        // Also remove the self-hosted marked/turndown copies downloaded
        // alongside TinyMCE for local mode, so "remove offline files"
        // fully reverts back to CDN-only, with no orphaned assets left
        // on disk.
        if (is_dir($vendorDir)) {
            $this->recursiveRmdir($vendorDir);
        }

        return [
            'status' => 'success',
            'message' => $lang === 'it' ? "I file offline di TinyMCE sono stati rimossi con successo!" : "Offline TinyMCE files have been successfully removed!",
            'html' => $this->getLocalStatusHtml($langOverride)
        ];
    }

    public function getStatusData(?string $langOverride = null): array
    {
        $pluginDir = $this->grav['locator']->findResource('plugin://' . $this->name, true, true);
        $localJs = $pluginDir . '/assets/tinymce/tinymce.min.js';
        $versionFile = $pluginDir . '/assets/tinymce/.version';
        $errorFile = $pluginDir . '/assets/tinymce/.error';
        $isInstalled = file_exists($localJs);
        $installedVersion = $isInstalled && file_exists($versionFile) ? trim((string) @file_get_contents($versionFile)) : null;
        $hasError = file_exists($errorFile);
        $errorMessage = $hasError ? trim((string) @file_get_contents($errorFile)) : '';

        $lang = $this->getUiLanguage($langOverride);

        $latestVersion = null;
        if (isset($this->grav['session'])) {
            $latestVersion = $this->grav['session']->modern_editor_latest_version ?? null;
        }

        $adminBase = $this->getAdminBaseUrl() . '/plugins/modern-editor';

        return [
            'is_installed' => $isInstalled,
            'installed_version' => $installedVersion,
            'latest_version' => $latestVersion,
            'has_error' => $hasError,
            'error_message' => $errorMessage,
            'lang' => $lang,
            'check_url' => $adminBase . '?action=check_updates',
            'reinstall_url' => $adminBase . '?action=download_tinymce&version=7.4.0',
            'update_url_prefix' => $adminBase . '?action=download_tinymce&version=',
            'html' => $this->getLocalStatusHtml($langOverride)
        ];
    }

    public function getConfigData(?string $langOverride = null): array
    {
        // marked_url/turndown_url are included here (mirroring editor_url)
        // so the browser has a reliable fallback for these two URLs even
        // when window.__MODERN_EDITOR_MD_URLS__ never reaches the page —
        // which can happen because addInlineJs() only takes effect if the
        // current response actually renders Grav's queued assets, and
        // Admin Next's decoupled SPA shell does not always do so on every
        // route. This REST endpoint, unlike that inline script, is always
        // fetched explicitly by the field's JS (see fetchConfig()), so it
        // is a dependable second source of truth instead of the CDN
        // hardcoded fallback silently kicking in even in "local" mode.
        $mdUrls = $this->getMarkdownLibraryUrls();

        return [
            'editor_source' => $this->config->get('plugins.modern-editor.editor_source', 'local'),
            'editor_url' => $this->getEditorScriptUrl(),
            'marked_url' => $mdUrls['marked'],
            'turndown_url' => $mdUrls['turndown'],
            // Same source of truth as the inline __MODERN_EDITOR_ADMIN_LANG__
            // global — provided here too since the REST /config endpoint is
            // fetched explicitly and doesn't depend on inline JS having run.
            'lang' => $this->getUiLanguage($langOverride),
            'height' => $this->config->get('plugins.modern-editor.height'),
            'menubar' => $this->config->get('plugins.modern-editor.menubar'),
            'plugins' => $this->config->get('plugins.modern-editor.plugins'),
            'toolbar' => $this->config->get('plugins.modern-editor.toolbar'),
        ];
    }

    public function getLocalStatusHtml(?string $langOverride = null): string
    {
        $grav = Grav::instance();
        /** @var \Grav\Common\Filesystem\Locator $locator */
        $locator = $grav['locator'];

        $pluginDir = $locator->findResource('plugin://' . $this->name, true, true);
        $localJs = $pluginDir . '/assets/tinymce/tinymce.min.js';
        $versionFile = $pluginDir . '/assets/tinymce/.version';
        $errorFile = $pluginDir . '/.download-error';

        $isInstalled = file_exists($localJs);
        $installedVersion = $isInstalled && file_exists($versionFile) ? trim((string) @file_get_contents($versionFile)) : null;
        $hasError = file_exists($errorFile);
        $errorMessage = $hasError ? trim((string) @file_get_contents($errorFile)) : '';

        $lang = $this->getUiLanguage($langOverride);

        $latestVersion = null;
        if (isset($this->grav['session'])) {
            $latestVersion = $this->grav['session']->modern_editor_latest_version ?? null;
        }

        $adminBaseUrl = $this->getAdminBaseUrl() . '/plugins/modern-editor';
        $checkUrl = $adminBaseUrl . '?action=check_updates';
        $reinstallUrl = $adminBaseUrl . '?action=download_tinymce&version=7.4.0';
        $removeUrl = $adminBaseUrl . '?action=remove_tinymce_local';

        $editorSource = $this->config->get('plugins.modern-editor.editor_source', 'local');

        // Markdown helper libraries (marked/turndown) status — only
        // relevant in local mode, but computed unconditionally here since
        // it's cheap (just two file_exists() + optional file reads).
        $markedInfo = $this->getMarkdownLibraryInstallInfo('marked', 'marked.umd.js');
        $turndownInfo = $this->getMarkdownLibraryInstallInfo('turndown', 'turndown.js');
        $latestMarked = isset($this->grav['session']) ? ($this->grav['session']->modern_editor_latest_marked_version ?? null) : null;
        $latestTurndown = isset($this->grav['session']) ? ($this->grav['session']->modern_editor_latest_turndown_version ?? null) : null;

        $markedDownloadUrl = $adminBaseUrl . '?action=download_tinymce&library=marked&version=' . self::MARKED_VERSION;
        $turndownDownloadUrl = $adminBaseUrl . '?action=download_tinymce&library=turndown&version=' . self::TURNDOWN_VERSION;
        $markedUpdateUrl = $latestMarked ? ($adminBaseUrl . '?action=download_tinymce&library=marked&version=' . rawurlencode($latestMarked)) : $markedDownloadUrl;
        $turndownUpdateUrl = $latestTurndown ? ($adminBaseUrl . '?action=download_tinymce&library=turndown&version=' . rawurlencode($latestTurndown)) : $turndownDownloadUrl;

        // ✅ FIX: Escape tutte le variabili dinamiche
        $installedVersionEsc = htmlspecialchars($installedVersion ?? '', ENT_QUOTES, 'UTF-8');
        $latestVersionEsc = htmlspecialchars($latestVersion ?? '', ENT_QUOTES, 'UTF-8');
        $checkUrlEsc = htmlspecialchars($checkUrl, ENT_QUOTES, 'UTF-8');
        $reinstallUrlEsc = htmlspecialchars($reinstallUrl, ENT_QUOTES, 'UTF-8');
        $removeUrlEsc = htmlspecialchars($removeUrl, ENT_QUOTES, 'UTF-8');

        $html = "
<style>
#modern-editor-status-card .modern-editor-cdn-banner {
    border-left: 4px solid #3b82f6 !important;
    background-color: #eff6ff !important;
    color: #1e3a8a !important;
}
#modern-editor-status-card .modern-editor-local-banner {
    border-left: 4px solid #10b981 !important;
    background-color: #f0fdf4 !important;
    color: #14532d !important;
}
#modern-editor-status-card .modern-editor-error-banner {
    border-left: 4px solid #ef4444 !important;
    background-color: #fef2f2 !important;
    color: #7f1d1d !important;
}
#modern-editor-status-card .modern-editor-box {
    border: 1px solid #e4e4e7 !important;
    background-color: #fafafa !important;
    color: #3f3f46 !important;
}
#modern-editor-status-card .modern-editor-box-title {
    color: #27272a !important;
}
#modern-editor-status-card .modern-editor-inline-error {
    color: #b91c1c !important;
    background-color: #fee2e2 !important;
}

/* Media query for dark color scheme */
@media (prefers-color-scheme: dark) {
    #modern-editor-status-card .modern-editor-cdn-banner {
        background-color: #1e293b !important;
        color: #93c5fd !important;
    }
    #modern-editor-status-card .modern-editor-local-banner {
        background-color: #064e3b !important;
        color: #a7f3d0 !important;
    }
    #modern-editor-status-card .modern-editor-error-banner {
        background-color: #451212 !important;
        color: #fca5a5 !important;
    }
    #modern-editor-status-card .modern-editor-box {
        border: 1px solid #3f3f46 !important;
        background-color: #18181b !important;
        color: #a1a1aa !important;
    }
    #modern-editor-status-card .modern-editor-box-title {
        color: #f4f4f5 !important;
    }
    #modern-editor-status-card .modern-editor-inline-error {
        color: #fca5a5 !important;
        background-color: #451212 !important;
    }
}

/* Selector classes for dark-mode on html or body elements */
html.dark #modern-editor-status-card .modern-editor-cdn-banner,
html.dark-mode #modern-editor-status-card .modern-editor-cdn-banner,
html.theme-dark #modern-editor-status-card .modern-editor-cdn-banner,
body.dark #modern-editor-status-card .modern-editor-cdn-banner,
body.dark-mode #modern-editor-status-card .modern-editor-cdn-banner,
body.theme-dark #modern-editor-status-card .modern-editor-cdn-banner,
html[data-theme='dark'] #modern-editor-status-card .modern-editor-cdn-banner,
body[data-theme='dark'] #modern-editor-status-card .modern-editor-cdn-banner {
    background-color: #1e293b !important;
    color: #93c5fd !important;
}
html.dark #modern-editor-status-card .modern-editor-local-banner,
html.dark-mode #modern-editor-status-card .modern-editor-local-banner,
html.theme-dark #modern-editor-status-card .modern-editor-local-banner,
body.dark #modern-editor-status-card .modern-editor-local-banner,
body.dark-mode #modern-editor-status-card .modern-editor-local-banner,
body.theme-dark #modern-editor-status-card .modern-editor-local-banner,
html[data-theme='dark'] #modern-editor-status-card .modern-editor-local-banner,
body[data-theme='dark'] #modern-editor-status-card .modern-editor-local-banner {
    background-color: #064e3b !important;
    color: #a7f3d0 !important;
}
html.dark #modern-editor-status-card .modern-editor-error-banner,
html.dark-mode #modern-editor-status-card .modern-editor-error-banner,
html.theme-dark #modern-editor-status-card .modern-editor-error-banner,
body.dark #modern-editor-status-card .modern-editor-error-banner,
body.dark-mode #modern-editor-status-card .modern-editor-error-banner,
body.theme-dark #modern-editor-status-card .modern-editor-error-banner,
html[data-theme='dark'] #modern-editor-status-card .modern-editor-error-banner,
body[data-theme='dark'] #modern-editor-status-card .modern-editor-error-banner {
    background-color: #451212 !important;
    color: #fca5a5 !important;
}
html.dark #modern-editor-status-card .modern-editor-box,
html.dark-mode #modern-editor-status-card .modern-editor-box,
html.theme-dark #modern-editor-status-card .modern-editor-box,
body.dark #modern-editor-status-card .modern-editor-box,
body.dark-mode #modern-editor-status-card .modern-editor-box,
body.theme-dark #modern-editor-status-card .modern-editor-box,
html[data-theme='dark'] #modern-editor-status-card .modern-editor-box,
body[data-theme='dark'] #modern-editor-status-card .modern-editor-box {
    border: 1px solid #3f3f46 !important;
    background-color: #18181b !important;
    color: #a1a1aa !important;
}
html.dark #modern-editor-status-card .modern-editor-box-title,
html.dark-mode #modern-editor-status-card .modern-editor-box-title,
html.theme-dark #modern-editor-status-card .modern-editor-box-title,
body.dark #modern-editor-status-card .modern-editor-box-title,
body.dark-mode #modern-editor-status-card .modern-editor-box-title,
body.theme-dark #modern-editor-status-card .modern-editor-box-title,
html[data-theme='dark'] #modern-editor-status-card .modern-editor-box-title,
body[data-theme='dark'] #modern-editor-status-card .modern-editor-box-title {
    color: #f4f4f5 !important;
}
html.dark #modern-editor-status-card .modern-editor-inline-error,
html.dark-mode #modern-editor-status-card .modern-editor-inline-error,
html.theme-dark #modern-editor-status-card .modern-editor-inline-error,
body.dark #modern-editor-status-card .modern-editor-inline-error,
body.dark-mode #modern-editor-status-card .modern-editor-inline-error,
body.theme-dark #modern-editor-status-card .modern-editor-inline-error,
html[data-theme='dark'] #modern-editor-status-card .modern-editor-inline-error,
body[data-theme='dark'] #modern-editor-status-card .modern-editor-inline-error {
    color: #fca5a5 !important;
    background-color: #451212 !important;
}
</style>

<div id='modern-editor-status-card' style='font-family: system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, \"Helvetica Neue\", Arial, sans-serif;'>";

        if ($editorSource === 'cdn') {
            // CDN is selected
            if ($lang === 'it') {
                $html .= "<div class='notice alert modern-editor-cdn-banner' style='padding: 18px; margin-bottom: 16px; border-radius: 4px;'>";
                $html .= "<p style='margin: 0 0 8px 0; font-size: 15px; font-weight: bold;'>ℹ️ Sorgente attiva: Cloud CDN</p>";
                $html .= "<p style='margin: 0; font-size: 13.5px; line-height: 1.5;'>L'editor sta attualmente caricando TinyMCE dal server remoto CDN. La versione locale self-hosted non è in uso.</p>";
                $html .= "</div>";

                $html .= "<div class='modern-editor-box' style='padding: 18px; border-radius: 4px;'>";
                $html .= "<p class='modern-editor-box-title' style='margin: 0 0 12px 0; font-size: 14px; font-weight: bold;'>Gestione TinyMCE locale (per uso offline / self-hosted):</p>";

                if ($isInstalled) {
                    $html .= "<p style='margin: 0 0 12px 0; font-size: 13.5px;'>Stato: 🟢 <strong>Installato (v{$installedVersionEsc})</strong></p>";
                } else {
                    $html .= "<p style='margin: 0 0 12px 0; font-size: 13.5px;'>Stato: 🔴 <strong>Non installato</strong></p>";
                    if ($hasError) {
                        $html .= "<p class='modern-editor-inline-error' style='margin: 0 0 12px 0; font-size: 12.5px; padding: 8px; border-radius: 4px; font-family: monospace;'><strong>Ultimo Errore:</strong> " . htmlspecialchars($errorMessage, ENT_QUOTES, 'UTF-8') . "</p>";
                    }
                }

                if ($latestVersion) {
                    if ($isInstalled && $installedVersion !== $latestVersion) {
                        $html .= "<p style='margin: 0 0 12px 0; font-size: 13px; color: #b91c1c;'><strong>Ultima versione disponibile su NPM:</strong> v{$latestVersionEsc} (Aggiornamento disponibile! 🚀)</p>";
                    } else {
                        $html .= "<p style='margin: 0 0 12px 0; font-size: 13px; color: #166534;'><strong>Ultima versione disponibile su NPM:</strong> v{$latestVersionEsc} (La versione locale è aggiornata! ✨)</p>";
                    }
                }

                $html .= "<div style='display: flex; gap: 8px; flex-wrap: wrap; margin-top: 14px;'>";
                $html .= "<a class='button button-small' href='{$checkUrlEsc}' data-loading-text='Verifica in corso...' style='background: #4b5563; color: white; border: none; padding: 6px 12px; border-radius: 4px; text-decoration: none; display: inline-block; font-size: 13px;'>Verifica aggiornamenti</a>";

                if ($latestVersion && (!$isInstalled || $installedVersion !== $latestVersion)) {
                    $updateUrl = $this->getAdminBaseUrl() . "/plugins/modern-editor?action=download_tinymce&version={$latestVersion}";
                    $updateUrlEsc = htmlspecialchars($updateUrl, ENT_QUOTES, 'UTF-8');
                    $html .= "<a class='button button-small' href='{$updateUrlEsc}' data-loading-text='Scaricamento in corso...' style='background: #2563eb; color: white; border: none; padding: 6px 12px; border-radius: 4px; text-decoration: none; display: inline-block; font-size: 13px; font-weight: bold;'>Scarica v{$latestVersionEsc}</a>";
                } else {
                    $html .= "<a class='button button-small' href='{$reinstallUrlEsc}' data-loading-text='Scaricamento in corso...' style='background: #9ca3af; color: #1f2937; border: 1px solid #d1d5db; padding: 6px 12px; border-radius: 4px; text-decoration: none; display: inline-block; font-size: 13px;'>Scarica v7.4.0 (Predefinita)</a>";
                }

                if ($isInstalled) {
                    $html .= "<a class='button button-small' href='{$removeUrlEsc}' data-loading-text='Rimozione...' style='background: #dc2626; color: white; border: none; padding: 6px 12px; border-radius: 4px; text-decoration: none; display: inline-block; font-size: 13px;'>Rimuovi file offline</a>";
                }

                $html .= "</div>";
                $html .= "</div>";
            } else {
                $html .= "<div class='notice alert modern-editor-cdn-banner' style='padding: 18px; margin-bottom: 16px; border-radius: 4px;'>";
                $html .= "<p style='margin: 0 0 8px 0; font-size: 15px; font-weight: bold;'>ℹ️ Active Source: Cloud CDN</p>";
                $html .= "<p style='margin: 0; font-size: 13.5px; line-height: 1.5;'>The editor is currently loading TinyMCE from the remote CDN. The local self-hosted version is inactive.</p>";
                $html .= "</div>";

                $html .= "<div class='modern-editor-box' style='padding: 18px; border-radius: 4px;'>";
                $html .= "<p class='modern-editor-box-title' style='margin: 0 0 12px 0; font-size: 14px; font-weight: bold;'>Local TinyMCE Management (for offline / self-hosted use):</p>";

                if ($isInstalled) {
                    $html .= "<p style='margin: 0 0 12px 0; font-size: 13.5px;'>Status: 🟢 <strong>Installed (v{$installedVersionEsc})</strong></p>";
                } else {
                    $html .= "<p style='margin: 0 0 12px 0; font-size: 13.5px;'>Status: 🔴 <strong>Not installed</strong></p>";
                    if ($hasError) {
                        $html .= "<p class='modern-editor-inline-error' style='margin: 0 0 12px 0; font-size: 12.5px; padding: 8px; border-radius: 4px; font-family: monospace;'><strong>Last Error:</strong> " . htmlspecialchars($errorMessage, ENT_QUOTES, 'UTF-8') . "</p>";
                    }
                }

                if ($latestVersion) {
                    if ($isInstalled && $installedVersion !== $latestVersion) {
                        $html .= "<p style='margin: 0 0 12px 0; font-size: 13px; color: #b91c1c;'><strong>Latest version available on NPM:</strong> v{$latestVersionEsc} (Update available! 🚀)</p>";
                    } else {
                        $html .= "<p style='margin: 0 0 12px 0; font-size: 13px; color: #166534;'><strong>Latest version available on NPM:</strong> v{$latestVersionEsc} (Up to date! ✨)</p>";
                    }
                }

                $html .= "<div style='display: flex; gap: 8px; flex-wrap: wrap; margin-top: 14px;'>";
                $html .= "<a class='button button-small' href='{$checkUrlEsc}' data-loading-text='Checking...' style='background: #4b5563; color: white; border: none; padding: 6px 12px; border-radius: 4px; text-decoration: none; display: inline-block; font-size: 13px;'>Check for Updates</a>";

                if ($latestVersion && (!$isInstalled || $installedVersion !== $latestVersion)) {
                    $updateUrl = $this->getAdminBaseUrl() . "/plugins/modern-editor?action=download_tinymce&version={$latestVersion}";
                    $updateUrlEsc = htmlspecialchars($updateUrl, ENT_QUOTES, 'UTF-8');
                    $html .= "<a class='button button-small' href='{$updateUrlEsc}' data-loading-text='Downloading...' style='background: #2563eb; color: white; border: none; padding: 6px 12px; border-radius: 4px; text-decoration: none; display: inline-block; font-size: 13px; font-weight: bold;'>Download v{$latestVersionEsc}</a>";
                } else {
                    $html .= "<a class='button button-small' href='{$reinstallUrlEsc}' data-loading-text='Downloading...' style='background: #9ca3af; color: #1f2937; border: 1px solid #d1d5db; padding: 6px 12px; border-radius: 4px; text-decoration: none; display: inline-block; font-size: 13px;'>Download v7.4.0 (Default)</a>";
                }

                if ($isInstalled) {
                    $html .= "<a class='button button-small' href='{$removeUrlEsc}' data-loading-text='Removing...' style='background: #dc2626; color: white; border: none; padding: 6px 12px; border-radius: 4px; text-decoration: none; display: inline-block; font-size: 13px;'>Remove offline files</a>";
                }

                $html .= "</div>";
                $html .= "</div>";
            }
        } else {
            // Local is selected
            if ($isInstalled) {
                $versionStr = "v{$installedVersionEsc}";

                if ($lang === 'it') {
                    $html .= "<div class='notice alert modern-editor-local-banner' style='padding: 18px; margin-bottom: 12px; border-radius: 4px;'>";
                    $html .= "<p style='margin: 0 0 10px 0; font-size: 15px; font-weight: bold;'>🟢 Sorgente attiva: Local (Self-hosted)</p>";
                    $html .= "<p style='margin: 0 0 12px 0; font-size: 13.5px; line-height: 1.5;'>L'editor sta caricando TinyMCE dal tuo server locale offline.</p>";

                    $html .= "<div style='margin-bottom: 14px; font-size: 13px; line-height: 1.5;'>";
                    $html .= "<div style='margin-bottom: 4px;'><strong>Versione locale installata:</strong> {$versionStr}</div>";

                    if ($latestVersion) {
                        if ($installedVersion !== $latestVersion) {
                            $html .= "<div style='margin-bottom: 4px; color: #b91c1c;'><strong>Ultima versione disponibile:</strong> v{$latestVersionEsc} (Aggiornamento disponibile! 🚀)</div>";
                        } else {
                            $html .= "<div style='margin-bottom: 4px; color: #166534;'><strong>Ultima versione disponibile:</strong> v{$latestVersionEsc} (La versione locale è aggiornata! ✨)</div>";
                        }
                    }

                    $html .= "</div>";

                    $html .= "<div style='display: flex; gap: 8px; flex-wrap: wrap;'>";
                    $html .= "<a class='button button-small' href='{$checkUrlEsc}' data-loading-text='Verifica in corso...' style='background: #4b5563; color: white; border: none; padding: 6px 12px; border-radius: 4px; text-decoration: none; display: inline-block; font-size: 13px;'>Verifica aggiornamenti</a>";

                    if ($latestVersion && $installedVersion !== $latestVersion) {
                        $updateUrl = $this->getAdminBaseUrl() . "/plugins/modern-editor?action=download_tinymce&version={$latestVersion}";
                        $updateUrlEsc = htmlspecialchars($updateUrl, ENT_QUOTES, 'UTF-8');
                        $html .= "<a class='button button-small' href='{$updateUrlEsc}' data-loading-text='Aggiornamento in corso...' style='background: #2563eb; color: white; border: none; padding: 6px 12px; border-radius: 4px; text-decoration: none; display: inline-block; font-size: 13px; font-weight: bold;'>Aggiorna a v{$latestVersionEsc}</a>";
                    }

                    $html .= "<a class='button button-small' href='{$reinstallUrlEsc}' data-loading-text='Reinstallazione...' style='background: #9ca3af; color: #1f2937; border: 1px solid #d1d5db; padding: 6px 12px; border-radius: 4px; text-decoration: none; display: inline-block; font-size: 13px;'>Reinstalla versione predefinita (v7.4.0)</a>";
                    $html .= "<span style='background: #e2e8f0; color: #94a3b8; border: none; padding: 6px 12px; border-radius: 4px; display: inline-block; font-size: 13px; cursor: not-allowed; pointer-events: none;' title='Seleziona Cloud CDN nelle impostazioni in alto per poter rimuovere i file offline.'>Rimuovi file offline (Disattivato)</span>";
                    $html .= "</div>";
                    $html .= "</div>";
                } else {
                    $html .= "<div class='notice alert modern-editor-local-banner' style='padding: 18px; margin-bottom: 12px; border-radius: 4px;'>";
                    $html .= "<p style='margin: 0 0 10px 0; font-size: 15px; font-weight: bold;'>🟢 Active Source: Local (Self-hosted)</p>";
                    $html .= "<p style='margin: 0 0 12px 0; font-size: 13.5px; line-height: 1.5;'>The editor is loading TinyMCE from your local offline server.</p>";

                    $html .= "<div style='margin-bottom: 14px; font-size: 13px; line-height: 1.5;'>";
                    $html .= "<div style='margin-bottom: 4px;'><strong>Installed Local Version:</strong> {$versionStr}</div>";

                    if ($latestVersion) {
                        if ($installedVersion !== $latestVersion) {
                            $html .= "<div style='margin-bottom: 4px; color: #b91c1c;'><strong>Latest Version Available:</strong> v{$latestVersionEsc} (Update available! 🚀)</div>";
                        } else {
                            $html .= "<div style='margin-bottom: 4px; color: #166534;'><strong>Latest Version Available:</strong> v{$latestVersionEsc} (Up to date! ✨)</div>";
                        }
                    }

                    $html .= "</div>";

                    $html .= "<div style='display: flex; gap: 8px; flex-wrap: wrap;'>";
                    $html .= "<a class='button button-small' href='{$checkUrlEsc}' data-loading-text='Checking...' style='background: #4b5563; color: white; border: none; padding: 6px 12px; border-radius: 4px; text-decoration: none; display: inline-block; font-size: 13px;'>Check for Updates</a>";

                    if ($latestVersion && $installedVersion !== $latestVersion) {
                        $updateUrl = $this->getAdminBaseUrl() . "/plugins/modern-editor?action=download_tinymce&version={$latestVersion}";
                        $updateUrlEsc = htmlspecialchars($updateUrl, ENT_QUOTES, 'UTF-8');
                        $html .= "<a class='button button-small' href='{$updateUrlEsc}' data-loading-text='Updating...' style='background: #2563eb; color: white; border: none; padding: 6px 12px; border-radius: 4px; text-decoration: none; display: inline-block; font-size: 13px; font-weight: bold;'>Update to v{$latestVersionEsc}</a>";
                    }

                    $html .= "<a class='button button-small' href='{$reinstallUrlEsc}' data-loading-text='Reinstalling...' style='background: #9ca3af; color: #1f2937; border: 1px solid #d1d5db; padding: 6px 12px; border-radius: 4px; text-decoration: none; display: inline-block; font-size: 13px;'>Reinstall Default (v7.4.0)</a>";
                    $html .= "<span style='background: #e2e8f0; color: #94a3b8; border: none; padding: 6px 12px; border-radius: 4px; display: inline-block; font-size: 13px; cursor: not-allowed; pointer-events: none;' title='Select Cloud CDN in the settings above to be able to remove offline files.'>Remove offline files (Disabled)</span>";
                    $html .= "</div>";
                    $html .= "</div>";
                }
            } else {
                if ($lang === 'it') {
                    $html .= "<div class='notice alert modern-editor-error-banner' style='padding: 18px; margin-bottom: 12px; border-radius: 4px;'>";
                    $html .= "<p style='margin: 0 0 10px 0; font-size: 15px; font-weight: bold;'>🔴 Sorgente attiva: Local (Self-hosted) - Richiede scaricamento</p>";
                    $html .= "<p style='margin: 0 0 14px 0; font-size: 13.5px; line-height: 1.5;'>L'editor è configurato per l'hosting locale, ma TinyMCE non è ancora presente sul server. Scarica la versione locale predefinita qui sotto per attivare l'editor.</p>";

                    if ($hasError) {
                        $html .= "<p class='modern-editor-inline-error' style='margin: 0 0 14px 0; font-size: 12.5px; padding: 8px; border-radius: 4px; font-family: monospace;'><strong>Ultimo Errore:</strong> " . htmlspecialchars($errorMessage, ENT_QUOTES, 'UTF-8') . "</p>";
                    }

                    $html .= "<div style='display: flex; gap: 8px; flex-wrap: wrap;'>";
                    $html .= "<a class='button button-small' href='{$reinstallUrlEsc}' data-loading-text='Scaricamento in corso...' style='background: #dc2626; color: white; border: none; padding: 6px 12px; border-radius: 4px; text-decoration: none; display: inline-block; font-size: 13px; font-weight: bold;'>Scarica v7.4.0 (Predefinita)</a>";
                    $html .= "<a class='button button-small' href='{$checkUrlEsc}' data-loading-text='Verifica in corso...' style='background: #4b5563; color: white; border: none; padding: 6px 12px; border-radius: 4px; text-decoration: none; display: inline-block; font-size: 13px;'>Controlla versione disponibile</a>";
                    $html .= "</div>";
                    $html .= "</div>";
                } else {
                    $html .= "<div class='notice alert modern-editor-error-banner' style='padding: 18px; margin-bottom: 12px; border-radius: 4px;'>";
                    $html .= "<p style='margin: 0 0 10px 0; font-size: 15px; font-weight: bold;'>🔴 Active Source: Local (Self-hosted) - Download Required</p>";
                    $html .= "<p style='margin: 0 0 14px 0; font-size: 13.5px; line-height: 1.5;'>The editor is configured to load locally, but TinyMCE assets are not yet present on your server. Download the default local version below to activate the editor.</p>";

                    if ($hasError) {
                        $html .= "<p class='modern-editor-inline-error' style='margin: 0 0 14px 0; font-size: 12.5px; padding: 8px; border-radius: 4px; font-family: monospace;'><strong>Last Error:</strong> " . htmlspecialchars($errorMessage, ENT_QUOTES, 'UTF-8') . "</p>";
                    }

                    $html .= "<div style='display: flex; gap: 8px; flex-wrap: wrap;'>";
                    $html .= "<a class='button button-small' href='{$reinstallUrlEsc}' data-loading-text='Downloading...' style='background: #dc2626; color: white; border: none; padding: 6px 12px; border-radius: 4px; text-decoration: none; display: inline-block; font-size: 13px; font-weight: bold;'>Download v7.4.0 (Default)</a>";
                    $html .= "<a class='button button-small' href='{$checkUrlEsc}' data-loading-text='Checking...' style='background: #4b5563; color: white; border: none; padding: 6px 12px; border-radius: 4px; text-decoration: none; display: inline-block; font-size: 13px;'>Check Available Version</a>";
                    $html .= "</div>";
                    $html .= "</div>";
                }
            }
        }

        if ($editorSource === 'local') {
            $markedVerEsc = htmlspecialchars($markedInfo['version'] ?? '', ENT_QUOTES, 'UTF-8');
            $turndownVerEsc = htmlspecialchars($turndownInfo['version'] ?? '', ENT_QUOTES, 'UTF-8');
            $latestMarkedEsc = htmlspecialchars($latestMarked ?? '', ENT_QUOTES, 'UTF-8');
            $latestTurndownEsc = htmlspecialchars($latestTurndown ?? '', ENT_QUOTES, 'UTF-8');
            $markedDownloadUrlEsc = htmlspecialchars($markedDownloadUrl, ENT_QUOTES, 'UTF-8');
            $turndownDownloadUrlEsc = htmlspecialchars($turndownDownloadUrl, ENT_QUOTES, 'UTF-8');
            $markedUpdateUrlEsc = htmlspecialchars($markedUpdateUrl, ENT_QUOTES, 'UTF-8');
            $turndownUpdateUrlEsc = htmlspecialchars($turndownUpdateUrl, ENT_QUOTES, 'UTF-8');

            $mdTitle = $lang === 'it' ? 'Librerie Markdown (marked / turndown)' : 'Markdown libraries (marked / turndown)';
            $mdIntro = $lang === 'it'
                ? "Usate per la conversione markdown ↔ HTML nell'editor. Se non ancora installate, il plugin le carica temporaneamente dalla CDN jsDelivr finché non vengono scaricate qui sotto."
                : "Used for markdown ↔ HTML conversion in the editor. Until downloaded below, the plugin temporarily loads them from the jsDelivr CDN.";

            $html .= "<div class='modern-editor-box' style='padding: 14px 18px; border-radius: 4px; margin-top: 12px;'>";
            $html .= "<p class='modern-editor-box-title' style='margin: 0 0 4px 0; font-size: 14px; font-weight: bold;'>{$mdTitle}</p>";
            $html .= "<p style='margin: 0 0 12px 0; font-size: 12.5px; line-height: 1.4;'>{$mdIntro}</p>";

            foreach ([
                ['name' => 'marked', 'info' => $markedInfo, 'latestEsc' => $latestMarkedEsc, 'verEsc' => $markedVerEsc, 'downloadUrl' => $markedDownloadUrlEsc, 'updateUrl' => $markedUpdateUrlEsc, 'pinned' => self::MARKED_VERSION],
                ['name' => 'turndown', 'info' => $turndownInfo, 'latestEsc' => $latestTurndownEsc, 'verEsc' => $turndownVerEsc, 'downloadUrl' => $turndownDownloadUrlEsc, 'updateUrl' => $turndownUpdateUrlEsc, 'pinned' => self::TURNDOWN_VERSION],
            ] as $lib) {
                $isInstalled = $lib['info']['installed'];
                $hasLibError = !empty($lib['info']['error']);

                $html .= "<div style='display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 8px 0; border-top: 1px solid rgba(127,127,127,0.15);'>";
                $html .= "<div style='font-size: 13px;'>";
                $html .= "<strong>{$lib['name']}</strong> — ";

                if ($isInstalled) {
                    $statusLabel = $lang === 'it' ? "installata, self-hosted, v{$lib['verEsc']}" : "installed locally, v{$lib['verEsc']}";
                    $html .= "<span style='color: #059669;'>✅ {$statusLabel}</span>";
                    if ($lib['latestEsc'] !== '' && $lib['latestEsc'] !== $lib['verEsc']) {
                        $availableLabel = $lang === 'it' ? "aggiornamento disponibile: v{$lib['latestEsc']}" : "update available: v{$lib['latestEsc']}";
                        $html .= " <span style='color: #b45309;'>({$availableLabel})</span>";
                    }
                } else {
                    $notInstalledLabel = $lang === 'it' ? 'non installata — in uso da CDN' : 'not installed — currently loaded from CDN';
                    $html .= "<span style='color: #b45309;'>⚠️ {$notInstalledLabel}</span>";
                }

                if ($hasLibError) {
                    $html .= "<div class='modern-editor-inline-error' style='margin-top: 6px; font-size: 11.5px; padding: 6px; border-radius: 4px; font-family: monospace;'>" . htmlspecialchars($lib['info']['error'], ENT_QUOTES, 'UTF-8') . "</div>";
                }
                $html .= "</div>";

                $html .= "<div style='display: flex; gap: 6px; flex-shrink: 0;'>";
                if (!$isInstalled) {
                    $downloadLabel = $lang === 'it' ? "Scarica v{$lib['pinned']}" : "Download v{$lib['pinned']}";
                    $html .= "<a class='button button-small' href='{$lib['downloadUrl']}' data-loading-text='...' style='background: #2563eb; color: white; border: none; padding: 5px 10px; border-radius: 4px; text-decoration: none; font-size: 12px;'>{$downloadLabel}</a>";
                } elseif ($lib['latestEsc'] !== '' && $lib['latestEsc'] !== $lib['verEsc']) {
                    $updateLabel = $lang === 'it' ? "Aggiorna a v{$lib['latestEsc']}" : "Update to v{$lib['latestEsc']}";
                    $html .= "<a class='button button-small' href='{$lib['updateUrl']}' data-loading-text='...' style='background: #059669; color: white; border: none; padding: 5px 10px; border-radius: 4px; text-decoration: none; font-size: 12px;'>{$updateLabel}</a>";
                }
                $html .= "</div>";
                $html .= "</div>";
            }

            $html .= "</div>";
        }

        $html .= "</div>";
        $langJs = $lang === 'it' ? 'true' : 'false';
        $html .= "
<script>
(function() {
    function initModernEditorStatusCard() {
        const card = document.getElementById('modern-editor-status-card');
        if (!card) return;

        card.querySelectorAll('a.button-small').forEach(btn => {
            // Prevent multiple binding
            if (btn.getAttribute('data-ajax-bound') === 'true') return;
            btn.setAttribute('data-ajax-bound', 'true');

            btn.addEventListener('click', function(e) {
                e.preventDefault();

                const url = this.getAttribute('href');
                if (!url) return;

                const originalText = this.innerHTML;
                const loadingText = this.getAttribute('data-loading-text') || 'Attendi...';

                this.innerHTML = '<span style=\"display:inline-block;animation:modern_editor_spin 1s linear infinite;margin-right:6px;\">⌛</span> ' + loadingText;
                this.style.pointerEvents = 'none';
                this.style.opacity = '0.75';

                // Add ajax=1 query parameter
                const ajaxUrl = url + (url.indexOf('?') !== -1 ? '&ajax=1' : '?ajax=1');

                fetch(ajaxUrl)
                    .then(response => {
                        if (!response.ok) throw new Error('HTTP error ' + response.status);
                        return response.json();
                    })
                    .then(data => {
                        if (data.message) {
                            alert(data.message);
                        }

                        if (data.html) {
                            // Find the container parent and replace card HTML
                            const parent = card.parentNode;
                            if (parent) {
                                const parser = new DOMParser();
                                const doc = parser.parseFromString(data.html, 'text/html');
                                const newCard = doc.getElementById('modern-editor-status-card');

                                if (newCard) {
                                    card.innerHTML = newCard.innerHTML;
                                    // Remove bound flags so we can re-initialize properly
                                    card.querySelectorAll('a.button-small').forEach(b => b.removeAttribute('data-ajax-bound'));
                                    initModernEditorStatusCard();
                                } else {
                                    window.location.reload();
                                }
                            } else {
                                window.location.reload();
                            }
                        } else {
                            window.location.reload();
                        }
                    })
                    .catch(err => {
                        console.error('Modern Editor status action failed:', err);
                        alert('" . ($lang === 'it' ? "Errore durante l'esecuzione dell'operazione: " : "Error executing operation: ") . "' + err.message);
                        this.innerHTML = originalText;
                        this.style.pointerEvents = 'auto';
                        this.style.opacity = '1';
                        this.removeAttribute('data-ajax-bound');
                    });
            });
        });

        // Listen for source changes on the admin form
        const sourceInputs = document.querySelectorAll('input[name*=\"editor_source\"], select[name*=\"editor_source\"]');
        sourceInputs.forEach(input => {
            if (input.getAttribute('data-source-bound') === 'true') return;
            input.setAttribute('data-source-bound', 'true');

            input.addEventListener('change', function() {
                let notice = card.querySelector('.modern-editor-save-notice');
                if (!notice) {
                    notice = document.createElement('div');
                    notice.className = 'notice alert modern-editor-save-notice';
                    notice.style.borderLeft = '4px solid #3b82f6';
                    notice.style.backgroundColor = '#eff6ff';
                    notice.style.color = '#1e3a8a';
                    notice.style.padding = '14px';
                    notice.style.marginBottom = '16px';
                    notice.style.borderRadius = '4px';
                    notice.style.fontSize = '13.5px';
                    notice.style.lineHeight = '1.5';
                    notice.style.fontWeight = '500';

                    card.insertBefore(notice, card.firstChild);

                    const style = document.createElement('style');
                    style.innerHTML = '@media (prefers-color-scheme: dark) { #modern-editor-status-card .modern-editor-save-notice { background-color: #1e3a8a !important; color: #eff6ff !important; } } html.dark #modern-editor-status-card .modern-editor-save-notice, html.dark-mode #modern-editor-status-card .modern-editor-save-notice, html.theme-dark #modern-editor-status-card .modern-editor-save-notice, body.dark #modern-editor-status-card .modern-editor-save-notice, body.dark-mode #modern-editor-status-card .modern-editor-save-notice, body.theme-dark #modern-editor-status-card .modern-editor-save-notice { background-color: #1e3a8a !important; color: #eff6ff !important; }';
                    document.head.appendChild(style);
                }

                const isIt = document.documentElement.lang === 'it' || window.navigator.language.startsWith('it') || navigator.language.startsWith('it') || " . $langJs . ";
                notice.innerHTML = isIt
                    ? '🔄 <strong>Salvataggio in corso...</strong> La pagina si ricaricherà automaticamente per aggiornare lo stato e i banner.'
                    : '🔄 <strong>Saving settings...</strong> The page will reload automatically to update status and banners.';

                setTimeout(() => {
                    const saveBtn = document.querySelector('#and-save, .and-save-button, button[type=\"submit\"], .button.save, [data-key=\"s\"]');
                    if (saveBtn) {
                        saveBtn.click();
                    } else {
                        window.location.reload();
                    }
                }, 800);
            });
        });
    }

    // Inject keyframes style once if not already present
    if (!document.getElementById('modern-editor-status-styles')) {
        const style = document.createElement('style');
        style.id = 'modern-editor-status-styles';
        style.innerHTML = '@keyframes modern_editor_spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }';
        document.head.appendChild(style);
    }

    // Run initialization
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initModernEditorStatusCard);
    } else {
        initModernEditorStatusCard();
    }
})();
</script>
";

        return $html;
    }

    /*
     * Downloads and extracts TinyMCE of the specified version.
     */
    private function downloadAndExtractTinyMCE(string $version): bool
    {
        $grav = Grav::instance();
        /** @var \Grav\Common\Filesystem\Locator $locator */
        $locator = $grav['locator'];

        $pluginDir = $locator->findResource('plugin://' . $this->name, true, true);
        $assetsDir = $pluginDir . '/assets';
        $targetDir = $assetsDir . '/tinymce';
        $errorFile = $pluginDir . '/.download-error';

        // Clean up any previous error file
        if (file_exists($errorFile)) {
            @unlink($errorFile);
        }

        // Create assets directory if missing
        if (!is_dir($assetsDir)) {
            @mkdir($assetsDir, 0775, true);
        }

        // NOTE: Tiny's old direct-download URL for the self-hosted
        // community zip (download.tiny.cloud/tinymce/community/...) now
        // sits behind an account-gated download portal and is no longer
        // reliable for newer releases (e.g. TinyMCE 8.x), which is why
        // requesting an 8.x version could silently fail while older
        // cached/previously-downloaded 7.x assets stayed in place. The
        // npm registry, which we already query for the latest version
        // number, publishes a stable tarball URL for every version ever
        // released — including 8.x — so we download from there instead.
        $url = "https://registry.npmjs.org/tinymce/-/tinymce-{$version}.tgz";
        $tempBase = tempnam(sys_get_temp_dir(), 'tinymce_pkg_');
        $tempZip = $tempBase . '.tar.gz';
        @unlink($tempBase); // tempnam() already created an empty placeholder file we don't need

        $data = null;
        $httpCode = 0;
        $downloadError = '';

        if (function_exists('curl_init')) {
            $ch = curl_init();
            curl_setopt($ch, CURLOPT_URL, $url);
            curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
            curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
            
            // ✅ FIX CRITICO: Abilita verifica SSL
            curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, true);
            curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, 2);
            
            curl_setopt($ch, CURLOPT_TIMEOUT, 60);

            $data = curl_exec($ch);
            $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);

            if ($data === false) {
                $downloadError = 'Curl error: ' . curl_error($ch);
            }

            curl_close($ch);
        }

        if (!$data) {
            // Fallback to file_get_contents if curl fails or is disabled
            // ✅ FIX CRITICO: Abilita verifica SSL
            $context = stream_context_create([
                'ssl' => [
                    'verify_peer' => true,
                    'verify_peer_name' => true,
                ],
                'http' => [
                    'timeout' => 60,
                    'follow_location' => 1
                ]
            ]);

            $data = @file_get_contents($url, false, $context);
            if ($data) {
                $httpCode = 200;
            } else {
                $lastError = error_get_last();
                $downloadError .= ' | file_get_contents error: ' . ($lastError['message'] ?? 'Unknown stream error');
            }
        }

        if ($httpCode !== 200 || !$data) {
            $errMsg = "Failed to download TinyMCE v{$version} from {$url} (HTTP {$httpCode}). Error details: " . trim($downloadError, ' |');
            if ($this->grav['admin'] ?? null) {
                $this->grav['admin']->setMessage($errMsg, 'error');
            }
            @file_put_contents($errorFile, $errMsg);
            @unlink($tempZip);
            return false;
        }

        @file_put_contents($tempZip, $data);

        // ⚠️ CLEANUP: removed a dead/misleading "if (!class_exists('ZipArchive'))"
        // check that used to sit here. Leftover from an older approach; nothing
        // in this method ever uses ZipArchive (npm's tinymce-{version}.tgz is a
        // gzipped tarball, extracted below via PharData). Keeping it only meant
        // this could fail the update on servers that simply don't have the
        // optional zip extension enabled, even though it isn't actually needed.

        // Extract (npm packages tinymce-{version}.tgz are gzipped tarballs)
        if (!class_exists('PharData') || !extension_loaded('zlib')) {
            $errMsg = "PHP's Phar and zlib extensions are required to extract the downloaded package.";
            if ($this->grav['admin'] ?? null) {
                $this->grav['admin']->setMessage($errMsg, 'error');
            }
            @file_put_contents($errorFile, $errMsg);
            @unlink($tempZip);
            return false;
        }

        $tempExtractDir = sys_get_temp_dir() . '/tinymce_extract_' . uniqid();
        @mkdir($tempExtractDir, 0775, true);
        $tempTar = substr($tempZip, 0, -3); // strip trailing ".gz", PharData::decompress() writes here

        try {
            $phar = new \PharData($tempZip);
            $phar->decompress(); // produces $tempTar (the .tar.gz -> .tar sibling file)
            (new \PharData($tempTar))->extractTo($tempExtractDir, null, true);
        } catch (\Exception $e) {
            $errMsg = "Failed to extract downloaded package: " . $e->getMessage();
            if ($this->grav['admin'] ?? null) {
                $this->grav['admin']->setMessage($errMsg, 'error');
            }
            @file_put_contents($errorFile, $errMsg);
            @unlink($tempZip);
            @unlink($tempTar);
            $this->recursiveRmdir($tempExtractDir);
            return false;
        }

        @unlink($tempZip);
        @unlink($tempTar);

        // Locate tinymce.min.js inside extracted directory
        $sourceDir = $this->findTinyMCEJsFolder($tempExtractDir);
        if (!$sourceDir) {
            $errMsg = "Could not find tinymce.min.js inside the downloaded package.";
            if ($this->grav['admin'] ?? null) {
                $this->grav['admin']->setMessage($errMsg, 'error');
            }
            @file_put_contents($errorFile, $errMsg);
            $this->recursiveRmdir($tempExtractDir);
            return false;
        }

        // Clean up old target directory if exists
        if (is_dir($targetDir)) {
            $this->recursiveRmdir($targetDir);
        }

        @mkdir($targetDir, 0775, true);

        // Copy extracted files to target directory
        $this->recursiveCopy($sourceDir, $targetDir);

        // Clean up temp extract dir
        $this->recursiveRmdir($tempExtractDir);

        // Save version file
        @file_put_contents($targetDir . '/.version', $version);

        return true;
    }

    /*
     * Recursively find the directory containing 'tinymce.min.js'
     */
    private function findTinyMCEJsFolder(string $dir): ?string
    {
        $it = new \RecursiveDirectoryIterator($dir);
        $it = new \RecursiveIteratorIterator($it);

        foreach ($it as $file) {
            if ($file->isFile() && $file->getFilename() === 'tinymce.min.js') {
                return dirname($file->getRealPath());
            }
        }

        return null;
    }

    /*
     * Recursively finds the first file matching the given filename inside
     * a directory tree. Used to locate the built browser file inside an
     * extracted npm package (marked/turndown), whose internal folder
     * layout we don't need to hardcode beyond the final filename.
     */
    private function findFileInDir(string $dir, string $filename): ?string
    {
        if (!is_dir($dir)) {
            return null;
        }

        $it = new \RecursiveDirectoryIterator($dir);
        $it = new \RecursiveIteratorIterator($it);

        foreach ($it as $file) {
            if ($file->isFile() && $file->getFilename() === $filename) {
                return $file->getRealPath();
            }
        }

        return null;
    }

    /*
     * Downloads a single built browser file (e.g. marked.umd.js,
     * turndown.js) out of an npm package tarball and installs it into
     * assets/vendor/, alongside a small ".<package>-version" marker file.
     * Mirrors downloadAndExtractTinyMCE()'s approach (npm registry tarball
     * + PharData extraction) but only needs one file out of the package,
     * not the whole dist folder.
     */
    private function downloadNpmBrowserFile(string $package, string $version, string $filename): bool
    {
        $grav = Grav::instance();
        /** @var \Grav\Common\Filesystem\Locator $locator */
        $locator = $grav['locator'];

        $pluginDir = $locator->findResource('plugin://' . $this->name, true, true);
        $vendorDir = $pluginDir . '/assets/vendor';
        $errorFile = $vendorDir . '/.error';

        if (!is_dir($vendorDir)) {
            @mkdir($vendorDir, 0775, true);
        }

        $url = "https://registry.npmjs.org/{$package}/-/{$package}-{$version}.tgz";
        $tempBase = tempnam(sys_get_temp_dir(), 'npmasset_pkg_');
        $tempZip = $tempBase . '.tar.gz';
        @unlink($tempBase);

        $data = null;
        $httpCode = 0;
        $downloadError = '';

        if (function_exists('curl_init')) {
            $ch = curl_init();
            curl_setopt($ch, CURLOPT_URL, $url);
            curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
            curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
            curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, true);
            curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, 2);
            curl_setopt($ch, CURLOPT_TIMEOUT, 60);

            $data = curl_exec($ch);
            $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);

            if ($data === false) {
                $downloadError = 'Curl error: ' . curl_error($ch);
            }

            curl_close($ch);
        }

        if (!$data) {
            $context = stream_context_create([
                'ssl' => ['verify_peer' => true, 'verify_peer_name' => true],
                'http' => ['timeout' => 60, 'follow_location' => 1],
            ]);

            $data = @file_get_contents($url, false, $context);
            if ($data) {
                $httpCode = 200;
            } else {
                $lastError = error_get_last();
                $downloadError .= ' | file_get_contents error: ' . ($lastError['message'] ?? 'Unknown stream error');
            }
        }

        if ($httpCode !== 200 || !$data) {
            $errMsg = "Failed to download {$package}@{$version} from {$url} (HTTP {$httpCode}). Error details: " . trim($downloadError, ' |');
            if ($this->grav['admin'] ?? null) {
                $this->grav['admin']->setMessage($errMsg, 'error');
            }
            @file_put_contents($errorFile, $errMsg);
            @unlink($tempZip);
            return false;
        }

        @file_put_contents($tempZip, $data);

        if (!class_exists('PharData') || !extension_loaded('zlib')) {
            @file_put_contents($errorFile, "PHP's Phar and zlib extensions are required to extract {$package}.");
            @unlink($tempZip);
            return false;
        }

        $tempExtractDir = sys_get_temp_dir() . '/npmasset_extract_' . uniqid();
        @mkdir($tempExtractDir, 0775, true);
        $tempTar = substr($tempZip, 0, -3);

        try {
            $phar = new \PharData($tempZip);
            $phar->decompress();
            (new \PharData($tempTar))->extractTo($tempExtractDir, null, true);
        } catch (\Exception $e) {
            @file_put_contents($errorFile, "Failed to extract {$package}@{$version}: " . $e->getMessage());
            @unlink($tempZip);
            @unlink($tempTar);
            $this->recursiveRmdir($tempExtractDir);
            return false;
        }

        @unlink($tempZip);
        @unlink($tempTar);

        $sourceFile = $this->findFileInDir($tempExtractDir, $filename);
        if (!$sourceFile) {
            @file_put_contents($errorFile, "Could not find {$filename} inside the downloaded {$package}@{$version} package.");
            $this->recursiveRmdir($tempExtractDir);
            return false;
        }

        copy($sourceFile, $vendorDir . '/' . $filename);
        @file_put_contents($vendorDir . '/.' . $package . '-version', $version);

        $this->recursiveRmdir($tempExtractDir);

        if (file_exists($errorFile)) {
            @unlink($errorFile);
        }

        return true;
    }

    /*
     * Downloads and self-hosts both markdown helper libraries
     * (marked.umd.js, turndown.js) into assets/vendor/. Both are MIT
     * licensed, so self-hosting is not a licensing concern; only
     * TinyMCE's own licensing required special handling (see README).
     */
    private function downloadMarkdownLibraries(): bool
    {
        $markedOk = $this->downloadNpmBrowserFile('marked', self::MARKED_VERSION, 'marked.umd.js');
        $turndownOk = $this->downloadNpmBrowserFile('turndown', self::TURNDOWN_VERSION, 'turndown.js');

        return $markedOk && $turndownOk;
    }

    /*
     * Returns the URLs the admin browser should load marked/turndown
     * from: self-hosted (with a version cache-buster) if editor_source is
     * "local" and the files are present, otherwise the jsDelivr CDN —
     * exactly mirroring getEditorScriptUrl()'s cdn/local logic for
     * TinyMCE itself.
     */
    public function getMarkdownLibraryUrls(): array
    {
        $markedCdn = 'https://cdn.jsdelivr.net/npm/marked@' . self::MARKED_VERSION . '/lib/marked.umd.js';
        $turndownCdn = 'https://cdn.jsdelivr.net/npm/turndown@' . self::TURNDOWN_VERSION . '/dist/turndown.js';

        $editorSource = $this->config->get('plugins.modern-editor.editor_source', 'local');
        if ($editorSource !== 'local') {
            return ['marked' => $markedCdn, 'turndown' => $turndownCdn];
        }

        $pluginDir = $this->grav['locator']->findResource('plugin://' . $this->name, true, true);
        $pluginPath = ltrim((string) $this->grav['locator']->findResource('plugin://' . $this->name, false), '/');
        $baseUrl = rtrim($this->grav['base_url_relative'], '/');

        $vendorDir = $pluginDir . '/assets/vendor';

        $markedLocal = $vendorDir . '/marked.umd.js';
        $markedUrl = $markedCdn;
        if (file_exists($markedLocal)) {
            $markedUrl = $baseUrl . '/' . $pluginPath . '/assets/vendor/marked.umd.js?v=' . rawurlencode(self::MARKED_VERSION);
        }

        $turndownLocal = $vendorDir . '/turndown.js';
        $turndownUrl = $turndownCdn;
        if (file_exists($turndownLocal)) {
            $turndownUrl = $baseUrl . '/' . $pluginPath . '/assets/vendor/turndown.js?v=' . rawurlencode(self::TURNDOWN_VERSION);
        }

        return ['marked' => $markedUrl, 'turndown' => $turndownUrl];
    }

    /*
     * Recursively deletes a directory
     */
    private function recursiveRmdir(string $dir): void
    {
        if (!is_dir($dir)) {
            return;
        }

        $files = array_diff(scandir($dir), ['.', '..']);
        foreach ($files as $file) {
            $path = $dir . '/' . $file;
            if (is_dir($path)) {
                $this->recursiveRmdir($path);
            } else {
                @unlink($path);
            }
        }

        @rmdir($dir);
    }

    /*
     * Recursively copies a directory
     */
    private function recursiveCopy(string $src, string $dst): void
    {
        $dir = opendir($src);
        @mkdir($dst, 0775, true);

        while (($file = readdir($dir)) !== false) {
            if (($file !== '.') && ($file !== '..')) {
                if (is_dir($src . '/' . $file)) {
                    $this->recursiveCopy($src . '/' . $file, $dst . '/' . $file);
                } else {
                    copy($src . '/' . $file, $dst . '/' . $file);
                }
            }
        }

        closedir($dir);
    }

    /*
     * Injects the active TinyMCE URL globally in the admin panel so the custom element
     * can reliably load the selected script source regardless of cached blueprints.
     */
    public function onAssetsInitialized(): void
    {
        if (!$this->isAdminContext()) {
            return;
        }

        // Ensure local assets exist BEFORE computing the URLs we're about
        // to inject into this exact page response. This must run first,
        // in this method — not in onPagesInitialized, which fires later
        // in Grav's lifecycle (see the note on the old onPagesInitialized
        // for why that ordering caused CDN URLs to get "stuck" for an
        // entire Admin Next SPA session after the very first activation
        // of local mode).
        $this->ensureLocalAssetsInstalled();

        $editorUrl = $this->getEditorScriptUrl();
        $this->grav['assets']->addInlineJs("window.__MODERN_EDITOR_URL__ = " . json_encode($editorUrl) . ";");

        $adminBase = $this->getAdminBaseUrl();
        $this->grav['assets']->addInlineJs("window.__MODERN_EDITOR_ADMIN_BASE__ = " . json_encode($adminBase) . ";");

        // Exposes Grav's own admin UI language (see getUiLanguage()) so the
        // client-side field/status widgets can follow it instead of
        // guessing from the browser's navigator.language — which was the
        // actual bug: TinyMCE's UI and the status card kept switching to
        // Italian just because the browser was set to Italian, regardless
        // of what language the Grav admin panel itself was configured for.
        $this->grav['assets']->addInlineJs("window.__MODERN_EDITOR_ADMIN_LANG__ = " . json_encode($this->getUiLanguage()) . ";");

        $mdUrls = $this->getMarkdownLibraryUrls();
        $this->grav['assets']->addInlineJs("window.__MODERN_EDITOR_MD_URLS__ = " . json_encode($mdUrls) . ";");
    }

    /*
     * Downloads local ("self-hosted") copies of TinyMCE and/or the
     * markdown helper libraries (marked, turndown) if editor_source is
     * "local" and any of them are missing. Only ever installs — never
     * re-downloads or touches a file that already exists just because a
     * newer release might be available (that's a deliberate, explicit
     * action via the status card / REST API, not something that should
     * happen silently on a page load — see the earlier auto-heal/
     * downgrade bug this plugin used to have).
     */
    private function ensureLocalAssetsInstalled(): void
    {
        $editorSource = $this->config->get('plugins.modern-editor.editor_source', 'local');
        if ($editorSource !== 'local') {
            return;
        }

        $pluginDir = $this->grav['locator']->findResource('plugin://' . $this->name, true, true);

        $localJs = $pluginDir . '/assets/tinymce/tinymce.min.js';
        if (!file_exists($localJs)) {
            $this->downloadAndExtractTinyMCE('7.4.0');
        }

        $vendorDir = $pluginDir . '/assets/vendor';
        if (!file_exists($vendorDir . '/marked.umd.js') || !file_exists($vendorDir . '/turndown.js')) {
            $this->downloadMarkdownLibraries();
        }
    }

    /*
     * Helper to get the correct editor URL based on configured source.
     */
    /*
     * Detects whether the current request is inside the admin panel.
     * $this->isAdmin() (Grav's own helper) relies on the classic
     * `$grav['admin']` service being registered, which some decoupled /
     * SPA-based admin panels (e.g. custom "Admin Next" builds serving
     * their own REST API under /api/v1/...) never set. Without this,
     * every check below would silently fail: asset injection would skip,
     * and the get_config/get_status AJAX actions would never run,
     * causing the SPA shell HTML to be returned instead of our JSON —
     * exactly the "non-JSON response" symptom. So we fall back to
     * matching the current URL path against the configured admin route.
     */
    private function isAdminContext(): bool
    {
        if ($this->isAdmin()) {
            return true;
        }

        $adminRoute = trim((string) $this->config->get('plugins.admin.route', 'admin'), '/');
        if ($adminRoute === '') {
            return false;
        }

        $path = trim((string) ($this->grav['uri']->path() ?? ''), '/');
        return $path === $adminRoute || str_starts_with($path, $adminRoute . '/');
    }

    /*
     * Returns the base URL of the admin panel ("<site>/<admin-route>"),
     * preferring Grav's own already-computed value ($grav['admin']->base)
     * which is correct regardless of how/where the admin route was
     * customized. Falls back to rebuilding it from
     * plugins.admin.route + base_url_relative only if that's unavailable.
     */
    private function getAdminBaseUrl(): string
    {
        $admin = $this->grav['admin'] ?? null;
        if ($admin && isset($admin->base)) {
            return rtrim((string) $admin->base, '/');
        }

        $adminRoute = '/' . ltrim($this->config->get('plugins.admin.route', 'admin'), '/');
        return rtrim($this->grav['base_url_relative'], '/') . $adminRoute;
    }

    public function getEditorScriptUrl(): string
    {
        $editorSource = $this->config->get('plugins.modern-editor.editor_source', 'local');

        if ($editorSource === 'local') {
            $pluginPath = $this->grav['locator']->findResource('plugin://' . $this->name, false);
            $baseUrl = rtrim($this->grav['base_url_relative'], '/');
            $pluginPathClean = ltrim($pluginPath, '/');
            $url = ($baseUrl ? $baseUrl : '') . '/' . $pluginPathClean . '/assets/tinymce/tinymce.min.js';

            // ✅ FIX: cache-busting. Without a version-based query string,
            // the browser (and any intermediate cache/CDN) keeps serving
            // the previously downloaded tinymce.min.js from HTTP cache
            // under this exact same URL even after downloadAndExtractTinyMCE()
            // successfully replaces the file on disk with a newer version.
            // That's why "check for updates" -> "install" reports success,
            // but a page refresh still loads the old TinyMCE build: the file
            // on disk was updated, but the URL requested by the browser
            // never changed, so it never re-fetched it.
            $installedVersion = $this->getInstalledTinyMCEVersion();
            if ($installedVersion) {
                $url .= '?v=' . rawurlencode($installedVersion);
            }

            return $url;
        }

        return 'https://cdn.jsdelivr.net/npm/tinymce@7/tinymce.min.js';
    }

    /*
     * Returns the version string of the currently installed local TinyMCE
     * build (from the .version marker file written by
     * downloadAndExtractTinyMCE()), or null if none is installed.
     */
    private function getInstalledTinyMCEVersion(): ?string
    {
        $pluginDir = $this->grav['locator']->findResource('plugin://' . $this->name, true, true);
        $localJs = $pluginDir . '/assets/tinymce/tinymce.min.js';
        $versionFile = $pluginDir . '/assets/tinymce/.version';

        if (!file_exists($localJs) || !file_exists($versionFile)) {
            return null;
        }

        $version = trim((string) @file_get_contents($versionFile));
        return $version !== '' ? $version : null;
    }

    /*
     * Fetches the latest stable version of TinyMCE from the npm registry.
     */
    private function fetchLatestTinyMCEVersion(): ?string
    {
        return $this->fetchLatestNpmVersion('tinymce');
    }

    /*
     * Same logic as the TinyMCE-specific version above, generalized to
     * any npm package (used for marked/turndown update checks too).
     */
    private function fetchLatestNpmVersion(string $package): ?string
    {
        $url = "https://registry.npmjs.org/{$package}/latest";
        $data = null;

        if (function_exists('curl_init')) {
            $ch = curl_init();
            curl_setopt($ch, CURLOPT_URL, $url);
            curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
            curl_setopt($ch, CURLOPT_TIMEOUT, 10);
            curl_setopt($ch, CURLOPT_USERAGENT, 'Grav CMS Modern Editor Plugin');

            $response = curl_exec($ch);
            $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
            curl_close($ch);

            if ($httpCode === 200 && $response) {
                $data = json_decode($response, true);
                if (isset($data['version'])) {
                    return (string)$data['version'];
                }
            }
        }

        // Stream context fallback if curl is disabled
        try {
            $opts = [
                'http' => [
                    'method' => 'GET',
                    'header' => "User-Agent: Grav CMS Modern Editor Plugin\r\n",
                    'timeout' => 10
                ]
            ];

            $context = stream_context_create($opts);
            $response = @file_get_contents($url, false, $context);

            if ($response) {
                $data = json_decode($response, true);
                if (isset($data['version'])) {
                    return (string)$data['version'];
                }
            }
        } catch (\Exception $e) {
            // Ignore exceptions
        }

        return null;
    }

    /*
     * Reads the installed version marker + any recorded download error
     * for a self-hosted markdown library (marked/turndown), for display
     * in the status card and for the update-check flow.
     */
    private function getMarkdownLibraryInstallInfo(string $package, string $filename): array
    {
        $pluginDir = $this->grav['locator']->findResource('plugin://' . $this->name, true, true);
        $vendorDir = $pluginDir . '/assets/vendor';
        $installedFile = $vendorDir . '/' . $filename;
        $versionFile = $vendorDir . '/.' . $package . '-version';
        $errorFile = $vendorDir . '/.error';

        $isInstalled = file_exists($installedFile);
        $installedVersion = $isInstalled && file_exists($versionFile)
            ? trim((string) @file_get_contents($versionFile))
            : null;
        $error = file_exists($errorFile) ? trim((string) @file_get_contents($errorFile)) : null;

        return [
            'installed' => $isInstalled,
            'version' => $installedVersion ?: null,
            'error' => $error ?: null,
        ];
    }

    /*
     * Dispatches a manual "download/update this library" request coming
     * from the status card UI (marked/turndown) or, by extension, TinyMCE
     * itself, to the right downloader. Mirrors downloadTinyMceAction()'s
     * validation and response shape so the same REST endpoint
     * (POST /modern-editor/download) can serve all three.
     */
    public function downloadLibraryAction(string $library, ?string $version, ?string $langOverride = null): array
    {
        switch ($library) {
            case 'marked':
                return $this->downloadMarkedAction($version ?: self::MARKED_VERSION, $langOverride);
            case 'turndown':
                return $this->downloadTurndownAction($version ?: self::TURNDOWN_VERSION, $langOverride);
            case 'tinymce':
            default:
                return $this->downloadTinyMceAction($version ?: '7.4.0', $langOverride);
        }
    }

    public function downloadMarkedAction(string $version, ?string $langOverride = null): array
    {
        $lang = $this->getUiLanguage($langOverride);

        if (!preg_match('/^[0-9]+\.[0-9]+\.[0-9]+$/', $version)) {
            $version = self::MARKED_VERSION;
        }

        $success = $this->downloadNpmBrowserFile('marked', $version, 'marked.umd.js');

        return [
            'status' => $success ? 'success' : 'error',
            'message' => $success
                ? ($lang === 'it' ? "marked v{$version} installato con successo!" : "marked v{$version} installed successfully!")
                : ($lang === 'it' ? "Download di marked v{$version} non riuscito. Controlla il messaggio di errore nel pannello." : "Failed to download marked v{$version}. Check the error message in the panel."),
            'html' => $this->getLocalStatusHtml($langOverride),
        ];
    }

    public function downloadTurndownAction(string $version, ?string $langOverride = null): array
    {
        $lang = $this->getUiLanguage($langOverride);

        if (!preg_match('/^[0-9]+\.[0-9]+\.[0-9]+$/', $version)) {
            $version = self::TURNDOWN_VERSION;
        }

        $success = $this->downloadNpmBrowserFile('turndown', $version, 'turndown.js');

        return [
            'status' => $success ? 'success' : 'error',
            'message' => $success
                ? ($lang === 'it' ? "turndown v{$version} installato con successo!" : "turndown v{$version} installed successfully!")
                : ($lang === 'it' ? "Download di turndown v{$version} non riuscito. Controlla il messaggio di errore nel pannello." : "Failed to download turndown v{$version}. Check the error message in the panel."),
            'html' => $this->getLocalStatusHtml($langOverride),
        ];
    }
}
