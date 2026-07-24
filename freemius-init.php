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

    // On the plugin author's own installs the ProductForge dev-license constant
    // (SGPD_LICENSE_KEY) already grants premium, so Freemius has nothing to
    // license and would only nag for an opt-in / license key it will never
    // receive. Put it into anonymous (skipped) mode once so those prompts never
    // appear on the author's dev/live sites. Real customers — who do not have
    // this per-install secret constant — get the normal Freemius opt-in flow.
    //
    // The constant may be defined late (e.g. via a Code Snippet that runs after
    // this file loads), so the check lives INSIDE the admin_init callback —
    // which fires well after all such definitions — rather than gating the
    // hook registration itself.
    add_action( 'admin_init', function () {
        if (
            ! defined( 'SGPD_LICENSE_KEY' )
            || ! defined( 'AUTH_SALT' )
            || SGPD_LICENSE_KEY !== hash( 'sha256', 'productforge-dev-' . AUTH_SALT )
        ) {
            return; // real customer / no dev constant → normal Freemius flow
        }
        $fs = sgpd_fs();
        if (
            method_exists( $fs, 'is_registered' )
            && ! $fs->is_registered()   // never override a real paying customer
            && ! $fs->is_anonymous()    // already skipped → nothing to do
        ) {
            $fs->skip_connection();
        }
    } );
}
