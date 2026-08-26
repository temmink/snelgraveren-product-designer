<?php
namespace Snelgraveren\ProductDesigner\Emails;

defined('ABSPATH') || exit;

/** "A customer requested a change" — to the shop. */
class ProofChangesRequestedEmail extends \WC_Email {

    public function __construct() {
        $this->id            = 'sgpd_proof_changes_requested';
        $this->title         = __('Proof: change requested', 'snelgraveren-product-designer');
        $this->description   = __('Sent to you when a customer asks for a change to their proof.', 'snelgraveren-product-designer');
        $this->template_html = 'emails/proof-changes-requested.php';
        $this->template_base = SGPD_PLUGIN_DIR . 'templates/';
        $this->placeholders  = ['{site_title}' => $this->get_blogname()];

        add_action('sgpd_proof_changes_requested_notification', [$this, 'trigger'], 10, 2);

        parent::__construct();

        $this->recipient = $this->get_option('recipient', get_option('admin_email'));
    }

    public function get_default_subject(): string {
        return __('A customer requested a change to a proof', 'snelgraveren-product-designer');
    }

    public function get_default_heading(): string {
        return __('Change requested', 'snelgraveren-product-designer');
    }

    public function init_form_fields(): void {
        parent::init_form_fields();
        $this->form_fields = array_merge([
            'recipient' => [
                'title'       => __('Recipient(s)', 'snelgraveren-product-designer'),
                'type'        => 'text',
                /* translators: %s: the site's admin e-mail address */
                'description' => sprintf(__('Defaults to %s.', 'snelgraveren-product-designer'), '<code>' . esc_attr(get_option('admin_email')) . '</code>'),
                'placeholder' => '',
                'default'     => '',
            ],
        ], $this->form_fields);
    }

    public function trigger(array $design, string $token): void {
        $this->setup_locale();
        $this->object = ['design' => $design, 'token' => $token];

        if ($this->is_enabled() && $this->get_recipient()) {
            $this->send($this->get_recipient(), $this->get_subject(), $this->get_content(), $this->get_headers(), $this->get_attachments());
        }

        $this->restore_locale();
    }

    public function get_content_html(): string {
        return wc_get_template_html($this->template_html, [
            'email_heading' => $this->get_heading(),
            'design'        => $this->object['design'],
            // The Designs list search matches on a hash prefix (DesignRepository's
            // 'search' filter, `design_hash LIKE '<prefix>%'`) — the same 8
            // characters the row itself shows — so this lands the merchant on the
            // one row instead of the unfiltered list.
            'admin_url'     => add_query_arg(
                's',
                substr((string) ($this->object['design']['design_hash'] ?? ''), 0, 8),
                admin_url('admin.php?page=sgpd-designs')
            ),
            'sent_to_admin' => true,
            'plain_text'    => false,
            'email'         => $this,
        ], '', $this->template_base);
    }
}
