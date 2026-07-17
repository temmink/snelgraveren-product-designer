<?php
// Dependency manifest for blocks/designer/editor.js (no build step, so this
// is maintained by hand). Version bumps with the plugin.
defined('ABSPATH') || exit;

return [
    'dependencies' => ['wp-blocks', 'wp-element', 'wp-i18n', 'wp-block-editor'],
    'version'      => defined('PF_VERSION') ? PF_VERSION : '1.0.1',
];
