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
 * Lives in the WooCommerce session, so it dies with the session and is never
 * written to the database — a stored grant would outlive the visit.
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
