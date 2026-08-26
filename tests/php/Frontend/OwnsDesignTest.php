<?php
use PHPUnit\Framework\TestCase;
use Snelgraveren\ProductDesigner\Database\DesignRepository;
use Snelgraveren\ProductDesigner\Frontend\Frontend;
use Snelgraveren\ProductDesigner\Proof\ProofSession;
use Snelgraveren\ProductDesigner\Proof\ProofWorkflow;

/**
 * Frontend::owns_design() is private, so it is exercised via reflection —
 * the same pattern DesignEndpointTest uses for RestDesigns::owns_design()
 * and ProofPageTest uses for ProofPage::add_design_to_cart().
 *
 * This is the headline security property of the proof-approval feature: a
 * proof-only visitor (no account, no matching guest session) is recognised
 * as an owner while the proof stands approved, and stops being recognised
 * the moment the merchant withdraws it. Before this test existed, the only
 * coverage of this two-condition check was CartItemPermalinkTest, which
 * exercises the DUPLICATE copy of the check that used to live in
 * proof_permalink() — pinning the wrong copy, and never proving the
 * withdraw-revokes property at all. Both callers now share one helper,
 * is_proof_only_owner(); this test asserts on owns_design() itself, which
 * is the one that actually gates ownership checks elsewhere on the
 * frontend.
 */
class OwnsDesignTest extends TestCase {
    private DesignRepository $repo;
    private Frontend $frontend;
    private array $created_ids = [];

    protected function setUp(): void {
        if (!function_exists('WC') || !WC()->session) {
            $this->markTestSkipped('WooCommerce session not available in this context.');
        }
        $this->repo     = new DesignRepository();
        $this->frontend = new Frontend();
        WC()->session->set(ProofSession::KEY, []);
    }

    private function make_design(): int {
        $id = $this->repo->create([
            'template_id' => 1, 'product_id' => 1, 'customer_id' => 0,
            'session_id'  => 'owns-design-test-' . uniqid(),
        ]);
        $this->created_ids[] = $id;
        return $id;
    }

    private function invoke_owns_design(array $design): bool {
        $method = new \ReflectionMethod(Frontend::class, 'owns_design');
        $method->setAccessible(true);
        return $method->invoke($this->frontend, $design);
    }

    public function test_owns_design_accepts_a_proof_approved_in_this_session(): void {
        $id     = $this->make_design();
        $design = $this->repo->get($id);
        $token  = (new ProofWorkflow($this->repo))->send($id);
        (new ProofWorkflow($this->repo))->approve($token);
        ProofSession::mark_approved($design['design_hash']);

        // No logged-in user, no matching guest session: the proof grant is
        // this visitor's ONLY claim to ownership.
        wp_set_current_user(0);
        $approved_design = $this->repo->get($id);

        $this->assertTrue($this->invoke_owns_design($approved_design));
    }

    /**
     * The spec's headline claim: withdrawing a proof revokes ownership for a
     * visitor who already approved it, even though the session flag itself
     * is untouched — ProofWorkflow::withdraw() has no way to reach into a
     * visitor's session, so the design's own proof_status column is what
     * actually cuts it off.
     */
    public function test_owns_design_rejects_the_same_session_once_the_proof_is_withdrawn(): void {
        $id     = $this->make_design();
        $design = $this->repo->get($id);
        $token  = (new ProofWorkflow($this->repo))->send($id);
        (new ProofWorkflow($this->repo))->approve($token);
        ProofSession::mark_approved($design['design_hash']);

        // Confirm the grant holds before withdrawing, so a false negative in
        // the assertion below can't be mistaken for a false positive here.
        wp_set_current_user(0);
        $this->assertTrue($this->invoke_owns_design($this->repo->get($id)));

        (new ProofWorkflow($this->repo))->withdraw($id);

        // The session flag is still set — mark_approved() was never undone —
        // but proof_status is back to 'none', so ownership must be denied.
        $this->assertTrue(ProofSession::is_approved($design['design_hash']), 'the session flag must still be set for this to be a real test of the column, not the session');
        $this->assertFalse($this->invoke_owns_design($this->repo->get($id)));
    }

    public function test_owns_design_rejects_an_unapproved_proof(): void {
        $id     = $this->make_design();
        $design = $this->repo->get($id);
        (new ProofWorkflow($this->repo))->send($id);
        // Never approved, so ProofSession has nothing for this hash either.

        wp_set_current_user(0);
        $this->assertFalse($this->invoke_owns_design($this->repo->get($id)));
    }

    protected function tearDown(): void {
        foreach ($this->created_ids as $id) {
            $this->repo->delete($id);
        }
        $this->created_ids = [];
    }
}
