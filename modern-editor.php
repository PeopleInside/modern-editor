<?php
namespace Grav\Plugin;

use Grav\Common\Plugin;
use Grav\Common\Grav;
use RocketTheme\Toolbox\Event\Event;

/**
 * Modern Editor Plugin per Grav 2.0
 *
 * Sostituisce il campo "content" delle pagine (markdown editor di default)
 * con un editor visuale WYSIWYG (TinyMCE), integrato come Custom Field per
 * Admin Next tramite Web Component (admin-next/fields/moderneditor.js).
 *
 * COME FUNZIONA L'OVERRIDE DEL CAMPO "CONTENT" (senza toccare il tema):
 *
 * Grav risolve i blueprint di pagina tramite il meccanismo standard
 * "@extends" + lo stream blueprints://pages, che unisce (merge) i file
 * di più fonti (core, tema, plugin). Per ogni template di pagina che il
 * tema attivo definisce (default.html.twig, item.html.twig, ecc.), questo
 * plugin genera AL VOLO — alla cache://blueprints/modern-editor/pages/ —
 * un piccolo file YAML che estende quel template e sovrascrive solo il
 * campo "content" nella tab Contenuto. La cartella generata viene
 * registrata nello stream blueprints://pages tramite onGetPageBlueprints,
 * cosi' Grav la trova e la unisce come farebbe con un file scritto a mano
 * nel tema.
 *
 * In questo modo l'editor compare su QUALSIASI template del tema, anche
 * se nuovi template vengono aggiunti in futuro, senza che l'utente debba
 * scrivere o copiare nulla a mano.
 */
class ModernEditorPlugin extends Plugin
{
    /** @var string Percorso (stream) dove vengono generati i blueprint override */
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
            // Fallback per l'admin classico / Grav 1.7, non fa danno se non scatta.
            'onBlueprintCreated' => ['onBlueprintCreated', 0],
        ]);
    }

    /**
     * Genera (se necessario) i blueprint override per ogni template del
     * tema attivo, poi registra la cartella generata come fonte aggiuntiva
     * di blueprint di pagina.
     */
    public function onGetPageBlueprints(Event $event): void
    {
        $types = $event['types'] ?? $event->types ?? null;
        if (!$types) {
            return;
        }

        $this->generateOverrideBlueprints();

        // Registra prima la cartella generata (override per-template),
        // poi quella statica del plugin (eventuali estensioni manuali
        // aggiunte dall'utente avanzato, vedi blueprints/pages/).
        $types->scanBlueprints($this->generatedPath);
        $types->scanBlueprints('plugin://' . $this->name . '/blueprints');
    }

    /**
     * Scansiona i template di pagina (.html.twig) disponibili nel tema
     * attivo e nel core, e genera un file di override per ciascuno,
     * salvandolo nella cache. Vengono rigenerati solo se mancanti o se
     * la configurazione del plugin e' cambiata (tramite un file di
     * controllo versione/hash).
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
     * Trova i nomi dei template di pagina (.html.twig) disponibili,
     * scansionando il tema attivo e Grav core. Modular/partials/error
     * vengono esclusi perche' non rappresentano pagine editabili "normali".
     *
     * @return string[] Elenco di nomi di template, es. ['default', 'item', 'blog']
     */
    private function discoverPageTemplates($locator): array
    {
        $names = [];
        $dirs = [];

        // Tema attivo.
        $themeTemplates = $locator->findResource('theme://templates', true, true);
        if ($themeTemplates && is_dir($themeTemplates)) {
            $dirs[] = $themeTemplates;
        }

        // Template di pagina aggiunti da altri plugin.
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
                // Esclude i template modulari (convenzione: dentro una
                // sottocartella "modular/"), che vanno trattati a parte.
                if (str_contains($file, '/modular/')) {
                    continue;
                }
                $names[$base] = true;
            }
        }

        // Garantiamo sempre almeno "default", anche se il tema non lo
        // espone esplicitamente come file fisico.
        $names['default'] = true;

        return array_keys($names);
    }

    /**
     * Costruisce il contenuto YAML di un singolo file di override.
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
# Generato automaticamente da Modern Editor — non modificare a mano,
# verra' sovrascritto. Per personalizzare, modifica le impostazioni del
# plugin in Admin Next, oppure aggiungi un override manuale in
# blueprints/pages/{$templateName}.yaml dentro questo plugin.
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
     * Fallback per l'admin classico (Grav 1.7): riscrive direttamente
     * il campo "content" se questo evento dovesse scattare.
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
