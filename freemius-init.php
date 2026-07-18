<?php
/**
 * Freemius SDK initialization.
 *
 * This file is intentionally NOT namespaced so that pf_fs() is defined
 * in the global namespace, which Freemius requires.
 *
 * @package ProductForge
 */

defined( 'ABSPATH' ) || exit;

if ( ! function_exists( 'pf_fs' ) ) {
    /**
     * Create a helper function for easy SDK access.
     *
     * @return \Freemius
     */
    function pf_fs() {
        global $pf_fs;
        if ( ! isset( $pf_fs ) ) {
            require_once __DIR__ . '/freemius/start.php';
            // NOTE: the Freemius dashboard slug must be updated to match this
            // value manually (Freemius Developer Dashboard → plugin settings)
            // — it does not auto-follow this SDK config change.
            $pf_fs = fs_dynamic_init( array(
                'id'               => '26301',
                'slug'             => 'snelgraveren-product-designer',
                'premium_slug'     => 'snelgraveren-product-designer-premium',
                'type'             => 'plugin',
                'public_key'       => 'pk_5db43e71632e44a3d963b594e9eb6',
                // This source IS the premium codebase; the Freemius deployment
                // processor flips this per generated build. Our hand-made
                // wp.org free build (bin/free-build) sets it to false and
                // strips the wp_org_gatekeeper line below.
                'is_premium'          => true,
                'premium_suffix'      => 'Pro',
                'has_premium_version' => true,
                'is_premium_only'     => false,
                'wp_org_gatekeeper'   => 'OA7#BoRiBNqdf52FvzEf!!074aRLPs8fspif$7K1#4u4Csys1fQlCecVcUTOs2mcpeVHi#C2j9d09fOTvbC0HloPT7fFee5WdS3G',
                'has_addons'       => false,
                'has_paid_plans'   => true,
                'is_org_compliant' => true,
                'menu'             => array(
                    'slug'    => 'productforge',
                    'account' => false,
                    'support' => false,
                ),
            ) );
        }
        return $pf_fs;
    }
    pf_fs();

    // Freemius owns the uninstall flow (no uninstall.php allowed in the
    // deployment); run our cleanup through its hook instead.
    pf_fs()->add_action( 'after_uninstall', [ \ProductForge\Uninstaller::class, 'uninstall' ] );

    do_action( 'pf_fs_loaded' );
}
