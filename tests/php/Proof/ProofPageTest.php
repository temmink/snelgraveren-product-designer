<?php
use PHPUnit\Framework\TestCase;
use Snelgraveren\ProductDesigner\Proof\ProofPage;

class ProofPageTest extends TestCase {

    protected function tearDown(): void {
        unset($_GET['sgpd_proof']);
    }

    public function test_url_carries_the_token(): void {
        $token = str_repeat('a', 32);
        $this->assertStringContainsString('sgpd_proof=' . $token, ProofPage::url($token));
    }

    public function test_token_from_request_accepts_a_well_formed_token(): void {
        $_GET['sgpd_proof'] = str_repeat('a', 32);
        $this->assertSame(str_repeat('a', 32), ProofPage::token_from_request());
    }

    public function test_token_from_request_rejects_anything_else(): void {
        // A malformed token must resolve to '' and never reach the repository,
        // where a LIKE or a loose comparison could match a real row.
        foreach (['', 'nope', str_repeat('a', 31), str_repeat('a', 33), 'AAAA' . str_repeat('a', 28), '../../etc'] as $bad) {
            $_GET['sgpd_proof'] = $bad;
            $this->assertSame('', ProofPage::token_from_request(), "rejected: {$bad}");
        }
    }

    public function test_token_from_request_is_empty_without_the_parameter(): void {
        unset($_GET['sgpd_proof']);
        $this->assertSame('', ProofPage::token_from_request());
    }
}
