<?php
use PHPUnit\Framework\TestCase;
use ProductDesigner\Database\TemplateRepository;

class TemplateRepositoryTest extends TestCase {
    private TemplateRepository $repo;
    private array $created_ids = [];

    protected function setUp(): void {
        $this->repo = new TemplateRepository();
    }

    public function test_create_and_get_template(): void {
        $id = $this->repo->create([
            'title'         => 'Test Template',
            'slug'          => 'test-template-' . uniqid(),
            'status'        => 'draft',
            'global_config' => '{}',
        ]);
        $this->created_ids[] = $id;
        $this->assertIsInt($id);
        $this->assertGreaterThan(0, $id);

        $template = $this->repo->get($id);
        $this->assertNotNull($template);
        $this->assertEquals('Test Template', $template['title']);
    }

    public function test_update_template(): void {
        $id = $this->repo->create([
            'title'         => 'Before Update',
            'slug'          => 'update-test-' . uniqid(),
            'status'        => 'draft',
            'global_config' => '{}',
        ]);
        $this->created_ids[] = $id;
        $this->repo->update($id, ['title' => 'After Update']);
        $template = $this->repo->get($id);
        $this->assertEquals('After Update', $template['title']);
    }

    public function test_list_templates_with_pagination(): void {
        for ($i = 0; $i < 3; $i++) {
            $id = $this->repo->create([
                'title'         => 'Pagination Test ' . $i,
                'slug'          => 'pagination-' . $i . '-' . uniqid(),
                'status'        => 'draft',
                'global_config' => '{}',
            ]);
            $this->created_ids[] = $id;
        }
        $page1 = $this->repo->list(2, 1);
        $this->assertCount(2, $page1);
        $page2 = $this->repo->list(2, 2);
        $this->assertGreaterThanOrEqual(1, count($page2));
        $page1_ids = array_column($page1, 'id');
        $page2_ids = array_column($page2, 'id');
        $this->assertEmpty(array_intersect($page1_ids, $page2_ids));
    }

    public function test_count_views_batch(): void {
        $counts = $this->repo->count_views_batch([1, 2, 3]);
        $this->assertIsArray($counts);
    }

    public function test_count_products_batch(): void {
        $counts = $this->repo->count_products_batch([1, 2, 3]);
        $this->assertIsArray($counts);
    }

    protected function tearDown(): void {
        foreach ($this->created_ids as $id) {
            $this->repo->delete($id);
        }
    }
}
