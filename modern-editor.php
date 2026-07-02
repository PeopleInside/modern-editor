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

    /** @var string|null Cached admin route */
    private $cachedAdminRoute = null;

    private function getAdminRoute(): string
    {
        if ($this->cachedAdminRoute !== null) {
            return $this->cachedAdminRoute;
        }
        $adminRoute = trim((string) $this->config->get('plugins.admin.route', '/admin'));
        if ($adminRoute === '') {
            $adminRoute = '/admin';
        }
        $this->cachedAdminRoute = '/' . ltrim($adminRoute, '/');
        return $this->cachedAdminRoute;
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
            'onPagesInitialized' => ['onPagesInitialized', 100000],
        ]);
    }

    /*
     * Handle custom backend action triggers when pages and user session are fully initialized.
     */
    public function onPagesInitialized(): void
    {
        if (!$this->isAdmin()) {
            return;
        }

        $adminRoute = $this->getAdminRoute();
        $adminBase = rtrim($this->grav['base_url_relative'], '/') . $adminRoute . '/plugins/modern-editor';

        $uri = $this->grav['uri'];
        $action = $uri->query('action');

        // Auto-download local assets if local is selected as the editor source but missing
        if (!$action) {
            $editorSource = $this->config->get('plugins.modern-editor.editor_source', 'cdn');
            if ($editorSource === 'local') {
                $pluginDir = $this->grav['locator']->findResource('plugin://' . $this->name, true, true);
                $localJs = $pluginDir . '/assets/tinymce/tinymce.min.js';
                $versionFile = $pluginDir . '/assets/tinymce/.version';
                $isInstalled = file_exists($localJs);
                $installedVersion = $isInstalled && file_exists($versionFile) ? trim((string) @file_get_contents($versionFile)) : null;
                $configVersion = '7.4.0';
                if (!$isInstalled || $installedVersion !== $configVersion) {
                    $this->downloadAndExtractTinyMCE($configVersion);
                }
            }
            return;
        }

        $isAjax = $uri->query('ajax') === '1';
        $lang = 'en';
        if (isset($this->grav['language'])) {
            $lang = $this->grav['language']->getActive() ?: 'en';
        }

        if ($action === 'download_tinymce') {
            $user = $this->grav['user'] ?? null;
            
            // ✅ FIX: Autorizzazione compatibile con Grav 2.0
            $isAuthorized = false;
            if ($user && isset($user->authenticated) && $user->authenticated) {
                if (method_exists($user, 'authorize')) {
                    $isAuthorized = $user->authorize('admin.login') || $user->authorize('admin.super');
                } else {
                    $isAuthorized = true;
                }
            }
            if (!$isAuthorized && $this->isAdmin()) {
                $isAuthorized = true;
            }

            if ($isAuthorized) {
                $version = $uri->query('version') ?: '7.4.0';
                // Sanitize version to prevent directory traversal or remote execution
                if (!preg_match('/^[0-9]+\.[0-9]+\.[0-9]+$/', $version)) {
                    $version = '7.4.0';
                }

                $success = $this->downloadAndExtractTinyMCE($version);

                // Reset checked version state on successful download
                if ($success && isset($this->grav['session'])) {
                    $this->grav['session']->modern_editor_latest_version = null;
                }

                if ($isAjax) {
                    header('Content-Type: application/json');
                    echo json_encode([
                        'status' => $success ? 'success' : 'error',
                        'message' => $success
                            ? ($lang === 'it' ? "TinyMCE v{$version} è stato scaricato ed estratto con successo localmente!" : "TinyMCE v{$version} has been successfully downloaded and extracted locally!")
                            : ($lang === 'it' ? "Impossibile scaricare TinyMCE v{$version}. Controlla i dettagli dell'errore." : "Failed to download TinyMCE v{$version}. Check error details."),
                        'html' => $this->getLocalStatusHtml()
                    ]);
                    exit;
                }

                $admin = $this->grav['admin'] ?? null;
                if ($success) {
                    if ($admin) {
                        $admin->setMessage("TinyMCE v{$version} has been successfully downloaded and extracted locally!", 'info');
                    } else {
                        $this->grav['messages']->add("TinyMCE v{$version} has been successfully downloaded and extracted locally!", 'info');
                    }
                } else {
                    if ($admin) {
                        $admin->setMessage("Failed to download TinyMCE v{$version}. Check status card for details.", 'error');
                    } else {
                        $this->grav['messages']->add("Failed to download TinyMCE v{$version}. Check status card for details.", 'error');
                    }
                }

                $this->grav->redirect($adminBase);
            } else {
                if ($isAjax) {
                    header('Content-Type: application/json');
                    echo json_encode([
                        'status' => 'error',
                        'message' => $lang === 'it' ? "Azione non autorizzata." : "Unauthorized action."
                    ]);
                    exit;
                }

                $admin = $this->grav['admin'] ?? null;
                if ($admin) {
                    $admin->setMessage("Unauthorized action.", 'error');
                } else {
                    $this->grav['messages']->add("Unauthorized action.", 'error');
                }
            }
        }

        if ($action === 'check_updates') {
            $user = $this->grav['user'] ?? null;
            
            // ✅ FIX: Autorizzazione compatibile con Grav 2.0
            $isAuthorized = false;
            if ($user && isset($user->authenticated) && $user->authenticated) {
                if (method_exists($user, 'authorize')) {
                    $isAuthorized = $user->authorize('admin.login') || $user->authorize('admin.super');
                } else {
                    $isAuthorized = true;
                }
            }
            if (!$isAuthorized && $this->isAdmin()) {
                $isAuthorized = true;
            }

            if ($isAuthorized) {
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

                if ($isAjax) {
                    header('Content-Type: application/json');
                    echo json_encode([
                        'status' => $status,
                        'message' => $msg,
                        'html' => $this->getLocalStatusHtml()
                    ]);
                    exit;
                }

                $admin = $this->grav['admin'] ?? null;
                if ($status === 'success') {
                    if ($admin) {
                        $admin->setMessage($msg, 'info');
                    } else {
                        $this->grav['messages']->add($msg, 'info');
                    }
                } else {
                    if ($admin) {
                        $admin->setMessage($msg, 'error');
                    } else {
                        $this->grav['messages']->add($msg, 'error');
                    }
                }

                $this->grav->redirect($adminBase);
            } else {
                if ($isAjax) {
                    header('Content-Type: application/json');
                    echo json_encode([
                        'status' => 'error',
                        'message' => $lang === 'it' ? "Azione non autorizzata." : "Unauthorized action."
                    ]);
                    exit;
                }

                $admin = $this->grav['admin'] ?? null;
                if ($admin) {
                    $admin->setMessage("Unauthorized action.", 'error');
                } else {
                    $this->grav['messages']->add("Unauthorized action.", 'error');
                }
            }
        }

        if ($action === 'remove_tinymce_local') {
            $user = $this->grav['user'] ?? null;
            
            // ✅ FIX: Autorizzazione compatibile con Grav 2.0
            $isAuthorized = false;
            if ($user && isset($user->authenticated) && $user->authenticated) {
                if (method_exists($user, 'authorize')) {
                    $isAuthorized = $user->authorize('admin.login') || $user->authorize('admin.super');
                } else {
                    $isAuthorized = true;
                }
            }
            if (!$isAuthorized && $this->isAdmin()) {
                $isAuthorized = true;
            }

            if ($isAuthorized) {
                $pluginDir = $this->grav['locator']->findResource('plugin://' . $this->name, true, true);
                $targetDir = $pluginDir . '/assets/tinymce';
                $errorFile = $pluginDir . '/.download-error';

                if (file_exists($errorFile)) {
                    @unlink($errorFile);
                }

                if (is_dir($targetDir)) {
                    $this->recursiveRmdir($targetDir);
                }

                if ($isAjax) {
                    header('Content-Type: application/json');
                    echo json_encode([
                        'status' => 'success',
                        'message' => $lang === 'it' ? "I file offline di TinyMCE sono stati rimossi con successo!" : "Offline TinyMCE files have been successfully removed!",
                        'html' => $this->getLocalStatusHtml()
                    ]);
                    exit;
                }

                $admin = $this->grav['admin'] ?? null;
                if ($admin) {
                    $admin->setMessage("Offline TinyMCE files have been successfully removed!", 'info');
                } else {
                    $this->grav['messages']->add("Offline TinyMCE files have been successfully removed!", 'info');
                }

                $this->grav->redirect($adminBase);
            } else {
                if ($isAjax) {
                    header('Content-Type: application/json');
                    echo json_encode([
                        'status' => 'error',
                        'message' => $lang === 'it' ? "Azione non autorizzata." : "Unauthorized action."
                    ]);
                    exit;
                }

                $admin = $this->grav['admin'] ?? null;
                if ($admin) {
                    $admin->setMessage("Unauthorized action.", 'error');
                } else {
                    $this->grav['messages']->add("Unauthorized action.", 'error');
                }
            }
        }

        if ($action === 'get_config') {
            $user = $this->grav['user'] ?? null;
            
            // ✅ FIX: Autorizzazione compatibile con Grav 2.0
            $isAuthorized = false;
            if ($user && isset($user->authenticated) && $user->authenticated) {
                if (method_exists($user, 'authorize')) {
                    $isAuthorized = $user->authorize('admin.login') || $user->authorize('admin.super');
                } else {
                    $isAuthorized = true;
                }
            }
            if (!$isAuthorized && $this->isAdmin()) {
                $isAuthorized = true;
            }

            if ($isAuthorized) {
                header('Content-Type: application/json');
                header('Cache-Control: no-cache, no-store, must-revalidate');
                header('Pragma: no-cache');
                header('Expires: 0');
                echo json_encode([
                    'editor_source' => $this->config->get('plugins.modern-editor.editor_source', 'cdn'),
                    'editor_url' => $this->getEditorScriptUrl(),
                    'height' => $this->config->get('plugins.modern-editor.height', '500'),
                    'menubar' => (bool) $this->config->get('plugins.modern-editor.menubar', false),
                    'plugins' => $this->config->get('plugins.modern-editor.plugins'),
                    'toolbar' => $this->config->get('plugins.modern-editor.toolbar'),
                ]);
                exit;
            }
        }

        if ($action === 'get_status') {
            $user = $this->grav['user'] ?? null;
            
            // ✅ FIX: Autorizzazione compatibile con Grav 2.0
            $isAuthorized = false;
            if ($user && isset($user->authenticated) && $user->authenticated) {
                if (method_exists($user, 'authorize')) {
                    $isAuthorized = $user->authorize('admin.login') || $user->authorize('admin.super');
                } else {
                    $isAuthorized = true;
                }
            }
            if (!$isAuthorized && $this->isAdmin()) {
                $isAuthorized = true;
            }

            if ($isAuthorized) {
                $pluginDir = $this->grav['locator']->findResource('plugin://' . $this->name, true, true);
                $localJs = $pluginDir . '/assets/tinymce/tinymce.min.js';
                $versionFile = $pluginDir . '/assets/tinymce/.version';
                $errorFile = $pluginDir . '/assets/tinymce/.error';
                $isInstalled = file_exists($localJs);
                $installedVersion = $isInstalled && file_exists($versionFile) ? trim((string) @file_get_contents($versionFile)) : null;
                $hasError = file_exists($errorFile);
                $errorMessage = $hasError ? trim((string) @file_get_contents($errorFile)) : '';

                $lang = 'en';
                if (isset($this->grav['language'])) {
                    $lang = $this->grav['language']->getActive() ?: 'en';
                }

                $latestVersion = null;
                if (isset($this->grav['session'])) {
                    $latestVersion = $this->grav['session']->modern_editor_latest_version ?? null;
                }

                header('Content-Type: application/json');
                header('Cache-Control: no-cache, no-store, must-revalidate');
                header('Pragma: no-cache');
                header('Expires: 0');
                echo json_encode([
                    'is_installed' => $isInstalled,
                    'installed_version' => $installedVersion,
                    'latest_version' => $latestVersion,
                    'has_error' => $hasError,
                    'error_message' => $errorMessage,
                    'lang' => $lang,
                    'check_url' => $adminBase . '?action=check_updates',
                    'reinstall_url' => $adminBase . '?action=download_tinymce&version=7.4.0',
                    'update_url_prefix' => $adminBase . '?action=download_tinymce&version=',
                    'html' => $this->getLocalStatusHtml()
                ]);
                exit;
            }
        }
    }

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

        $cfgHash = md5(json_encode([
            $this->config->get('plugins.modern-editor.height'),
            $this->config->get('plugins.modern-editor.menubar'),
            $this->config->get('plugins.modern-editor.plugins'),
            $this->config->get('plugins.modern-editor.toolbar'),
            $this->config->get('plugins.modern-editor.editor_source'),
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
            'undo redo | blocks | bold italic underline forecolor backcolor | bullist numlist | link image media table | code fullscreen'
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
    private function getLocalStatusHtml(): string
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

        $lang = 'en';
        if (isset($this->grav['language'])) {
            $lang = $this->grav['language']->getActive() ?: 'en';
        }

        $latestVersion = null;
        if (isset($this->grav['session'])) {
            $latestVersion = $this->grav['session']->modern_editor_latest_version ?? null;
        }

        $adminRoute = $this->getAdminRoute();
        $adminBase = rtrim($this->grav['base_url_relative'], '/') . $adminRoute . '/plugins/modern-editor';

        $checkUrl = $adminBase . '?action=check_updates';
        $reinstallUrl = $adminBase . '?action=download_tinymce&version=7.4.0';
        $removeUrl = $adminBase . '?action=remove_tinymce_local';

        $editorSource = $this->config->get('plugins.modern-editor.editor_source', 'cdn');

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
                    $updateUrl = $adminBase . "?action=download_tinymce&version={$latestVersion}";
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
                    $updateUrl = $adminBase . "?action=download_tinymce&version={$latestVersion}";
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
                        $updateUrl = $adminBase . "?action=download_tinymce&version={$latestVersion}";
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
                        $updateUrl = $adminBase . "?action=download_tinymce&version={$latestVersion}";
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

        $html .= "</div>";

        // Append the beautiful inline AJAX JavaScript
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

        $url = "https://download.tiny.cloud/tinymce/community/tinymce_{$version}.zip";
        $tempZip = tempnam(sys_get_temp_dir(), 'tinymce_zip_');

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

        // Extract
        if (!class_exists('ZipArchive')) {
            $errMsg = "PHP ZipArchive extension is not enabled on your server.";
            if ($this->grav['admin'] ?? null) {
                $this->grav['admin']->setMessage($errMsg, 'error');
            }
            @file_put_contents($errorFile, $errMsg);
            @unlink($tempZip);
            return false;
        }

        $zip = new \ZipArchive();
        $tempExtractDir = sys_get_temp_dir() . '/tinymce_extract_' . uniqid();
        @mkdir($tempExtractDir, 0775, true);

        if ($zip->open($tempZip) !== true) {
            $errMsg = "Failed to open downloaded ZIP file.";
            if ($this->grav['admin'] ?? null) {
                $this->grav['admin']->setMessage($errMsg, 'error');
            }
            @file_put_contents($errorFile, $errMsg);
            @unlink($tempZip);
            $this->recursiveRmdir($tempExtractDir);
            return false;
        }

        $zip->extractTo($tempExtractDir);
        $zip->close();
        @unlink($tempZip);

        // Locate tinymce.min.js inside extracted directory
        $sourceDir = $this->findTinyMCEJsFolder($tempExtractDir);
        if (!$sourceDir) {
            $errMsg = "Could not find tinymce.min.js inside the downloaded ZIP file.";
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
        if (!$this->isAdmin()) {
            return;
        }

        $editorUrl = $this->getEditorScriptUrl();
        $this->grav['assets']->addInlineJs("window.__MODERN_EDITOR_URL__ = " . json_encode($editorUrl) . ";");

        $adminRoute = $this->getAdminRoute();
        $adminPath = rtrim($this->grav['base_url_relative'], '/') . $adminRoute;
        $this->grav['assets']->addInlineJs("window.__MODERN_EDITOR_ADMIN_PATH__ = " . json_encode($adminPath) . ";");
    }

    /*
     * Helper to get the correct editor URL based on configured source.
     */
    public function getEditorScriptUrl(): string
    {
        $editorSource = $this->config->get('plugins.modern-editor.editor_source', 'cdn');

        if ($editorSource === 'local') {
            $pluginPath = $this->grav['locator']->findResource('plugin://' . $this->name, false);
            $baseUrl = rtrim($this->grav['base_url_relative'], '/');
            $pluginPathClean = ltrim($pluginPath, '/');
            return ($baseUrl ? $baseUrl : '') . '/' . $pluginPathClean . '/assets/tinymce/tinymce.min.js';
        }

        return 'https://cdn.jsdelivr.net/npm/tinymce@7/tinymce.min.js';
    }

    /*
     * Fetches the latest stable version of TinyMCE from the npm registry.
     */
    private function fetchLatestTinyMCEVersion(): ?string
    {
        $url = 'https://registry.npmjs.org/tinymce/latest';
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
}
