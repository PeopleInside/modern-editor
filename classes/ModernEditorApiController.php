<?php

declare(strict_types=1);

namespace Grav\Plugin\ModernEditor;

use Grav\Plugin\Api\Controllers\AbstractApiController;
use Grav\Plugin\Api\Response\ApiResponse;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;

/*
 * Real REST endpoints for Admin2 (Grav 2.0). These replace the old
 * ?action=get_status / ?action=get_config query-string handlers, which
 * only worked under classic Twig-rendered admin: Admin2 is a decoupled
 * SPA served by its own thin PHP wrapper that returns the same shell HTML
 * for any sub-route, so query strings on those routes never reached our
 * plugin's PHP at all.
 */
class ModernEditorApiController extends AbstractApiController
{
    private function plugin()
    {
        // Grav::instance()['plugins']->get('modern-editor') returns the
        // plugin's CONFIG (a Data object), not the plugin instance — that
        // was the cause of the 500 error. Plugins::getPlugins() is the
        // correct way to get the actual instance, indexed by plugin name.
        return \Grav\Common\Plugins::getPlugins()['modern-editor'];
    }

    /*
     * This request lifecycle (Admin2's own decoupled API routes) doesn't
     * reliably expose $grav['admin'], so the plugin's own language
     * detection (getUiLanguage()) can't see which language the admin UI
     * is actually configured for — that's why the status card kept
     * rendering in English even though the rest of the (Twig-rendered)
     * admin page around it was correctly in Italian. The browser already
     * knows the right answer (it's the same admin session, same page),
     * so the field/status JS sends it explicitly as a "lang" query
     * parameter on every call; we just read it back here and let it
     * override the fragile per-request guesswork.
     */
    private function langOverride(ServerRequestInterface $request): ?string
    {
        $lang = $request->getQueryParams()['lang'] ?? null;
        return ($lang === 'it' || $lang === 'en') ? $lang : null;
    }

    public function status(ServerRequestInterface $request): ResponseInterface
    {
        $this->requirePermission($request, 'admin.login');

        return ApiResponse::create($this->plugin()->getStatusData($this->langOverride($request)));
    }

    public function config(ServerRequestInterface $request): ResponseInterface
    {
        $this->requirePermission($request, 'admin.login');

        return ApiResponse::create($this->plugin()->getConfigData($this->langOverride($request)));
    }

    public function download(ServerRequestInterface $request): ResponseInterface
    {
        $this->requirePermission($request, 'admin.login');

        $body = $this->getRequestBody($request);
        $library = is_array($body) ? ($body['library'] ?? 'tinymce') : 'tinymce';
        $version = is_array($body) ? ($body['version'] ?? null) : null;

        return ApiResponse::create($this->plugin()->downloadLibraryAction(
            (string) $library,
            $version !== null ? (string) $version : null,
            $this->langOverride($request)
        ));
    }

    public function checkUpdates(ServerRequestInterface $request): ResponseInterface
    {
        $this->requirePermission($request, 'admin.login');

        return ApiResponse::create($this->plugin()->checkUpdatesAction($this->langOverride($request)));
    }

    public function remove(ServerRequestInterface $request): ResponseInterface
    {
        $this->requirePermission($request, 'admin.login');

        return ApiResponse::create($this->plugin()->removeTinyMceLocalAction($this->langOverride($request)));
    }
}
