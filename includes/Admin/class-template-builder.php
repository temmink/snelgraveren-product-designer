<?php
namespace ProductForge\Admin;

defined('ABSPATH') || exit;

class TemplateBuilder {

    public function render(): void {
        include SGPD_PLUGIN_DIR . 'includes/Admin/views/template-builder.php';
    }
}
