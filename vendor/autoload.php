<?php

/*
 * Minimal PSR-4 autoloader for the Grav\Plugin\ModernEditor\ namespace,
 * mapping to classes/. Equivalent to what `composer dump-autoload` would
 * produce for the single mapping declared in composer.json.
 *
 * If you later add real Composer dependencies to this plugin, just run
 * `composer install` in this directory — it will overwrite this file with
 * a full autoloader that still satisfies the same require path used by
 * autoload() in modern-editor.php.
 */

spl_autoload_register(function (string $class): void {
    $prefix = 'Grav\\Plugin\\ModernEditor\\';
    if (strncmp($prefix, $class, strlen($prefix)) !== 0) {
        return;
    }

    $relative = substr($class, strlen($prefix));
    $file = __DIR__ . '/../classes/' . str_replace('\\', '/', $relative) . '.php';

    if (is_file($file)) {
        require $file;
    }
});

// autoload() in the plugin's main file expects a ClassLoader instance back.
// Grav only calls a couple of its no-op-safe methods (if any), so a bare
// stand-in is enough here since we already registered the real autoloader
// above via spl_autoload_register().
return new class extends \Composer\Autoload\ClassLoader {};
