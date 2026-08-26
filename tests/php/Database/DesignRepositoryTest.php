<?php
use PHPUnit\Framework\TestCase;
use Snelgraveren\ProductDesigner\Database\DesignRepository;

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

    public function test_assign_customer_takes_ownership_and_drops_the_guest_session(): void {
        $session = 'test-session-' . uniqid();
        $id = $this->repo->create([
            'template_id' => 1,
            'product_id'  => 1,
            'customer_id' => 0,
            'session_id'  => $session,
        ]);
        $this->created_ids[] = $id;

        $this->assertTrue($this->repo->assign_customer($id, 4242));

        $design = $this->repo->get($id);
        $this->assertSame(4242, (int) $design['customer_id']);
        // Ownership is customer_id OR session_id, so the old guest session must
        // not survive — otherwise the browser it was drawn in still owns it.
        $this->assertSame('', $design['session_id']);
    }

    public function test_assign_customer_invalidates_the_hash_cache(): void {
        $id = $this->repo->create([
            'template_id' => 1,
            'product_id'  => 1,
            'customer_id' => 0,
            'session_id'  => 'test-session-' . uniqid(),
        ]);
        $this->created_ids[] = $id;
        $hash = $this->repo->get($id)['design_hash'];

        // Warm the request-level cache, then reassign through a DIFFERENT
        // instance: a stale cached row here is what would make the admin screen
        // report the old owner right after assigning.
        $this->repo->get_by_hash($hash);
        (new DesignRepository())->assign_customer($id, 777);

        $this->assertSame(777, (int) $this->repo->get_by_hash($hash)['customer_id']);
    }

    public function test_assign_customer_reports_failure_for_an_unknown_design(): void {
        $this->assertFalse($this->repo->assign_customer(0, 1));
    }

    public function test_list_for_admin_filters_by_customer(): void {
        $mine = $this->repo->create([
            'template_id' => 1, 'product_id' => 1, 'customer_id' => 0,
            'session_id'  => 'test-session-' . uniqid(),
        ]);
        $other = $this->repo->create([
            'template_id' => 1, 'product_id' => 1, 'customer_id' => 0,
            'session_id'  => 'test-session-' . uniqid(),
        ]);
        $this->created_ids[] = $mine;
        $this->created_ids[] = $other;

        $customer = 90000 + (int) $mine;
        $this->repo->assign_customer($mine, $customer);

        $rows = $this->repo->list_for_admin(20, 1, ['customer_id' => $customer]);
        $this->assertCount(1, $rows);
        $this->assertSame((int) $mine, (int) $rows[0]['id']);
        $this->assertSame(1, $this->repo->count_for_admin(['customer_id' => $customer]));
    }

    public function test_list_for_admin_finds_a_design_by_hash_prefix(): void {
        $id = $this->repo->create([
            'template_id' => 1, 'product_id' => 1, 'customer_id' => 0,
            'session_id'  => 'test-session-' . uniqid(),
        ]);
        $this->created_ids[] = $id;
        $hash = $this->repo->get($id)['design_hash'];

        $rows = $this->repo->list_for_admin(20, 1, ['search' => substr($hash, 0, 10)]);
        $this->assertCount(1, $rows);
        $this->assertSame($hash, $rows[0]['design_hash']);
    }

    public function test_count_for_admin_without_filters_counts_everything(): void {
        $before = $this->repo->count_for_admin();
        $id = $this->repo->create([
            'template_id' => 1, 'product_id' => 1, 'customer_id' => 0,
            'session_id'  => 'test-session-' . uniqid(),
        ]);
        $this->created_ids[] = $id;
        $this->assertSame($before + 1, $this->repo->count_for_admin());
    }

    public function test_update_proof_writes_only_whitelisted_fields(): void {
        $id = $this->repo->create([
            'template_id' => 1, 'product_id' => 1, 'customer_id' => 0,
            'session_id'  => 'test-session-' . uniqid(),
        ]);
        $this->created_ids[] = $id;

        $this->assertTrue($this->repo->update_proof($id, [
            'proof_status' => 'sent',
            'proof_token'  => str_repeat('b', 32),
            'proof_note'   => 'Naam mag groter',
            'proof_email'  => 'klant@example.invalid',
            'status'       => 'ordered',   // niet in de whitelist: moet genegeerd worden
        ]));

        $design = $this->repo->get($id);
        $this->assertSame('sent', $design['proof_status']);
        $this->assertSame(str_repeat('b', 32), $design['proof_token']);
        $this->assertSame('Naam mag groter', $design['proof_note']);
        $this->assertSame('klant@example.invalid', $design['proof_email']);
        // status hoort NIET meegewijzigd te zijn: proefdruk en levenscyclus zijn
        // aparte assen, en update_proof mag de tweede niet kunnen verzetten.
        $this->assertSame('draft', $design['status']);
    }

    public function test_get_by_proof_token_finds_the_design(): void {
        $id = $this->repo->create([
            'template_id' => 1, 'product_id' => 1, 'customer_id' => 0,
            'session_id'  => 'test-session-' . uniqid(),
        ]);
        $this->created_ids[] = $id;
        $token = str_repeat('c', 32);
        $this->repo->update_proof($id, ['proof_token' => $token, 'proof_status' => 'sent']);

        $found = $this->repo->get_by_proof_token($token);
        $this->assertNotNull($found);
        $this->assertSame((int) $id, (int) $found['id']);
    }

    public function test_get_by_proof_token_ignores_an_empty_token(): void {
        // Elke rij zonder proefdruk heeft proof_token = ''. Een lege zoekterm
        // mag daarom nooit een willekeurig ontwerp opleveren.
        $this->assertNull($this->repo->get_by_proof_token(''));
    }

    protected function tearDown(): void {
        foreach ($this->created_ids as $id) {
            $this->repo->delete($id);
        }
    }
}
