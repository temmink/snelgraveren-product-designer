<?php
/**
 * Freemius SDK initialization.
 *
 * This file is intentionally NOT namespaced so that sgpd_fs() is defined
 * in the global namespace, which Freemius requires.
 *
 * @package Snelgraveren\ProductDesigner
 */

defined( 'ABSPATH' ) || exit;

if ( ! function_exists( 'sgpd_fs' ) ) {
    /**
     * Create a helper function for easy SDK access.
     *
     * @return \Freemius
     */
    function sgpd_fs() {
        global $sgpd_fs;
        if ( ! isset( $sgpd_fs ) ) {
            require_once __DIR__ . '/freemius/start.php';
            // NOTE: the Freemius dashboard slug must be updated to match this
            // value manually (Freemius Developer Dashboard → plugin settings)
            // — it does not auto-follow this SDK config change.
            $sgpd_fs = fs_dynamic_init( array(
                'id'               => '26301',
                'slug'             => 'snelgraveren-product-designer',
                'premium_slug'     => 'snelgraveren-product-designer-premium',
                'type'             => 'plugin',
                'public_key'       => 'pk_5db43e71632e44a3d963b594e9eb6',
                // This source IS the premium codebase; the Freemius deployment
                // processor flips this per generated build. Our hand-made
                // wp.org free build (bin/free-build) sets it to false and
                'is_premium'          => false,
                'premium_suffix'      => 'Pro',
                'has_premium_version' => true,
                'is_premium_only'     => false,
                'has_addons'       => false,
                'has_paid_plans'   => true,
                'is_org_compliant' => true,
                'menu'             => array(
                    'slug'    => 'sgpd-templates',
                    'account' => false,
                    'support' => false,
                ),
            ) );
        }
        return $sgpd_fs;
    }
    sgpd_fs();

    // Freemius owns the uninstall flow (no uninstall.php allowed in the
    // deployment); run our cleanup through its hook instead.
    sgpd_fs()->add_action( 'after_uninstall', [ \Snelgraveren\ProductDesigner\Uninstaller::class, 'uninstall' ] );

    do_action( 'sgpd_fs_loaded' );
}
