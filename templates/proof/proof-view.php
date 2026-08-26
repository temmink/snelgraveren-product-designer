<?php
/**
 * One view of a proof, full size.
 *
 * Available: $design (array), $token (string), $view_index (int).
 *
 * This page exists because the full-size render used to be served as raw
 * image bytes in a new tab. That left the customer looking at a bare PNG with
 * no way back to the proof and no way to approve it — and a new tab has no
 * history, so the browser's back button was not an escape either. Zooming in
 * on the detail is exactly when someone decides, so the decision has to be
 * reachable from here.
 *
 * Standalone document, like proof-page.php: the customer may not be logged in
 * and is often on a phone, so it carries its own styling rather than booting
 * the theme.
 */

namespace Snelgraveren\ProductDesigner\Proof;

defined('ABSPATH') || exit;

$product   = wc_get_product((int) $design['product_id']);
$approved  = ($design['proof_status'] ?? '') === 'approved';
$proof_url = ProofPage::url($token);
?><!doctype html>
<html <?php language_attributes(); ?>>
<head>
    <meta charset="<?php bloginfo('charset'); ?>" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex, nofollow" />
    <title><?php esc_html_e('Your proof, full size', 'snelgraveren-product-designer'); ?></title>
    <style>
        .pf-proof { all: initial; display: block; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #1d2327; background: #f6f7f7; }
        .pf-proof * { box-sizing: border-box; }
        .pf-proof__inner { max-width: 960px; margin: 0 auto; padding: 16px 16px 64px; }
        .pf-proof__back { display: inline-block; margin-bottom: 12px; color: #2271b1; text-decoration: none; font-size: 15px; }
        .pf-proof__back:hover { text-decoration: underline; }
        .pf-proof__card { background: #fff; border-radius: 8px; padding: 16px; }
        .pf-proof__view { display: block; max-width: 100%; height: auto; margin: 0 auto; }
        .pf-proof__title { font-size: 18px; margin: 0 0 12px; }
        .pf-proof__actions { margin-top: 16px; display: flex; flex-wrap: wrap; gap: 12px; align-items: center; }
        .pf-proof__btn { display: inline-block; padding: 12px 20px; background: #2271b1; color: #fff; border: 0; border-radius: 4px; font-size: 15px; cursor: pointer; }
    </style>
</head>
<body class="pf-proof">
<div class="pf-proof__inner">

    <a class="pf-proof__back" href="<?php echo esc_url($proof_url); ?>">
        &larr; <?php esc_html_e('Back to your proof', 'snelgraveren-product-designer'); ?>
    </a>

    <div class="pf-proof__card">
        <h1 class="pf-proof__title">
            <?php echo esc_html($product ? $product->get_name() : __('Your design', 'snelgraveren-product-designer')); ?>
        </h1>
        <img class="pf-proof__view"
             src="<?php echo esc_url(ProofPage::raw_view_url($token, $view_index)); ?>"
             alt="<?php esc_attr_e('Proof preview, full size', 'snelgraveren-product-designer'); ?>" />
    </div>

    <div class="pf-proof__actions">
        <?php if ($approved) : ?>
            <p><strong><?php esc_html_e('You have already approved this design.', 'snelgraveren-product-designer'); ?></strong></p>
            <a class="pf-proof__back" href="<?php echo esc_url(wc_get_cart_url()); ?>">
                <?php esc_html_e('Go to your cart', 'snelgraveren-product-designer'); ?>
            </a>
        <?php else : ?>
            <form method="post">
                <input type="hidden" name="sgpd_action" value="<?php echo esc_attr(ProofPage::ACTION_APPROVE); ?>" />
                <button class="pf-proof__btn" type="submit">
                    <?php esc_html_e('Approve and order', 'snelgraveren-product-designer'); ?>
                </button>
            </form>
            <a class="pf-proof__back" href="<?php echo esc_url($proof_url); ?>">
                <?php esc_html_e('Or go back to request a change', 'snelgraveren-product-designer'); ?>
            </a>
        <?php endif; ?>
    </div>

</div>
</body>
</html>
