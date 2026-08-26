<?php
defined('ABSPATH') || exit;

do_action('woocommerce_email_header', $email_heading, $email);

$product = wc_get_product((int) $design['product_id']);
?>
<p><?php esc_html_e('A customer approved their proof.', 'snelgraveren-product-designer'); ?></p>

<?php if ($product) : ?>
    <p><strong><?php echo esc_html($product->get_name()); ?></strong></p>
<?php endif; ?>

<p><a href="<?php echo esc_url($admin_url); ?>"><?php esc_html_e('View the design', 'snelgraveren-product-designer'); ?></a></p>

<?php
do_action('woocommerce_email_footer', $email);
