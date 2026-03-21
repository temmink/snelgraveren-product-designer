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
            $pf_fs = fs_dynamic_init( array(
                'id'               => '26301',
                'slug'             => 'productforge',
                'type'             => 'plugin',
                'public_key'       => 'pk_5db43e71632e44a3d963b594e9eb6',
                'is_premium'       => false,
                'is_premium_only'  => false,
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
    do_action( 'pf_fs_loaded' );
}
