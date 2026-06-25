<?php
namespace Grav\Plugin;

use Grav\Common\Plugin;
use Grav\Common\Grav;
use RocketTheme\Toolbox\Event\Event;

/**
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

    public static function getSubscribedEvents(): array
    {
        return [
            'onPluginsInitialized' => ['onPluginsInitialized', 0],
        ];
    }

    public function onPluginsInitialized(): void
    {
        if (!$this->config->get('plugins.modern-editor.enabled')) {
            return;
        }

        $this->enable([
            'onGetPageBlueprints' => ['onGetPageBlueprints', 0],
            // Fallback for classic admin / Grav 1.7, harmless if it doesn't trigger.
            'onBlueprintCreated' => ['onBlueprintCreated', 0],
        ]);
    }

    /**
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

    /**
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

    /**
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

    /**
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
            'undo redo | blocks | bold italic underline | bullist numlist | link image media table | code fullscreen'
        ));

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
YAML;
    }

    private function yamlString(string $value): string
    {
        return "'" . str_replace("'", "''", $value) . "'";
    }

    /**
     * Fallback for classic admin (Grav 1.7): directly rewrites
     * the "content" field if this event is triggered.
     */
    public function onBlueprintCreated(Event $event): void
    {
        $blueprint = $event['blueprint'] ?? null;
        $type = $event['type'] ?? '';

        if (!$blueprint) {
            return;
        }

        if ($type !== '' && !str_starts_with($type, 'pages/') && $type !== 'pages') {
            return;
        }

        $fields = $blueprint->get('form/fields');
        if (!is_array($fields) || !isset($fields['content'])) {
            return;
        }

        if (($fields['content']['type'] ?? null) === 'moderneditor') {
            return;
        }

        $fields['content'] = array_merge($fields['content'], [
            'type' => 'moderneditor',
            'height' => $this->config->get('plugins.modern-editor.height', '500'),
            'menubar' => (bool) $this->config->get('plugins.modern-editor.menubar', false),
            'plugins' => $this->config->get('plugins.modern-editor.plugins'),
            'toolbar' => $this->config->get('plugins.modern-editor.toolbar'),
        ]);

        $blueprint->set('form/fields', $fields);
    }
}
