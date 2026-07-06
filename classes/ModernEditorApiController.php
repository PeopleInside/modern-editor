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

    public function status(ServerRequestInterface $request): ResponseInterface
    {
        $this->requirePermission($request, 'admin.login');

        return ApiResponse::create($this->plugin()->getStatusData());
    }

    public function config(ServerRequestInterface $request): ResponseInterface
    {
        $this->requirePermission($request, 'admin.login');

        return ApiResponse::create($this->plugin()->getConfigData());
    }

    public function download(ServerRequestInterface $request): ResponseInterface
    {
        $this->requirePermission($request, 'admin.login');

        $body = $this->getRequestBody($request);
        $library = is_array($body) ? ($body['library'] ?? 'tinymce') : 'tinymce';
        $version = is_array($body) ? ($body['version'] ?? null) : null;

        return ApiResponse::create($this->plugin()->downloadLibraryAction((string) $library, $version !== null ? (string) $version : null));
    }

    public function checkUpdates(ServerRequestInterface $request): ResponseInterface
    {
        $this->requirePermission($request, 'admin.login');

        return ApiResponse::create($this->plugin()->checkUpdatesAction());
    }

    public function remove(ServerRequestInterface $request): ResponseInterface
    {
        $this->requirePermission($request, 'admin.login');

        return ApiResponse::create($this->plugin()->removeTinyMceLocalAction());
    }
}
