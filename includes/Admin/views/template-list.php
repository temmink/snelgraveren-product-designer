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

    <?php $list_table->render_status_tabs(); ?>

    <form id="pd-templates-form" method="post">
        <?php
        $list_table->search_box(__('Search Templates', 'product-designer'), 'template');
        $list_table->display();
        ?>
    </form>
</div>
