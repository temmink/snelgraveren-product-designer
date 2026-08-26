<?php
use PHPUnit\Framework\TestCase;
use Snelgraveren\ProductDesigner\Database\DesignRepository;
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
