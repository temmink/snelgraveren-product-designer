<?php
namespace Snelgraveren\ProductDesigner\Admin;

defined('ABSPATH') || exit;

class Admin {

    private SettingsPage $settings_page;
    private ExportDashboard $export_dashboard;

    /**
     * Admin page hook suffixes captured from add_menu_page/add_submenu_page.
     * WordPress derives submenu hooks from the parent menu TITLE
     * (sanitize_title('Product Designer') => 'product-designer'), not its slug,
     * so these must be read back from WordPress rather than hardcoded — otherwise
     * a renamed menu title silently breaks asset enqueueing.
     */
    private string $hook_list = '';
    private string $hook_builder = '';
    private string $hook_design_templates = '';
    private string $hook_clipart = '';

    public function __construct() {
        add_action('admin_menu',           [$this, 'register_menus']);
        add_action('admin_enqueue_scripts', [$this, 'enqueue_scripts']);
        add_filter('upload_mimes',         [$this, 'allow_svg_upload']);
        add_filter('wp_check_filetype_and_ext', [$this, 'fix_svg_filetype'], 10, 5);
        add_filter('wp_handle_upload_prefilter', [$this, 'sanitize_svg_upload']);
        add_action('admin_notices',        [SettingsPage::class, 'maybe_show_critical_notice']);

        $this->settings_page = new SettingsPage();
        $this->settings_page->init();

        $this->export_dashboard = new ExportDashboard();
        $this->export_dashboard->init();

        new ProductIntegration();
    }

    public function register_menus(): void {
        $this->hook_list = (string) add_menu_page(
            __('Product Designer', 'snelgraveren-product-designer'),
            __('Product Designer', 'snelgraveren-product-designer'),
            'edit_sgpd_templates',
            'sgpd-templates',
            [$this, 'render_list_page'],
            'dashicons-edit',
            56
        );

        add_submenu_page(
            'sgpd-templates',
            __('Templates', 'snelgraveren-product-designer'),
            __('Templates', 'snelgraveren-product-designer'),
            'edit_sgpd_templates',
            'sgpd-templates',
            [$this, 'render_list_page']
        );

        $this->hook_builder = (string) add_submenu_page(
            'sgpd-templates',
            __('Template Builder', 'snelgraveren-product-designer'),
            __('Add New', 'snelgraveren-product-designer'),
            'edit_sgpd_templates',
            'sgpd-template-builder',
            [$this, 'render_builder_page']
        );

        $this->hook_design_templates = (string) add_submenu_page(
            'sgpd-templates',
            __('Design Templates', 'snelgraveren-product-designer'),
            __('Design Templates', 'snelgraveren-product-designer'),
            'edit_sgpd_templates',
            'sgpd-design-templates',
            [$this, 'render_design_templates_page']
        );

        $this->hook_clipart = (string) add_submenu_page(
            'sgpd-templates',
            __('Clipart', 'snelgraveren-product-designer'),
            __('Clipart', 'snelgraveren-product-designer'),
            'edit_sgpd_templates',
            'sgpd-clipart',
            [$this, 'render_clipart_page']
        );

        $this->export_dashboard->register_menu();

        $this->settings_page->register_menu();
    }

    public function render_list_page(): void {
        $list_table = new TemplateListTable();
        $list_table->prepare_items();
        include SGPD_PLUGIN_DIR . 'includes/Admin/views/template-list.php';
    }

    public function render_design_templates_page(): void {
        include SGPD_PLUGIN_DIR . 'includes/Admin/views/design-templates.php';
    }

    public function render_clipart_page(): void {
        include SGPD_PLUGIN_DIR . 'includes/Admin/views/clipart.php';
    }

    public function render_builder_page(): void {
        $builder = new TemplateBuilder();
        $builder->render();
    }

    public function enqueue_scripts(string $hook): void {
        if ($this->hook_design_templates !== '' && $hook === $this->hook_design_templates) {
            $this->enqueue_design_templates_scripts();
            return;
        }

        if ($this->hook_clipart !== '' && $hook === $this->hook_clipart) {
            $this->enqueue_clipart_scripts();
            return;
        }

        if ($hook !== $this->hook_list && ($this->hook_builder === '' || $hook !== $this->hook_builder)) {
            return;
        }

        $js_file    = SGPD_PLUGIN_DIR . 'dist/admin-template-builder.js';
        $asset_file = SGPD_PLUGIN_DIR . 'dist/admin-template-builder.asset.php';
        $version    = file_exists($js_file) ? substr(md5_file($js_file), 0, 8) : SGPD_VERSION;
        $deps       = ['react', 'react-dom', 'wp-i18n'];

        if (file_exists($asset_file)) {
            $asset   = include $asset_file;
            $version = $asset['version'] ?? $version;
            $deps    = array_unique(array_merge($asset['dependencies'] ?? [], ['wp-i18n']));
        }

        wp_enqueue_media();

        wp_enqueue_script(
            'sgpd-template-builder',
            SGPD_PLUGIN_URL . 'dist/admin-template-builder.js',
            $deps,
            $version,
            true
        );

        // Inline translations to work with JS-combining caches.
        $this->inline_script_translations('sgpd-template-builder', 'snelgraveren-product-designer', 'dist/admin-template-builder.js');

        $css_file = SGPD_PLUGIN_DIR . 'dist/admin-template-builder.css';
        if (file_exists($css_file)) {
            wp_enqueue_style(
                'sgpd-template-builder',
                SGPD_PLUGIN_URL . 'dist/admin-template-builder.css',
                [],
                $version
            );
        }

        $template_id = (int) ($_GET['template_id'] ?? 0);

        wp_localize_script('sgpd-template-builder', 'sgpdTemplateBuilder', [
            'restUrl'         => esc_url_raw(rest_url()),
            'nonce'           => wp_create_nonce('wp_rest'),
            'templateId'      => $template_id,
            'pluginUrl'       => SGPD_PLUGIN_URL,
            'currency_symbol' => get_woocommerce_currency_symbol(),
            'isPremium'       => \Snelgraveren\ProductDesigner\Plugin::is_premium(),
            'upgradeUrl'      => function_exists( 'sgpd_fs' ) ? sgpd_fs()->get_upgrade_url() : '',
        ]);

        if ($hook === $this->hook_list) {
            $this->enqueue_starter_gallery_script();
            $this->enqueue_starter_gallery_style();
            $this->enqueue_template_transfer_script();
        }
    }

    /**
     * CSS for the starter-template gallery cards rendered by views/template-list.php.
     * Registered with a "false" src (no file to enqueue) purely as an inline-style
     * carrier — wp.org guidelines disallow inline <style> tags in admin-rendered HTML.
     */
    private function enqueue_starter_gallery_style(): void {
        wp_register_style('sgpd-starter-gallery', false, [], SGPD_VERSION);
        wp_enqueue_style('sgpd-starter-gallery');
        wp_add_inline_style('sgpd-starter-gallery', '
            .pf-starter-panel { margin: 16px 0 24px; }
            .pf-starter-panel__intro {
                background: #fff; border: 1px solid #c3c4c7; border-left: 4px solid #2271b1;
                padding: 16px 20px; margin-bottom: 16px; box-shadow: 0 1px 1px rgba(0,0,0,.04);
            }
            .pf-starter-panel__intro h2 { margin: 0 0 4px; font-size: 16px; }
            .pf-starter-panel__intro p { margin: 0; color: #50575e; }
            .pf-starter-panel__heading { font-size: 14px; font-weight: 600; margin: 0 0 10px; color: #1d2327; }
            .pf-starter-grid {
                display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
                gap: 16px;
            }
            .pf-starter-card {
                background: #fff; border: 1px solid #c3c4c7; border-radius: 4px;
                display: flex; flex-direction: column; overflow: hidden;
                box-shadow: 0 1px 1px rgba(0,0,0,.04);
            }
            .pf-starter-card__preview {
                height: 120px; display: flex; align-items: center; justify-content: center;
                background: #f6f7f7; border-bottom: 1px solid #dcdcde;
            }
            .pf-starter-card__preview img {
                max-width: 100%; max-height: 100%; width: auto; height: auto; object-fit: contain;
            }
            .pf-starter-card__preview .dashicons { font-size: 40px; width: 40px; height: 40px; color: #c3c4c7; }
            .pf-starter-card__body { padding: 12px 14px; flex: 1; display: flex; flex-direction: column; }
            .pf-starter-card__badge {
                display: inline-block; font-size: 11px; text-transform: uppercase; letter-spacing: .03em;
                font-weight: 600; color: #2271b1; background: #f0f6fc; border: 1px solid #c5d9ed;
                border-radius: 3px; padding: 2px 6px; margin-bottom: 6px; align-self: flex-start;
            }
            .pf-starter-card__title { font-size: 14px; font-weight: 600; margin: 0 0 4px; color: #1d2327; }
            .pf-starter-card__desc { font-size: 12px; color: #646970; margin: 0 0 12px; flex: 1; }
            .pf-starter-card__footer { margin-top: auto; }
            .pf-starter-card__imported {
                display: flex; align-items: center; gap: 4px; color: #007017; font-size: 13px; font-weight: 600;
            }
            .pf-starter-card__imported .dashicons { color: #007017; font-size: 18px; width: 18px; height: 18px; }
            .pf-starter-import[disabled] { opacity: .6; cursor: default; }
        ');
    }

    /**
     * Small vanilla-JS wiring for the starter-template gallery cards rendered by
     * views/template-list.php. No build step: attached as an inline script on the
     * already-enqueued 'sgpd-template-builder' handle so it can reuse the restUrl/nonce
     * exposed via the sgpdTemplateBuilder global.
     */
    private function enqueue_starter_gallery_script(): void {
        $importing_label = esc_js(__('Importing…', 'snelgraveren-product-designer'));
        $generic_error    = esc_js(__('Could not import this template. Please try again.', 'snelgraveren-product-designer'));

        $script = "(function() {"
            . "document.addEventListener('click', function(event) {"
            . "var button = event.target.closest('.pf-starter-import');"
            . "if (!button) {"
            . "return;"
            . "}"
            . "var config = window.sgpdTemplateBuilder;"
            . "if (!config || !config.restUrl) {"
            . "return;"
            . "}"
            . "var starterId = button.getAttribute('data-starter-id');"
            . "if (!starterId) {"
            . "return;"
            . "}"
            . "var originalLabel = button.textContent;"
            . "button.disabled = true;"
            . 'button.textContent = "' . $importing_label . '";'
            . "fetch(config.restUrl + 'pf/v1/starter-templates/' + encodeURIComponent(starterId) + '/import', {"
            . "method: 'POST',"
            . "headers: { 'X-WP-Nonce': config.nonce }"
            . "})"
            . ".then(function(response) {"
            . "return response.json().then(function(data) {"
            . "return { ok: response.ok, data: data };"
            . "});"
            . "})"
            . ".then(function(result) {"
            . "if (!result.ok) {"
            . 'throw new Error((result.data && result.data.message) || "' . $generic_error . '");'
            . "}"
            . "window.location.reload();"
            . "})"
            . ".catch(function(error) {"
            . 'alert(error.message || "' . $generic_error . '");'
            . "button.disabled = false;"
            . "button.textContent = originalLabel;"
            . "});"
            . "});"
            . "})();";

        wp_add_inline_script('sgpd-template-builder', $script, 'after');
    }

    /**
     * Export/Import wiring for the Templates list. Export fetches the transfer
     * endpoint and downloads the JSON as a file; Import posts a chosen JSON
     * file to the import endpoint. Rides the 'sgpd-template-builder' handle
     * for restUrl + nonce, same as the starter-gallery script.
     */
    private function enqueue_template_transfer_script(): void {
        $export_error = esc_js(__('Could not export this template.', 'snelgraveren-product-designer'));
        $import_error = esc_js(__('Could not import this file.', 'snelgraveren-product-designer'));
        $import_ok    = esc_js(__('Template imported as draft.', 'snelgraveren-product-designer'));

        $script = "(function() {"
            . "var config = window.sgpdTemplateBuilder || {};"
            . "if (!config.restUrl) { return; }"
            . "document.addEventListener('click', function(event) {"
            .   "var link = event.target.closest('.pf-template-export');"
            .   "if (link) {"
            .     "event.preventDefault();"
            .     "fetch(config.restUrl + 'pf/v1/templates/' + link.getAttribute('data-template-id') + '/export', {"
            .       "headers: { 'X-WP-Nonce': config.nonce }"
            .     "})"
            .     ".then(function(r) { if (!r.ok) { throw new Error(); } return r.blob(); })"
            .     ".then(function(blob) {"
            .       "var a = document.createElement('a');"
            .       "a.href = URL.createObjectURL(blob);"
            .       "a.download = 'template-' + link.getAttribute('data-template-slug') + '.json';"
            .       "document.body.appendChild(a); a.click(); a.remove();"
            .       "URL.revokeObjectURL(a.href);"
            .     "})"
            .     '.catch(function() { alert("' . $export_error . '"); });'
            .     "return;"
            .   "}"
            .   "var btn = event.target.closest('.pf-template-import-btn');"
            .   "if (btn) {"
            .     "var input = document.querySelector('.pf-template-import-file');"
            .     "if (input) { input.click(); }"
            .   "}"
            . "});"
            . "document.addEventListener('change', function(event) {"
            .   "var input = event.target.closest('.pf-template-import-file');"
            .   "if (!input || !input.files || !input.files[0]) { return; }"
            .   "var file = input.files[0];"
            .   "input.value = '';"
            .   "file.text().then(function(text) {"
            .     "return fetch(config.restUrl + 'pf/v1/templates/import', {"
            .       "method: 'POST',"
            .       "headers: { 'X-WP-Nonce': config.nonce, 'Content-Type': 'application/json' },"
            .       "body: text"
            .     "});"
            .   "})"
            .   ".then(function(r) { return r.json().then(function(d) { return { ok: r.ok, data: d }; }); })"
            .   ".then(function(result) {"
            .     'if (!result.ok) { throw new Error((result.data && result.data.message) || "' . $import_error . '"); }'
            .     "var msg = '" . $import_ok . "';"
            .     "var warnings = (result.data && result.data.warnings) || [];"
            .     "if (warnings.length) { msg += '\\n\\n' + warnings.join('\\n'); }"
            .     "alert(msg);"
            .     "window.location.reload();"
            .   "})"
            .   '.catch(function(error) { alert(error.message || "' . $import_error . '"); });'
            . "});"
            . "})();";

        wp_add_inline_script('sgpd-template-builder', $script, 'after');
    }

    private function enqueue_design_templates_scripts(): void {
        $js_file = SGPD_PLUGIN_DIR . 'dist/admin-design-templates.js';
        $version = file_exists($js_file) ? substr(md5_file($js_file), 0, 8) : SGPD_VERSION;

        wp_enqueue_script(
            'sgpd-design-templates',
            SGPD_PLUGIN_URL . 'dist/admin-design-templates.js',
            ['react', 'react-dom', 'wp-i18n'],
            $version,
            true
        );

        $this->inline_script_translations('sgpd-design-templates', 'snelgraveren-product-designer', 'dist/admin-design-templates.js');

        // Pass all product templates so the form can link design templates to them.
        $repo = new \Snelgraveren\ProductDesigner\Database\TemplateRepository();
        $all_templates = array_map(function ($t) {
            return ['id' => (int) $t['id'], 'title' => $t['title']];
        }, $repo->list(100, 1, 'published'));

        wp_localize_script('sgpd-design-templates', 'sgpdDesignTemplates', [
            'restUrl'   => esc_url_raw(rest_url()),
            'nonce'     => wp_create_nonce('wp_rest'),
            'templates' => $all_templates,
        ]);
    }

    private function enqueue_clipart_scripts(): void {
        $js_file = SGPD_PLUGIN_DIR . 'dist/admin-clipart.js';
        $version = file_exists($js_file) ? substr(md5_file($js_file), 0, 8) : SGPD_VERSION;

        wp_enqueue_script(
            'sgpd-clipart',
            SGPD_PLUGIN_URL . 'dist/admin-clipart.js',
            ['react', 'react-dom', 'wp-i18n'],
            $version,
            true
        );

        $this->inline_script_translations('sgpd-clipart', 'snelgraveren-product-designer', 'dist/admin-clipart.js');

        $css_file = SGPD_PLUGIN_DIR . 'dist/admin-clipart.css';
        if (file_exists($css_file)) {
            wp_enqueue_style('sgpd-clipart', SGPD_PLUGIN_URL . 'dist/admin-clipart.css', [], $version);
        }

        wp_localize_script('sgpd-clipart', 'sgpdClipart', [
            'restUrl'    => esc_url_raw(rest_url()),
            'nonce'      => wp_create_nonce('wp_rest'),
            'isPremium'  => \Snelgraveren\ProductDesigner\Plugin::is_premium(),
            'upgradeUrl' => function_exists('sgpd_fs') ? sgpd_fs()->get_upgrade_url() : '',
        ]);
    }

    public function allow_svg_upload(array $mimes): array {
        $mimes['svg']  = 'image/svg+xml';
        $mimes['svgz'] = 'image/svg+xml';
        return $mimes;
    }

    public function fix_svg_filetype(array $data, string $file, string $filename, ?array $mimes, string|false $real_mime): array {
        if (!empty($data['ext']) && !empty($data['type'])) {
            return $data;
        }
        $ext = pathinfo($filename, PATHINFO_EXTENSION);
        if ($ext === 'svg' || $ext === 'svgz') {
            $data['ext']  = $ext;
            $data['type'] = 'image/svg+xml';
        }
        return $data;
    }

    /**
     * Sanitize SVG uploads via the enshrined/svg-sanitize library before they enter the Media Library.
     * Strips <script>, on* attributes, <foreignObject>, and other dangerous SVG elements.
     */
    public function sanitize_svg_upload(array $file): array {
        if (($file['type'] ?? '') !== 'image/svg+xml') {
            return $file;
        }

        if (!class_exists(\enshrined\svgSanitize\Sanitizer::class)) {
            $file['error'] = __('SVG sanitization library not available.', 'snelgraveren-product-designer');
            return $file;
        }

        $svg_content = file_get_contents($file['tmp_name']);
        if ($svg_content === false) {
            $file['error'] = __('Could not read SVG file.', 'snelgraveren-product-designer');
            return $file;
        }

        $sanitizer = new \enshrined\svgSanitize\Sanitizer();
        $clean = $sanitizer->sanitize($svg_content);
        if ($clean === false || $clean === '') {
            $file['error'] = __('SVG file contains disallowed content and was rejected.', 'snelgraveren-product-designer');
            return $file;
        }

        // Overwrite the temp file with the sanitized version
        file_put_contents($file['tmp_name'], $clean);

        return $file;
    }

    private function inline_script_translations(string $handle, string $domain, string $relative_path): void {
        $lang = determine_locale();
        $hash = md5($domain . $relative_path);
        $json_file = SGPD_PLUGIN_DIR . "languages/{$domain}-{$lang}-{$hash}.json";

        if (!file_exists($json_file)) {
            $base_lang = substr($lang, 0, 5);
            $json_file = SGPD_PLUGIN_DIR . "languages/{$domain}-{$base_lang}-{$hash}.json";
        }

        if (!file_exists($json_file)) {
            return;
        }

        $json = file_get_contents($json_file);
        if (!$json) {
            return;
        }

        $script = '(function(domain, translations) {'
            . 'var localeData = translations.locale_data.messages || translations.locale_data[domain];'
            . 'if (localeData) {'
            . 'localeData[""].domain = domain;'
            . 'wp.i18n.setLocaleData(localeData, domain);'
            . '}'
            . '})("' . $domain . '", ' . $json . ');';

        wp_add_inline_script($handle, $script, 'before');
    }
}
