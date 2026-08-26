<?php
use PHPUnit\Framework\TestCase;
use Snelgraveren\ProductDesigner\Proof\ProofSession;

class ProofSessionTest extends TestCase {

    protected function setUp(): void {
        if (!function_exists('WC') || !WC()->session) {
            $this->markTestSkipped('WooCommerce session not available in this context.');
        }
        WC()->session->set(ProofSession::KEY, []);
    }

    public function test_an_unknown_hash_is_not_approved(): void {
        $this->assertFalse(ProofSession::is_approved(str_repeat('a', 32)));
    }

    public function test_marking_a_hash_approves_it_for_this_session(): void {
        $hash = str_repeat('a', 32);
        ProofSession::mark_approved($hash);

        $this->assertTrue(ProofSession::is_approved($hash));
        $this->assertFalse(ProofSession::is_approved(str_repeat('b', 32)));
    }

    public function test_marking_twice_does_not_duplicate(): void {
        $hash = str_repeat('a', 32);
        ProofSession::mark_approved($hash);
        ProofSession::mark_approved($hash);

        $this->assertSame([$hash], WC()->session->get(ProofSession::KEY));
    }

    public function test_forget_removes_the_hash(): void {
        $hash = str_repeat('a', 32);
        ProofSession::mark_approved($hash);
        ProofSession::forget($hash);

        $this->assertFalse(ProofSession::is_approved($hash));
    }

    public function test_a_malformed_hash_is_never_stored(): void {
        ProofSession::mark_approved('not-a-hash');
        $this->assertFalse(ProofSession::is_approved('not-a-hash'));
    }
}
