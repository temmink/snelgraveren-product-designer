<?php
use PHPUnit\Framework\TestCase;
use Snelgraveren\ProductDesigner\Pricing\PriceCalculator;
use Snelgraveren\ProductDesigner\Database\DesignRepository;

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

    /**
     * classify_object() is private and has no collaborators — reflection is the
     * least invasive way to pin its behaviour.
     */
    private function classify(array $obj): ?string {
        $m = new \ReflectionMethod(PriceCalculator::class, 'classify_object');
        $m->setAccessible(true);
        return $m->invoke($this->calc, $obj);
    }

    public function test_classifies_a_customer_image_as_billable(): void {
        $this->assertSame('image', $this->classify(['type' => 'Image']));
    }

    public function test_bills_a_filled_text_element(): void {
        $this->assertSame('text', $this->classify(['type' => 'IText', 'text' => 'Martin']));
    }

    public function test_does_not_bill_an_empty_text_element(): void {
        // A template may author an empty "Your name here" layer, and the
        // designer keeps a text the customer cleared on the canvas as a
        // placeholder. Neither engraves anything, so neither is billable.
        $this->assertNull($this->classify(['type' => 'IText', 'text' => '']));
        $this->assertNull($this->classify(['type' => 'IText', 'text' => '   ']));
        $this->assertNull($this->classify(['type' => 'Textbox']));
    }

    public function test_does_not_bill_template_background_art(): void {
        $this->assertNull($this->classify([
            'type' => 'Image',
            'data' => ['templateArt' => true],
        ]));
    }

    public function test_still_bills_template_svg_layers(): void {
        // Deliberate: svg template layers are billable today and must stay so,
        // or live prices on existing products would change.
        $this->assertSame('svg', $this->classify(['type' => 'Group']));
    }
}
