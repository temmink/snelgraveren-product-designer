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
    'engrave' => __('Engrave', 'productforge'),
    'print'   => __('Print', 'productforge'),
    'basic'   => __('Basic', 'productforge'),
];
?>
<div class="wrap">
    <h1 class="wp-heading-inline"><?php esc_html_e('Templates', 'productforge'); ?></h1>
    <a href="<?php echo esc_url(admin_url('admin.php?page=pf-template-builder')); ?>" class="page-title-action">
        <?php esc_html_e('Add New', 'productforge'); ?>
    </a>
    <hr class="wp-header-end">

    <?php
    if (!empty($_GET['trashed'])) {
        echo '<div class="notice notice-success is-dismissible"><p>' . esc_html__('Template moved to Trash.', 'productforge') . '</p></div>';
    }
    if (!empty($_GET['restored'])) {
        echo '<div class="notice notice-success is-dismissible"><p>' . esc_html__('Template restored.', 'productforge') . '</p></div>';
    }
    if (!empty($_GET['deleted'])) {
        echo '<div class="notice notice-success is-dismissible"><p>' . esc_html__('Template permanently deleted.', 'productforge') . '</p></div>';
    }
    ?>

    <?php if (!empty($starter_pending)) : ?>
    <div class="pf-starter-panel">
        <style>
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
        </style>

        <?php if (!$has_any_template) : ?>
            <div class="pf-starter-panel__intro">
                <h2><?php esc_html_e('Get started with a ready-made template', 'productforge'); ?></h2>
                <p><?php esc_html_e('You don\'t have any templates yet. Import one of the starter templates below to get a working product in seconds, or build your own with "Add New".', 'productforge'); ?></p>
            </div>
        <?php endif; ?>

        <p class="pf-starter-panel__heading"><?php esc_html_e('Starter templates', 'productforge'); ?></p>

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
                    $preview_url = PF_PLUGIN_URL . 'templates/starter/assets/' . $filename;
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
                                    <?php esc_html_e('Imported', 'productforge'); ?>
                                </span>
                            <?php else : ?>
                                <button
                                    type="button"
                                    class="button button-secondary pf-starter-import"
                                    data-starter-id="<?php echo esc_attr($entry['id'] ?? ''); ?>"
                                >
                                    <?php esc_html_e('Import', 'productforge'); ?>
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
        $list_table->search_box(__('Search Templates', 'productforge'), 'template');
        $list_table->display();
        ?>
    </form>
</div>
