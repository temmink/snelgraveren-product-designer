<?php
use PHPUnit\Framework\TestCase;
use ProductDesigner\Security\NonceManager;

class NonceManagerTest extends TestCase {

    public function test_create_returns_string(): void {
        $nonce = NonceManager::create('test-action');
        $this->assertIsString($nonce);
        $this->assertNotEmpty($nonce);
    }

    public function test_verify_valid_nonce(): void {
        $nonce = NonceManager::create('test-action');
        $this->assertTrue(NonceManager::verify($nonce, 'test-action'));
    }

    public function test_verify_invalid_nonce(): void {
        $this->assertFalse(NonceManager::verify('invalid-nonce-value', 'test-action'));
    }
}
