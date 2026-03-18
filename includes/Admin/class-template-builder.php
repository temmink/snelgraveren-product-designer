<?php
namespace ProductDesigner\Admin;

defined('ABSPATH') || exit;

class TemplateBuilder {

    public function render(): void {
        include PD_PLUGIN_DIR . 'includes/Admin/views/template-builder.php';
    }
}
