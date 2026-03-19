<?php
use PHPUnit\Framework\TestCase;
use ProductDesigner\Database\DesignRepository;

class DesignRepositoryTest extends TestCase {
    private DesignRepository $repo;
    private array $created_ids = [];

    protected function setUp(): void {
        $this->repo = new DesignRepository();
    }

    public function test_create_design_generates_hash(): void {
        $id = $this->repo->create([
            'template_id' => 1,
            'product_id'  => 1,
            'customer_id' => 0,
            'session_id'  => 'test-session-' . uniqid(),
        ]);
        $this->created_ids[] = $id;
        $this->assertIsInt($id);
        $this->assertGreaterThan(0, $id);

        $design = $this->repo->get($id);
        $this->assertNotEmpty($design['design_hash']);
        $this->assertEquals(32, strlen($design['design_hash']));
    }

    public function test_get_by_hash(): void {
        $id = $this->repo->create([
            'template_id' => 1,
            'product_id'  => 1,
            'customer_id' => 0,
            'session_id'  => 'test-session-' . uniqid(),
        ]);
        $this->created_ids[] = $id;

        $design = $this->repo->get($id);
        $hash   = $design['design_hash'];

        $found = $this->repo->get_by_hash($hash);
        $this->assertNotNull($found);
        $this->assertEquals($id, (int) $found['id']);
    }

    public function test_update_status(): void {
        $id = $this->repo->create([
            'template_id' => 1,
            'product_id'  => 1,
            'customer_id' => 0,
            'session_id'  => 'test-session-' . uniqid(),
        ]);
        $this->created_ids[] = $id;

        $this->repo->update_status($id, 'final');
        $design = $this->repo->get($id);
        $this->assertEquals('final', $design['status']);
    }

    protected function tearDown(): void {
        foreach ($this->created_ids as $id) {
            $this->repo->delete($id);
        }
    }
}
