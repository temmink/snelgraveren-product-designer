<?php
namespace ProductForge\Admin;

defined('ABSPATH') || exit;

/** @var TemplateListTable $list_table */

$starter_templates = new StarterTemplates();
$starter_catalog    = $starter_templates->get_catalog();
$starter_pending    = array_filter($starter_catalog, function ($entry) {
    return empty($entry['imported']);
});

$template_repo   = new \ProductForge\Database\TemplateRepository();
$has_any_template = array_sum($template_repo->get_status_counts()) > 0;

$set_labels = [
    'engrave' => __('Engrave', 'snelgraveren-product-designer'),
    'print'   => __('Print', 'snelgraveren-product-designer'),
    'basic'   => __('Basic', 'snelgraveren-product-designer'),
];
?>
<div class="wrap">
    <h1 class="wp-heading-inline"><?php esc_html_e('Templates', 'snelgraveren-product-designer'); ?></h1>
    <a href="<?php echo esc_url(admin_url('admin.php?page=sgpd-template-builder')); ?>" class="page-title-action">
        <?php esc_html_e('Add New', 'snelgraveren-product-designer'); ?>
    </a>
    <hr class="wp-header-end">

    <?php
    if (!empty($_GET['trashed'])) {
        echo '<div class="notice notice-success is-dismissible"><p>' . esc_html__('Template moved to Trash.', 'snelgraveren-product-designer') . '</p></div>';
    }
    if (!empty($_GET['restored'])) {
        echo '<div class="notice notice-success is-dismissible"><p>' . esc_html__('Template restored.', 'snelgraveren-product-designer') . '</p></div>';
    }
    if (!empty($_GET['deleted'])) {
        echo '<div class="notice notice-success is-dismissible"><p>' . esc_html__('Template permanently deleted.', 'snelgraveren-product-designer') . '</p></div>';
    }
    ?>

    <?php if (!empty($starter_pending)) : ?>
    <div class="pf-starter-panel">
        <?php if (!$has_any_template) : ?>
            <div class="pf-starter-panel__intro">
                <h2><?php esc_html_e('Get started with a ready-made template', 'snelgraveren-product-designer'); ?></h2>
                <p><?php esc_html_e('You don\'t have any templates yet. Import one of the starter templates below to get a working product in seconds, or build your own with "Add New".', 'snelgraveren-product-designer'); ?></p>
            </div>
        <?php endif; ?>

        <p class="pf-starter-panel__heading"><?php esc_html_e('Starter templates', 'snelgraveren-product-designer'); ?></p>

        <div class="pf-starter-grid">
            <?php foreach ($starter_catalog as $entry) :
                $set_key   = $entry['set'] ?? '';
                $set_label = $set_labels[$set_key] ?? ucfirst((string) $set_key);

                $preview_ref = '';
                $first_view  = $entry['views'][0] ?? null;
                if ($first_view) {
                    if (!empty($first_view['background_url']) && str_starts_with((string) $first_view['background_url'], 'asset:')) {
                        $preview_ref = $first_view['background_url'];
                    } elseif (!empty($first_view['zones'][0]['svg_url']) && str_starts_with((string) $first_view['zones'][0]['svg_url'], 'asset:')) {
                        $preview_ref = $first_view['zones'][0]['svg_url'];
                    }
                }
                $preview_url = '';
                if ($preview_ref !== '') {
                    $filename    = basename(substr($preview_ref, strlen('asset:')));
                    $preview_url = SGPD_PLUGIN_URL . 'templates/starter/assets/' . $filename;
                }
                ?>
                <div class="pf-starter-card">
                    <div class="pf-starter-card__preview">
                        <?php if ($preview_url !== '') : ?>
                            <img src="<?php echo esc_url($preview_url); ?>" alt="<?php echo esc_attr($entry['title'] ?? ''); ?>" loading="lazy">
                        <?php else : ?>
                            <span class="dashicons dashicons-art"></span>
                        <?php endif; ?>
                    </div>
                    <div class="pf-starter-card__body">
                        <span class="pf-starter-card__badge"><?php echo esc_html($set_label); ?></span>
                        <p class="pf-starter-card__title"><?php echo esc_html($entry['title'] ?? ''); ?></p>
                        <p class="pf-starter-card__desc"><?php echo esc_html($entry['description'] ?? ''); ?></p>
                        <div class="pf-starter-card__footer">
                            <?php if (!empty($entry['imported'])) : ?>
                                <span class="pf-starter-card__imported">
                                    <span class="dashicons dashicons-yes-alt"></span>
                                    <?php esc_html_e('Imported', 'snelgraveren-product-designer'); ?>
                                </span>
                            <?php else : ?>
                                <button
                                    type="button"
                                    class="button button-secondary pf-starter-import"
                                    data-starter-id="<?php echo esc_attr($entry['id'] ?? ''); ?>"
                                >
                                    <?php esc_html_e('Import', 'snelgraveren-product-designer'); ?>
                                </button>
                            <?php endif; ?>
                        </div>
                    </div>
                </div>
            <?php endforeach; ?>
        </div>
    </div>
    <?php endif; ?>

    <?php $list_table->render_status_tabs(); ?>

    <form id="pf-templates-form" method="post">
        <?php
        $list_table->search_box(__('Search Templates', 'snelgraveren-product-designer'), 'template');
        $list_table->display();
        ?>
    </form>
</div>
