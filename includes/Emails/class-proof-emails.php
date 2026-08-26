<?php
namespace Snelgraveren\ProductDesigner\Emails;

defined('ABSPATH') || exit;

/**
 * Registers the proof e-mails with WooCommerce.
 *
 * As WC_Email subclasses they appear under WooCommerce -> Settings -> E-mails,
 * inherit the shop's mail styling, and the merchant can rewrite the wording
 * without touching code. Registration is skipped entirely when WooCommerce is
 * absent, so the plugin still boots.
 */
class ProofEmails {

    public function init(): void {
        add_filter('woocommerce_email_classes', [$this, 'register']);
    }

    public function register(array $emails): array {
        if (!class_exists('WC_Email')) {
            return $emails;
        }

        require_once __DIR__ . '/class-proof-ready-email.php';
        require_once __DIR__ . '/class-proof-changes-requested-email.php';
        require_once __DIR__ . '/class-proof-approved-email.php';

        $emails['SGPD_Proof_Ready']             = new ProofReadyEmail();
        $emails['SGPD_Proof_Changes_Requested'] = new ProofChangesRequestedEmail();
        $emails['SGPD_Proof_Approved']          = new ProofApprovedEmail();

        return $emails;
    }
}
