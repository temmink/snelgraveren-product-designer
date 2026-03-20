<?php
use PHPUnit\Framework\TestCase;
use ProductForge\Pricing\PriceCalculator;
use ProductForge\Database\DesignRepository;

class PriceCalculatorTest extends TestCase {
    private PriceCalculator $calc;
    private DesignRepository $designs;
    private array $created_ids = [];

    protected function setUp(): void {
        $this->calc    = new PriceCalculator();
        $this->designs = new DesignRepository();
    }

    public function test_returns_zero_for_nonexistent_design(): void {
        $result = $this->calc->calculate('nonexistent-hash-' . uniqid());
        $this->assertEquals(0.0, $result);
    }

    public function test_returns_zero_for_empty_design(): void {
        $id = $this->designs->create([
            'template_id' => 1,
            'product_id'  => 1,
            'customer_id' => 0,
            'session_id'  => 'price-test-' . uniqid(),
        ]);
        $this->created_ids[] = $id;

        $design = $this->designs->get($id);
        $result = $this->calc->calculate($design['design_hash']);
        // Design has no views/elements, and template_id=1 may not exist,
        // so the result is 0.0 in both cases.
        $this->assertEquals(0.0, $result);
    }

    protected function tearDown(): void {
        foreach ($this->created_ids as $id) {
            $this->designs->delete($id);
        }
    }
}
