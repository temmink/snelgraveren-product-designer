<?php
namespace Snelgraveren\ProductDesigner\Emails;

defined('ABSPATH') || exit;

use Snelgraveren\ProductDesigner\Proof\ProofPage;

/** "Your proof is ready" — to the customer. */
class ProofReadyEmail extends \WC_Email {

    public function __construct() {
        $this->id             = 'sgpd_proof_ready';
        $this->title          = __('Proof ready', 'snelgraveren-product-designer');
        $this->description    = __('Sent to the customer when you send them a proof to approve.', 'snelgraveren-product-designer');
        $this->template_html  = 'emails/proof-ready.php';
        $this->template_base  = SGPD_PLUGIN_DIR . 'templates/';
        $this->placeholders   = ['{site_title}' => $this->get_blogname()];

        add_action('sgpd_proof_ready_notification', [$this, 'trigger'], 10, 2);

        parent::__construct();
    }

    public function get_default_subject(): string {
        return __('Your proof is ready to approve', 'snelgraveren-product-designer');
    }

    public function get_default_heading(): string {
        return __('Your proof is ready', 'snelgraveren-product-designer');
    }

    public function trigger(array $design, string $token): void {
        $this->setup_locale();

        // The merchant's typed address wins over the customer's account
        // address: they typed it deliberately (a purchasing department, or an
        // account e-mail that has gone stale), and
        // DesignsPage::handle_proof_action() always persists the resolved
        // address to proof_email BEFORE firing this notification — so by the
        // time trigger() runs, proof_email already IS the address the row
        // reported the proof as sent to. Falling back to the account e-mail
        // only covers a design sent with no explicit proof_email at all (an
        // older row, or a caller that fires this action directly).
        $proof_email = trim((string) ($design['proof_email'] ?? ''));
        if ($proof_email !== '') {
            $this->recipient = $proof_email;
        } else {
            $customer         = (int) $design['customer_id'] > 0 ? get_user_by('id', (int) $design['customer_id']) : null;
            $this->recipient  = $customer ? $customer->user_email : '';
        }

        if ($this->is_enabled() && $this->get_recipient()) {
            $this->object = ['design' => $design, 'url' => ProofPage::url($token)];
            $this->send($this->get_recipient(), $this->get_subject(), $this->get_content(), $this->get_headers(), $this->get_attachments());
        }

        $this->restore_locale();
    }

    /**
     * Whether the shop owner has this notification switched on in
     * WooCommerce -> Settings -> E-mails. DesignsPage checks this BEFORE
     * reporting "Proof sent" on the row: trigger() above still creates the
     * proof link and persists proof_email regardless (that state change is
     * legitimate either way), but a disabled e-mail must not be reported as
     * delivered.
     */
    public static function is_mail_enabled(): bool {
        if (!function_exists('WC') || !WC()->mailer()) {
            return true;
        }
        foreach (WC()->mailer()->get_emails() as $email) {
            if ($email instanceof self) {
                return $email->is_enabled();
            }
        }
        return true;
    }

    public function get_content_html(): string {
        return wc_get_template_html($this->template_html, [
            'email_heading' => $this->get_heading(),
            'design'        => $this->object['design'],
            'proof_url'     => $this->object['url'],
            'sent_to_admin' => false,
            'plain_text'    => false,
            'email'         => $this,
        ], '', $this->template_base);
    }
}
