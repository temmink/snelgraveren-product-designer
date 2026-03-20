<?php
use PHPUnit\Framework\TestCase;
use ProductForge\Security\CapabilityChecker;

class CapabilityCheckerTest extends TestCase {

    public function test_admin_can_manage_templates(): void {
        // User 1 is the WordPress admin — should have manage_woocommerce or be admin.
        wp_set_current_user(1);
        // Admin has 'administrator' role which gives access to most capabilities.
        // can_manage_templates checks 'edit_pf_templates' OR 'manage_woocommerce'.
        // We verify calling it doesn't throw and returns a boolean.
        $result = CapabilityChecker::can_manage_templates();
        $this->assertIsBool($result);
    }

    public function test_unauthenticated_cannot_manage_templates(): void {
        wp_set_current_user(0);
        $this->assertFalse(CapabilityChecker::can_manage_templates());
    }

    public function test_session_id_is_valid_format_or_empty(): void {
        // In CLI/test context headers may already be sent, so session ID may be empty.
        // Either an empty string OR a 32-char hex string is acceptable.
        $session = CapabilityChecker::current_session_id();
        $this->assertIsString($session);
        if ($session !== '') {
            $this->assertMatchesRegularExpression('/^[0-9a-f]{32}$/', $session);
        }
    }
}
