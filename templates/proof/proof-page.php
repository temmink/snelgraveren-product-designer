<?php
/**
 * Proof page template.
 *
 * Available: $design (array|null), $token (string), $cart_failed (bool) — set
 * when a redirect from a just-approved-but-not-added attempt sent the
 * customer back here (see ProofPage::handle_approve()).
 * Standalone document: the customer may not be logged in and may open this on
 * a phone, so it carries its own minimal styling instead of booting the theme.
 */

namespace Snelgraveren\ProductDesigner\Proof;

defined('ABSPATH') || exit;

$product = $design ? wc_get_product((int) $design['product_id']) : null;
?><!doctype html>
<html <?php language_attributes(); ?>>
<head>
    <meta charset="<?php bloginfo('charset'); ?>" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex, nofollow" />
    <title><?php esc_html_e('Your proof', 'snelgraveren-product-designer'); ?></title>
    <style>
        .pf-proof { all: initial; display: block; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #1d2327; background: #f6f7f7; }
        .pf-proof * { box-sizing: border-box; }
        .pf-proof__inner { max-width: 720px; margin: 0 auto; padding: 24px 16px 64px; }
        .pf-proof__card { background: #fff; border-radius: 8px; padding: 20px; margin-bottom: 16px; }
        .pf-proof__view { display: block; max-width: 100%; height: auto; margin: 0 auto 8px; }
        .pf-proof__title { font-size: 20px; margin: 0 0 4px; }
        .pf-proof__price { font-size: 18px; font-weight: 600; margin: 0 0 16px; }
    </style>
</head>
<body class="pf-proof">
<div class="pf-proof__inner">

<?php if (!$design) : ?>
    <div class="pf-proof__card">
        <h1 class="pf-proof__title"><?php esc_html_e('This proof is no longer valid', 'snelgraveren-product-designer'); ?></h1>
        <p><?php esc_html_e('The link has expired or was withdrawn. Please contact us for a new one.', 'snelgraveren-product-designer'); ?></p>
    </div>
<?php else : ?>
    <div class="pf-proof__card">
        <h1 class="pf-proof__title"><?php echo esc_html($product ? $product->get_name() : __('Your design', 'snelgraveren-product-designer')); ?></h1>
        <?php if ($product) : ?>
            <p class="pf-proof__price"><?php echo wp_kses_post(wc_price(wc_get_price_to_display($product))); ?></p>
        <?php endif; ?>

        <?php foreach (($design['views'] ?? []) as $index => $view) : ?>
            <?php if (!empty($view['thumbnail'])) : ?>
                <img class="pf-proof__view" src="<?php echo esc_url($view['thumbnail']); ?>"
                     alt="<?php esc_attr_e('Proof preview', 'snelgraveren-product-designer'); ?>" />
                <p>
                    <a href="<?php echo esc_url(add_query_arg('sgpd_view', $index, ProofPage::url($token))); ?>" target="_blank" rel="noopener">
                        <?php esc_html_e('View at full size', 'snelgraveren-product-designer'); ?>
                    </a>
                </p>
            <?php endif; ?>
        <?php endforeach; ?>
    </div>

        <?php if ($design['proof_status'] === 'approved' && $cart_failed) : ?>
            <p><strong><?php esc_html_e('Your design was approved, but we could not add it to your cart just now.', 'snelgraveren-product-designer'); ?></strong></p>
            <p><?php esc_html_e('This can happen when the product briefly went unavailable. Please try again — approving again is safe and will not create a duplicate.', 'snelgraveren-product-designer'); ?></p>
            <form method="post">
                <input type="hidden" name="sgpd_action" value="<?php echo esc_attr(ProofPage::ACTION_APPROVE); ?>" />
                <button type="submit"><?php esc_html_e('Try again', 'snelgraveren-product-designer'); ?></button>
            </form>
        <?php elseif ($design['proof_status'] === 'approved') : ?>
            <p><strong><?php esc_html_e('You have already approved this design.', 'snelgraveren-product-designer'); ?></strong></p>
            <p><a href="<?php echo esc_url(wc_get_cart_url()); ?>"><?php esc_html_e('Go to your cart', 'snelgraveren-product-designer'); ?></a></p>
        <?php elseif ($design['proof_status'] === 'changes_requested') : ?>
            <p><strong><?php esc_html_e('You asked for a change to this design.', 'snelgraveren-product-designer'); ?></strong></p>
            <?php if (!empty($design['proof_note'])) : ?>
                <p><?php echo esc_html($design['proof_note']); ?></p>
            <?php endif; ?>
            <p><?php esc_html_e('We will send you a new proof once it has been updated. If you have changed your mind and this version is fine as it is, you can approve it now instead of waiting.', 'snelgraveren-product-designer'); ?></p>
            <form method="post">
                <input type="hidden" name="sgpd_action" value="<?php echo esc_attr(ProofPage::ACTION_APPROVE); ?>" />
                <button type="submit"><?php esc_html_e('Approve this version', 'snelgraveren-product-designer'); ?></button>
            </form>
        <?php else : ?>
            <form method="post">
                <input type="hidden" name="sgpd_action" value="<?php echo esc_attr(ProofPage::ACTION_APPROVE); ?>" />
                <button type="submit"><?php esc_html_e('Approve and order', 'snelgraveren-product-designer'); ?></button>
            </form>
        <?php endif; ?>
<?php endif; ?>

</div>
</body>
</html>
