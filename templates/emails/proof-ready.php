<?php
defined('ABSPATH') || exit;

do_action('woocommerce_email_header', $email_heading, $email);

$product = wc_get_product((int) $design['product_id']);
?>
<p><?php esc_html_e('We have prepared your design. Please take a look and let us know.', 'snelgraveren-product-designer'); ?></p>

<?php if ($product) : ?>
    <p><strong><?php echo esc_html($product->get_name()); ?></strong><br />
    <?php echo wp_kses_post(wc_price(wc_get_price_to_display($product))); ?></p>
<?php endif; ?>

<?php foreach (($design['views'] ?? []) as $view) : ?>
    <?php if (!empty($view['thumbnail'])) : ?>
        <p><img src="<?php echo esc_url($view['thumbnail']); ?>" alt="" style="max-width:100%;height:auto;" /></p>
    <?php endif; ?>
<?php endforeach; ?>

<p><a href="<?php echo esc_url($proof_url); ?>" style="display:inline-block;padding:12px 20px;background:#2271b1;color:#fff;text-decoration:none;border-radius:4px;">
    <?php esc_html_e('View and approve', 'snelgraveren-product-designer'); ?>
</a></p>

<?php
do_action('woocommerce_email_footer', $email);
