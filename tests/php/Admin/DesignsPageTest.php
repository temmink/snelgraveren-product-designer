<?php
use PHPUnit\Framework\TestCase;
use Snelgraveren\ProductDesigner\Admin\DesignsPage;
use Snelgraveren\ProductDesigner\Database\DesignRepository;

class DesignsPageTest extends TestCase {
    private array $user_ids   = [];
    private array $design_ids = [];

    private function make_user(): int {
        $suffix = uniqid();
        $id = wp_insert_user([
            'user_login' => 'sgpd-test-' . $suffix,
            'user_email' => 'sgpd-test-' . $suffix . '@example.com',
            'user_pass'  => wp_generate_password(),
            'role'       => 'customer',
        ]);
        $this->assertIsInt($id);
        $this->user_ids[] = $id;
        return $id;
    }

    public function test_resolves_a_customer_by_id_email_or_login(): void {
        $id   = $this->make_user();
        $user = get_user_by('id', $id);

        $this->assertSame($id, DesignsPage::resolve_customer((string) $id));
        $this->assertSame($id, DesignsPage::resolve_customer($user->user_email));
        $this->assertSame($id, DesignsPage::resolve_customer($user->user_login));
        // Pasted from an e-mail, so surrounding whitespace is the normal case.
        $this->assertSame($id, DesignsPage::resolve_customer('  ' . $user->user_email . ' '));
    }

    public function test_returns_zero_when_nothing_matches(): void {
        // 0 must mean "no such account", never "assign to nobody by accident":
        // the handler turns 0 into an error notice instead of an assignment.
        $this->assertSame(0, DesignsPage::resolve_customer(''));
        $this->assertSame(0, DesignsPage::resolve_customer('   '));
        $this->assertSame(0, DesignsPage::resolve_customer('99999999'));
        $this->assertSame(0, DesignsPage::resolve_customer('no-such-account'));
        $this->assertSame(0, DesignsPage::resolve_customer('no-such-account@example.com'));
    }

    public function test_reopen_url_is_empty_when_the_product_is_gone(): void {
        $this->assertSame('', DesignsPage::reopen_url([
            'product_id'  => 0,
            'design_hash' => str_repeat('a', 32),
        ]));
    }

    public function test_proof_label_is_human_readable_for_every_state(): void {
        foreach (\Snelgraveren\ProductDesigner\Proof\ProofWorkflow::STATES as $state) {
            $label = DesignsPage::proof_label($state);
            $this->assertNotSame('', $label, "state {$state} has no label");
            $this->assertNotSame($state, $label, "state {$state} shows its raw enum value");
        }
    }

    public function test_proof_label_of_an_unknown_state_is_empty(): void {
        $this->assertSame('', DesignsPage::proof_label('nonsense'));
    }

    /**
     * Run $fn, catch the wp_redirect it triggers via wp_safe_redirect(), and
     * return the redirect location — without letting the handler's exit;
     * actually run and kill the test process.
     *
     * wp_redirect() (called internally by wp_safe_redirect()) applies the
     * 'wp_redirect' filter to the location BEFORE calling header()/returning,
     * and the handler's `exit;` sits after that call — so a filter callback
     * that throws never lets execution reach either header() or exit;. The
     * exception unwinds back out through wp_safe_redirect() and out of $fn,
     * where this method catches it.
     */
    private function capture_redirect(callable $fn): string {
        $captured = null;
        $catcher  = function ($location) use (&$captured) {
            $captured = $location;
            throw new \Exception('captured redirect, not a real failure');
        };
        add_filter('wp_redirect', $catcher, 10, 1);
        try {
            $fn();
            $this->fail('handler did not redirect');
        } catch (\Exception $e) {
            // Expected: the catcher above throws to stop the handler before
            // its exit; runs. Anything else escaping $fn is a real failure
            // and would show up as a different exception message.
        } finally {
            remove_filter('wp_redirect', $catcher, 10);
        }
        $this->assertNotNull($captured, 'handler did not redirect');
        return $captured;
    }

    /**
     * A throwaway design row for the proof-action tests below.
     *
     * template_id=1 rather than 0: wp_pf_designs.template_id carries a real
     * foreign key to wp_pf_templates, and this dev database's template #1
     * ("Dog-Tags") is guaranteed to exist independent of what any other test
     * or prior run left behind. product_id stays 0 — nothing here renders a
     * product page.
     */
    private function make_design(int $customer_id = 0): int {
        $id = (new DesignRepository())->create([
            'template_id' => 1,
            'product_id'  => 0,
            'customer_id' => $customer_id,
        ]);
        $this->assertIsInt($id);
        $this->assertGreaterThan(0, $id);
        $this->design_ids[] = $id;
        return $id;
    }

    /**
     * The property this whole task exists for: a refusal must not touch a
     * single proof field, not just report the right message.
     */
    private function assert_proof_fields_unchanged(array $before, array $after): void {
        foreach (['proof_status', 'proof_token', 'proof_email', 'proof_note', 'proof_sent_at'] as $field) {
            $this->assertSame($before[$field], $after[$field], "proof field {$field} changed on a refusal");
        }
    }

    public function test_proof_action_refuses_when_no_address_resolves(): void {
        wp_set_current_user(1); // admin — has edit_sgpd_templates
        $repo   = new DesignRepository();
        $id     = $this->make_design(0); // no customer_id, so nothing to fall back to
        $before = $repo->get($id);

        $_POST                = [];
        $_POST['design_id']   = (string) $id;
        $_POST['proof_email'] = '';
        $_REQUEST['_wpnonce'] = wp_create_nonce('sgpd_proof_action_' . $id);

        $location = $this->capture_redirect(fn() => (new DesignsPage())->handle_proof_action());

        $this->assertStringContainsString('sgpd_msg=proof_no_email', $location);
        $this->assert_proof_fields_unchanged($before, $repo->get($id));
    }

    public function test_proof_action_refuses_a_mistyped_address(): void {
        wp_set_current_user(1);
        $repo   = new DesignRepository();
        $id     = $this->make_design(0);
        $before = $repo->get($id);

        $_POST                = [];
        $_POST['design_id']   = (string) $id;
        $_POST['proof_email'] = 'not-an-email';
        $_REQUEST['_wpnonce'] = wp_create_nonce('sgpd_proof_action_' . $id);

        $location = $this->capture_redirect(fn() => (new DesignsPage())->handle_proof_action());

        $this->assertStringContainsString('sgpd_msg=proof_bad_email', $location);
        $this->assert_proof_fields_unchanged($before, $repo->get($id));
    }

    protected function tearDown(): void {
        require_once ABSPATH . 'wp-admin/includes/user.php';
        foreach ($this->user_ids as $id) {
            wp_delete_user($id);
        }
        $this->user_ids = [];

        $repo = new DesignRepository();
        foreach ($this->design_ids as $id) {
            $repo->delete($id);
        }
        $this->design_ids = [];

        $_POST = [];
        unset($_REQUEST['_wpnonce']);
        wp_set_current_user(0);
    }
}
