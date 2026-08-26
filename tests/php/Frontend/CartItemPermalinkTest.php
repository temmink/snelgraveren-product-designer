<?php
use PHPUnit\Framework\TestCase;
use Snelgraveren\ProductDesigner\Database\DesignRepository;
use Snelgraveren\ProductDesigner\Frontend\Frontend;
use Snelgraveren\ProductDesigner\Proof\ProofSession;
use Snelgraveren\ProductDesigner\Proof\ProofPage;
use Snelgraveren\ProductDesigner\Proof\ProofWorkflow;

/**
 * cart_item_permalink() itself is public, so it is exercised directly rather
 * than through the private owns_design()-style logic it mirrors.
 */
class CartItemPermalinkTest extends TestCase {
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
            'session_id'  => 'permalink-test-' . uniqid(),
        ]);
        $this->created_ids[] = $id;
        return $id;
    }

    public function test_an_approved_proof_with_no_owning_session_points_at_the_proof_page(): void {
        $id     = $this->make_design();
        $design = $this->repo->get($id);
        $token  = (new ProofWorkflow($this->repo))->send($id);
        (new ProofWorkflow($this->repo))->approve($token);
        ProofSession::mark_approved($design['design_hash']);

        $permalink = $this->frontend->cart_item_permalink(
            'https://example.test/product/whatever/',
            ['pf_design_hash' => $design['design_hash'], 'product_id' => 1],
            'some-cart-item-key'
        );

        $this->assertSame(ProofPage::url($token), $permalink);
    }

    public function test_a_hash_without_proof_approval_keeps_the_ordinary_pf_design_link(): void {
        $id     = $this->make_design();
        $design = $this->repo->get($id);

        $permalink = $this->frontend->cart_item_permalink(
            'https://example.test/product/whatever/',
            ['pf_design_hash' => $design['design_hash'], 'product_id' => 1],
            'some-cart-item-key'
        );

        $this->assertStringContainsString('pf_design=' . $design['design_hash'], $permalink);
    }

    protected function tearDown(): void {
        foreach ($this->created_ids as $id) {
            $this->repo->delete($id);
        }
        $this->created_ids = [];
    }
}
