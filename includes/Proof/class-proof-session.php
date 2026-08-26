<?php
namespace Snelgraveren\ProductDesigner\Proof;

defined('ABSPATH') || exit;

/**
 * Which designs THIS visitor has approved a proof for.
 *
 * The proof link needs no login, so at the moment of approving there is no
 * customer_id and no guest design session to match on. This list is the
 * evidence that the visitor holding the browser is the one who approved, and
 * it is what Frontend::owns_design() consults so add-to-cart keeps the hash.
 *
 * Lives in the WooCommerce session — `WC_Session_Handler::save_data()` writes
 * the whole session, serialised, into `wp_woocommerce_sessions` with a 48-hour
 * default expiry and a persistent cookie, and guest session data migrates into
 * the account on login. So this list DOES sit in the database and the grant
 * DOES outlive the visit and survive a browser restart — it does not "die
 * with the session". There is no cross-visitor leak (the cookie is per-visitor
 * and validated), but callers should not assume this is ephemeral. Because the
 * value round-trips through PHP's `serialize`/`unserialize` on every request,
 * it must stay a plain array of strings — no objects, no closures.
 */
class ProofSession {

    public const KEY = 'sgpd_proof_approved';

    private static function available(): bool {
        return function_exists('WC') && WC() && WC()->session;
    }

    /** @return string[] */
    private static function all(): array {
        if (!self::available()) {
            return [];
        }
        $list = WC()->session->get(self::KEY);
        return is_array($list) ? $list : [];
    }

    public static function mark_approved(string $hash): void {
        if (!preg_match('/^[0-9a-f]{32}$/', $hash) || !self::available()) {
            return;
        }
        $list = self::all();
        if (!in_array($hash, $list, true)) {
            $list[] = $hash;
            WC()->session->set(self::KEY, $list);
        }
    }

    public static function is_approved(string $hash): bool {
        if (!preg_match('/^[0-9a-f]{32}$/', $hash)) {
            return false;
        }
        return in_array($hash, self::all(), true);
    }

    public static function forget(string $hash): void {
        if (!self::available()) {
            return;
        }
        $list = array_values(array_filter(self::all(), static fn ($h) => $h !== $hash));
        WC()->session->set(self::KEY, $list);
    }
}
