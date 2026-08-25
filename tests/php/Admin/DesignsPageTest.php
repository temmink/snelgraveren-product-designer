<?php
use PHPUnit\Framework\TestCase;
use Snelgraveren\ProductDesigner\Admin\DesignsPage;

class DesignsPageTest extends TestCase {
    private array $user_ids = [];

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

    protected function tearDown(): void {
        require_once ABSPATH . 'wp-admin/includes/user.php';
        foreach ($this->user_ids as $id) {
            wp_delete_user($id);
        }
        $this->user_ids = [];
    }
}
