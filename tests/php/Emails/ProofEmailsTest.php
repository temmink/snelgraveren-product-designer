<?php
use PHPUnit\Framework\TestCase;
use Snelgraveren\ProductDesigner\Database\DesignRepository;
use Snelgraveren\ProductDesigner\Emails\ProofReadyEmail;
use Snelgraveren\ProductDesigner\Proof\ProofWorkflow;

/**
 * The bootstrap loads full WordPress and WooCommerce, so WC()->mailer() is
 * already initialised by the time these run — the three proof e-mails were
 * registered through woocommerce_email_classes during that boot, exactly as
 * they would be on a real request. These tests exercise the same singleton
 * instances WooCommerce itself sends through, not fresh objects, so a
 * recipient/is_enabled check here reflects what a live send would actually do.
 */
class ProofEmailsTest extends TestCase {
    private DesignRepository $repo;
    private array $created_ids = [];
    private array $user_ids = [];

    protected function setUp(): void {
        $this->repo = new DesignRepository();
    }

    private function make_design(int $customer_id = 0): int {
        $id = $this->repo->create([
            'template_id' => 1, 'product_id' => 1, 'customer_id' => $customer_id,
            'session_id'  => 'proof-email-test-' . uniqid(),
        ]);
        $this->created_ids[] = $id;
        return $id;
    }

    private function make_user(): int {
        $suffix = uniqid();
        $id = wp_insert_user([
            'user_login' => 'sgpd-email-test-' . $suffix,
            'user_email' => 'sgpd-email-test-' . $suffix . '@example.com',
            'user_pass'  => wp_generate_password(),
            'role'       => 'customer',
        ]);
        $this->assertIsInt($id);
        $this->user_ids[] = $id;
        return $id;
    }

    public function test_registration_includes_all_three_emails_with_titles(): void {
        $emails = WC()->mailer()->get_emails();

        $this->assertArrayHasKey('SGPD_Proof_Ready', $emails);
        $this->assertArrayHasKey('SGPD_Proof_Changes_Requested', $emails);
        $this->assertArrayHasKey('SGPD_Proof_Approved', $emails);

        $this->assertNotEmpty($emails['SGPD_Proof_Ready']->get_title());
        $this->assertNotEmpty($emails['SGPD_Proof_Changes_Requested']->get_title());
        $this->assertNotEmpty($emails['SGPD_Proof_Approved']->get_title());
    }

    public function test_customer_mail_resolves_to_the_owning_users_email(): void {
        $user_id = $this->make_user();
        $id      = $this->make_design($user_id);
        $token   = (new ProofWorkflow($this->repo))->send($id);
        $design  = $this->repo->get($id);

        $ready = WC()->mailer()->get_emails()['SGPD_Proof_Ready'];

        $sent    = 0;
        $shortcut = function ($null) use (&$sent) {
            $sent++;
            return true; // pretend delivered — no real transport in this environment.
        };
        add_filter('pre_wp_mail', $shortcut, 10, 1);
        $ready->trigger($design, $token);
        remove_filter('pre_wp_mail', $shortcut, 10);

        $user = get_user_by('id', $user_id);
        $this->assertSame($user->user_email, $ready->get_recipient());
        $this->assertSame(1, $sent, 'A resolvable recipient must actually attempt a send.');
    }

    public function test_customer_mail_falls_back_to_proof_email_when_there_is_no_account(): void {
        // proof_email exists precisely for this case: a proof sent to someone
        // with no WordPress account, so the address cannot come from customer_id.
        $id    = $this->make_design(0);
        $token = (new ProofWorkflow($this->repo))->send($id);
        $this->repo->update_proof($id, ['proof_email' => 'guest-proof@example.com']);
        $design = $this->repo->get($id);

        $ready = WC()->mailer()->get_emails()['SGPD_Proof_Ready'];

        $sent     = 0;
        $shortcut = function ($null) use (&$sent) {
            $sent++;
            return true;
        };
        add_filter('pre_wp_mail', $shortcut, 10, 1);
        $ready->trigger($design, $token);
        remove_filter('pre_wp_mail', $shortcut, 10);

        $this->assertSame('guest-proof@example.com', $ready->get_recipient());
        $this->assertSame(1, $sent);
    }

    public function test_customer_mail_sends_nothing_with_no_account_and_no_proof_email(): void {
        // Known gap, closed in the next task by validating the address before
        // the state ever changes — not fixed here. This test documents the
        // current behaviour: an empty recipient, and nothing sent.
        $id     = $this->make_design(0);
        $token  = (new ProofWorkflow($this->repo))->send($id);
        $design = $this->repo->get($id);
        $this->assertSame('', (string) ($design['proof_email'] ?? ''));

        $ready = WC()->mailer()->get_emails()['SGPD_Proof_Ready'];

        $sent     = 0;
        $shortcut = function ($null) use (&$sent) {
            $sent++;
            return true;
        };
        add_filter('pre_wp_mail', $shortcut, 10, 1);
        $ready->trigger($design, $token);
        remove_filter('pre_wp_mail', $shortcut, 10);

        $this->assertSame('', $ready->get_recipient());
        $this->assertSame(0, $sent, 'No recipient must mean no send attempt at all.');
    }

    public function test_shop_owner_mails_default_to_admin_email_when_recipient_is_unset(): void {
        $emails      = WC()->mailer()->get_emails();
        $admin_email = get_option('admin_email');

        $this->assertSame($admin_email, $emails['SGPD_Proof_Changes_Requested']->get_recipient());
        $this->assertSame($admin_email, $emails['SGPD_Proof_Approved']->get_recipient());
    }

    /**
     * DesignsPage checks is_mail_enabled() before reporting "Proof sent" on
     * the row. WC_Email::__construct() reads the enabled/disabled toggle into
     * $this->enabled exactly ONCE (abstract-wc-email.php), so the registered
     * singleton this test starts with was built from whatever the option
     * held at the moment WC_Emails first constructed it earlier in this
     * process — update_option() alone does NOT change that already-built
     * object's answer. Confirmed empirically: an earlier version of this
     * test called update_option() then asserted directly against the
     * existing singleton and it did NOT react (is_mail_enabled() kept
     * returning true after setting 'enabled' => 'no').
     *
     * That is not a production bug: a real HTTP request always constructs
     * the singleton fresh from whatever the option currently holds, so
     * is_mail_enabled() is correct for the case it exists to guard (the
     * admin-post handler reading the CURRENT setting during ITS OWN
     * request). It is a PHPUnit artifact — one long-lived process reusing
     * one singleton across every test in the suite. So this test replaces
     * the registered singleton with a freshly-constructed instance after
     * each update_option() call, exactly what a fresh request would do,
     * before asking is_mail_enabled() to look it up.
     */
    public function test_is_mail_enabled_reflects_the_woocommerce_toggle(): void {
        $option_key = 'woocommerce_sgpd_proof_ready_settings';
        $original   = get_option($option_key);

        try {
            $settings            = is_array($original) ? $original : [];
            $settings['enabled'] = 'no';
            update_option($option_key, $settings);
            WC()->mailer()->emails['SGPD_Proof_Ready'] = new ProofReadyEmail();
            $this->assertFalse(ProofReadyEmail::is_mail_enabled(), 'Disabling the mail setting must be reflected.');

            $settings['enabled'] = 'yes';
            update_option($option_key, $settings);
            WC()->mailer()->emails['SGPD_Proof_Ready'] = new ProofReadyEmail();
            $this->assertTrue(ProofReadyEmail::is_mail_enabled(), 'Re-enabling the mail setting must be reflected.');
        } finally {
            if (false === $original) {
                delete_option($option_key);
            } else {
                update_option($option_key, $original);
            }
            // Leave the registry in a state consistent with the restored
            // option for any test that runs after this one.
            WC()->mailer()->emails['SGPD_Proof_Ready'] = new ProofReadyEmail();
        }
    }

    protected function tearDown(): void {
        foreach ($this->created_ids as $id) {
            $this->repo->delete($id);
        }
        $this->created_ids = [];

        require_once ABSPATH . 'wp-admin/includes/user.php';
        foreach ($this->user_ids as $id) {
            wp_delete_user($id);
        }
        $this->user_ids = [];
    }
}
