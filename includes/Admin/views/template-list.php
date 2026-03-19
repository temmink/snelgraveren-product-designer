<?php
namespace ProductDesigner\Admin;

defined('ABSPATH') || exit;

/** @var TemplateListTable $list_table */
?>
<div class="wrap">
    <h1 class="wp-heading-inline"><?php esc_html_e('Templates', 'product-designer'); ?></h1>
    <a href="<?php echo esc_url(admin_url('admin.php?page=pd-template-builder')); ?>" class="page-title-action">
        <?php esc_html_e('Add New', 'product-designer'); ?>
    </a>
    <hr class="wp-header-end">

    <?php
    if (!empty($_GET['trashed'])) {
        echo '<div class="notice notice-success is-dismissible"><p>' . esc_html__('Template moved to Trash.', 'product-designer') . '</p></div>';
    }
    if (!empty($_GET['restored'])) {
        echo '<div class="notice notice-success is-dismissible"><p>' . esc_html__('Template restored.', 'product-designer') . '</p></div>';
    }
    if (!empty($_GET['deleted'])) {
        echo '<div class="notice notice-success is-dismissible"><p>' . esc_html__('Template permanently deleted.', 'product-designer') . '</p></div>';
    }
    ?>

    <?php $list_table->render_status_tabs(); ?>

    <form id="pd-templates-form" method="post">
        <?php
        $list_table->search_box(__('Search Templates', 'product-designer'), 'template');
        $list_table->display();
        ?>
    </form>
</div>
